from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List

from app.database import get_db
from app import models, schemas
from app import installment_metrics

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
        current_installment=installment.current_installment,
        total_installments=installment.total_installments,
        end_date=installment.end_date,
        account_id=installment.account_id,
        category=installment.category,
        remaining_amount=installment_metrics.remaining_amount(installment),
    )


# ⚠️ Declarado **antes** das rotas com `{installment_id}`: o path
# `/installments/summary` casa com aquele padrão, e o FastAPI tentaria converter
# "summary" em int. Ver `test_summary_route_is_not_shadowed_by_an_id_route`.
@router.get("/summary", response_model=schemas.InstallmentSummary)
def get_installments_summary(db: Session = Depends(get_db)):
    """Totais do cabeçalho da tela de parcelamentos.

    Os três números numa requisição só. `active_count` e
    `monthly_committed_amount` repetem valores do dashboard, mas vêm da mesma
    função — não de uma segunda implementação da regra de "ativo".
    """
    active = installment_metrics.active_installments(db)

    return schemas.InstallmentSummary(
        active_count=len(active),
        monthly_committed_amount=installment_metrics.monthly_committed(active),
        remaining_total_amount=installment_metrics.remaining_total(active),
    )


@router.post("/", response_model=schemas.InstallmentResponse, status_code=status.HTTP_201_CREATED)
def create_installment(installment: schemas.InstallmentCreate, db: Session = Depends(get_db)):
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

    new_installment = models.Installment(
        title=installment.title,
        category_id=installment.category_id,
        total_amount=installment.total_amount,
        installment_amount=installment.installment_amount,
        current_installment=installment.current_installment,
        total_installments=installment.total_installments,
        end_date=installment.end_date,
        account_id=installment.account_id
    )
    db.add(new_installment)
    db.commit()
    db.refresh(new_installment)
    return _to_response(new_installment)

@router.get("/", response_model=List[schemas.InstallmentResponse])
def list_installments(db: Session = Depends(get_db)):
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
    db: Session = Depends(get_db)
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

    db.commit()
    db.refresh(installment)

    return _to_response(installment)
