from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
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
        
    new_installment = models.Installment(
        title=installment.title,
        category_name=installment.category_name,
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
    return db.query(models.Installment).all()
