from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/installments",
    tags=["Installments"]
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
    return new_installment

@router.get("/", response_model=List[schemas.InstallmentResponse])
def list_installments(db: Session = Depends(get_db)):
    return db.query(models.Installment).options(
        joinedload(models.Installment.category)
    ).all()


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

    return installment
