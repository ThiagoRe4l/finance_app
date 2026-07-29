from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/accounts",
    tags=["Accounts"]
)

@router.post("/", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(account: schemas.AccountCreate, db: Session = Depends(get_db)):
    # Evita duplicidade de contas com o mesmo nome
    db_account = db.query(models.Account).filter(models.Account.name == account.name).first()
    if db_account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe uma conta cadastrada com este nome."
        )
    
    # Cria a nova conta com saldo atual idêntico ao saldo inicial
    new_account = models.Account(
        name=account.name,
        initial_balance=account.initial_balance,
        current_balance=account.initial_balance
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    return new_account

@router.get("/", response_model=List[schemas.AccountResponse])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(models.Account).all()
