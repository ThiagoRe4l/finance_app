from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List

from app.tenancy import owned_db, owner_id
from app import models, schemas
import datetime

from sqlalchemy import func

from app import account_balance, installment_metrics, installment_service
from app.installment_metrics import ZERO
from app.installment_schedule import Schedule, build_schedule

router = APIRouter(
    prefix="/installments",
    tags=["Installments"]
)

def _to_response(installment: models.Installment) -> schemas.InstallmentResponse:
    """Monta a resposta com o campo derivado `remaining_amount`.

    **Exceção declarada ao padrão de serialização direta do ORM** — mesma
    natureza de `spent`/`txs_count` em `categories.py`: o valor não existe no
    model, é calculado. Concentrar aqui evita que os três caminhos que devolvem
    um parcelamento (POST, GET, PATCH) calculem cada um do seu jeito.
    """
    return schemas.InstallmentResponse(
        id=installment.id,
        title=installment.title,
        category_id=installment.category_id,
        total_amount=installment.total_amount,
        installment_amount=installment.installment_amount,
        # Derivada do calendário nos parcelamentos com âncora (S-3).
        current_installment=installment_metrics.effective_current(installment),
        total_installments=installment.total_installments,
        end_date=installment.end_date,
        account_id=installment.account_id,
        first_due_date=installment.first_due_date,
        anchor_due_date=installment.anchor_due_date,
        category=installment.category,
        remaining_amount=installment_metrics.remaining_amount(installment),
    )


# ⚠️ Declarado **antes** das rotas com `{installment_id}`: o path
# `/installments/summary` casa com aquele padrão, e o FastAPI tentaria converter
# "summary" em int. Ver `test_summary_route_is_not_shadowed_by_an_id_route`.
@router.get("/summary", response_model=schemas.InstallmentSummary)
def get_installments_summary(db: Session = Depends(owned_db)):
    """Totais do cabeçalho da tela de parcelamentos.

    Os três números numa requisição só. `active_count` e
    `monthly_committed_amount` repetem valores do dashboard, mas vêm da mesma
    função — não de uma segunda implementação da regra de "ativo".
    """
    active = installment_metrics.active_installments(db)

    # S-2: o saldo "se todas as parcelas já tivessem saído". Parcela gerada com
    # data depois de hoje ainda não está no saldo (S-1); parcelamento antigo não
    # tem parcela nenhuma no extrato, então entra pelo restante dele.
    today = datetime.date.today()
    future_parcels = db.query(
        func.coalesce(func.sum(models.Transaction.amount), ZERO)
    ).filter(
        models.Transaction.installment_number.isnot(None),
        models.Transaction.type == "SAÍDA",
        models.Transaction.date > today,
    ).scalar() or ZERO
    legacy_remaining = sum(
        (installment_metrics.remaining_amount(it) for it in active if it.first_due_date is None),
        ZERO,
    )

    return schemas.InstallmentSummary(
        active_count=len(active),
        monthly_committed_amount=installment_metrics.monthly_committed(active),
        remaining_total_amount=installment_metrics.remaining_total(active),
        committed_balance=account_balance.total_balance(db) - future_parcels - legacy_remaining,
    )


def _schedule_of(payload: schemas.InstallmentScheduleInput) -> Schedule:
    return build_schedule(
        total_installments=payload.total_installments,
        current_installment=payload.current_installment,
        current_due_date=payload.current_due_date,
        total_amount=payload.total_amount,
        installment_amount=payload.installment_amount,
    )


@router.post("/preview", response_model=schemas.InstallmentPreview)
def preview_installment(
    payload: schemas.InstallmentScheduleInput,
    db: Session = Depends(owned_db),  # noqa: ARG001 — ver docstring
):
    """Cronograma calculado, **sem gravar nada** — o que o formulário mostra
    antes de salvar (#4). Mesma função do cadastro: o que se vê é o que se grava.

    Não lê nem escreve dado de ninguém, mas declara `owned_db` mesmo assim:
    `test_every_data_route_uses_the_owner_scoped_session` não tem lista de
    exceções, de propósito, e abrir uma para esta rota enfraqueceria a
    varredura (D-Tenant-7) por nada.
    """
    schedule = _schedule_of(payload)
    return schemas.InstallmentPreview(
        total_amount=schedule.total_amount,
        installment_amount=schedule.installment_amount,
        remaining_amount=schedule.remaining_amount,
        first_due_date=schedule.first_due_date,
        end_date=schedule.end_date,
        installments=[
            schemas.InstallmentPreviewParcel(number=p.number, date=p.date, amount=p.amount)
            for p in schedule.parcels
        ],
    )


