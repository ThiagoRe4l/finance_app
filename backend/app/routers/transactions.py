from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/transactions",
    tags=["Transactions"]
)

@router.post("/", response_model=schemas.TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(transaction: schemas.TransactionCreate, db: Session = Depends(get_db)):
    # 1. Busca a conta correspondente
    account = db.query(models.Account).filter(models.Account.id == transaction.account_id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conta não encontrada."
        )

    # 2. Valida o parcelamento de origem, quando informado
    if transaction.installment_id is not None:
        installment = db.query(models.Installment).filter(
            models.Installment.id == transaction.installment_id
        ).first()
        if not installment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parcelamento não encontrado."
            )

    # 3. Verifica o tipo da transação e atualiza o saldo
    if transaction.type == "SAÍDA":
        account.current_balance -= transaction.amount
    elif transaction.type == "ENTRADA":
        account.current_balance += transaction.amount
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de transação inválido. Deve ser 'ENTRADA' ou 'SAÍDA'."
        )

    # 4. Instancia a transação
    db_transaction = models.Transaction(
        title=transaction.title,
        type=transaction.type,
        amount=transaction.amount,
        date=transaction.date,
        category=transaction.category,
        is_fixed=transaction.is_fixed,
        account_id=transaction.account_id,
        installment_id=transaction.installment_id
    )

    # 5. Salva no banco de dados
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)

    return db_transaction

@router.get("/", response_model=List[schemas.TransactionResponse])
def list_transactions(db: Session = Depends(get_db)):
    return db.query(models.Transaction).options(
        joinedload(models.Transaction.installment)
    ).order_by(models.Transaction.date.desc(), models.Transaction.id.desc()).all()
