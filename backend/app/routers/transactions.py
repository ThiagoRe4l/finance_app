from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

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

    # 2. Verifica o tipo da transação e atualiza o saldo
    if transaction.type == "SAÍDA":
        account.current_balance -= transaction.amount
    elif transaction.type == "ENTRADA":
        account.current_balance += transaction.amount
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de transação inválido. Deve ser 'ENTRADA' ou 'SAÍDA'."
        )

    # 3. Instancia a transação
    db_transaction = models.Transaction(
        type=transaction.type,
        amount=transaction.amount,
        date=transaction.date,
        category=transaction.category,
        account_id=transaction.account_id
    )

    # 4. Salva no banco de dados
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)

    return db_transaction