@router.post("", response_model=schemas.InstallmentResponse, status_code=status.HTTP_201_CREATED)
def create_installment(installment: schemas.InstallmentCreate, db: Session = Depends(owned_db)):
    """Cria o parcelamento **e** uma SAÍDA por parcela de `current` a `total`
    (P-1, P-2), numa transação de banco só: ou tudo, ou nada."""
    account = db.query(models.Account).filter(models.Account.id == installment.account_id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conta não encontrada."
        )

    category = db.query(models.Category).filter(
        models.Category.id == installment.category_id
    ).first()
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria não encontrada."
        )

    new_installment = installment_service.create_with_parcels(
        db,
        owner_id(db),
        title=installment.title,
        category_id=installment.category_id,
        account_id=installment.account_id,
        total_installments=installment.total_installments,
        current_installment=installment.current_installment,
        current_due_date=installment.current_due_date,
        total_amount=installment.total_amount,
        installment_amount=installment.installment_amount,
    )

    db.commit()
    db.refresh(new_installment)
    return _to_response(new_installment)

@router.get("", response_model=List[schemas.InstallmentResponse])
def list_installments(db: Session = Depends(owned_db)):
    installments = db.query(models.Installment).options(
        joinedload(models.Installment.category)
    ).all()
    return [_to_response(it) for it in installments]


# Os três valores que descrevem o contrato financeiro da compra. Depois que uma
# parcela foi lançada como transação, editá-los faria o parcelamento divergir do
# que já está no extrato — ver decisão D15 no CLAUDE.md.
LOCKED_ONCE_LAUNCHED = ("installment_amount", "total_installments", "total_amount")


@router.patch("/{installment_id}", response_model=schemas.InstallmentResponse)
def update_installment(
    installment_id: int,
    payload: schemas.InstallmentUpdate,
    db: Session = Depends(owned_db)
):
    """Edição parcial. Não toca saldo — parcelamento nunca tocou.

    `current_installment` pode ultrapassar `total_installments`: é o estado
    "quitado" (decisão D13), não um erro de validação.
    """
    installment = db.query(models.Installment).filter(
        models.Installment.id == installment_id
    ).first()
    if not installment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parcelamento não encontrado."
        )

    data = payload.model_dump(exclude_unset=True)

    # S-3: com âncora, a parcela atual vem do calendário. Reenviar o valor que
    # a API mostrou passa (formulário que manda o objeto inteiro); mudar é 400.
    if installment.anchor_due_date is not None and "current_installment" in data:
        if data["current_installment"] != installment_metrics.effective_current(installment):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "A parcela atual deste parcelamento é calculada pela data "
                    "de vencimento e não pode ser alterada."
                ),
            )
        del data["current_installment"]

    if "category_id" in data:
        category = db.query(models.Category).filter(
            models.Category.id == data["category_id"]
        ).first()
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Categoria não encontrada."
            )

    # D15: a trava é por **mudança de valor**, não por presença do campo. Um
    # formulário de edição manda o objeto inteiro, então recusar só porque o
    # campo veio no payload tornaria a tela inutilizável em qualquer
    # parcelamento com parcela já lançada.
    changed_locked = [
        field for field in LOCKED_ONCE_LAUNCHED
        if field in data and data[field] != getattr(installment, field)
    ]
    if changed_locked:
        has_launched_transaction = db.query(models.Transaction).filter(
            models.Transaction.installment_id == installment_id
        ).first()
        if has_launched_transaction:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Parcelamento já possui transações lançadas: "
                    f"{', '.join(sorted(changed_locked))} não pode(m) mais ser alterado(s)."
                )
            )

    for field, value in data.items():
        setattr(installment, field, value)

    # P-6: título e categoria acompanham nas parcelas **geradas**. As ligadas à
    # mão (`installment_number` nulo) são do usuário e não mudam. Objeto por
    # objeto: o filtro de dono não age em UPDATE em massa (D-Tenant-3).
    propagated = {k: data[k] for k in ("title", "category_id") if k in data}
    if propagated:
        generated = db.query(models.Transaction).filter(
            models.Transaction.installment_id == installment_id,
            models.Transaction.installment_number.isnot(None),
        ).all()
        for transaction in generated:
            for field, value in propagated.items():
                setattr(transaction, field, value)

    db.commit()
    db.refresh(installment)

    return _to_response(installment)


@router.delete("/{installment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_installment(installment_id: int, db: Session = Depends(owned_db)):
    """P-6: apaga as parcelas geradas, desvincula as ligadas à mão e apaga o
    parcelamento — numa transação de banco só.

    Tudo carregado antes e alterado objeto por objeto: o filtro de dono da
    D-Tenant-3 só age em SELECT, e um DELETE em massa não passaria por ele.
    """
    installment = db.query(models.Installment).filter(
        models.Installment.id == installment_id
    ).first()
    if not installment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parcelamento não encontrado."
        )

    linked = db.query(models.Transaction).filter(
        models.Transaction.installment_id == installment_id
    ).all()
    for transaction in linked:
        if transaction.installment_number is not None:
            db.delete(transaction)
        else:
            transaction.installment_id = None

    db.delete(installment)
    db.commit()
