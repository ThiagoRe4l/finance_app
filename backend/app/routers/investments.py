from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/investments",
    tags=["Investments"]
)

@router.post("/", response_model=schemas.InvestmentResponse, status_code=status.HTTP_201_CREATED)
def create_investment(investment: schemas.InvestmentCreate, db: Session = Depends(get_db)):
    # Evita duplicidade de investimentos com o mesmo nome
    db_investment = db.query(models.Investment).filter(models.Investment.name == investment.name).first()
    if db_investment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe um investimento cadastrado com este nome."
        )
    
    # Cria o novo investimento
    new_investment = models.Investment(
        name=investment.name,
        current_balance=investment.current_balance
    )
    db.add(new_investment)
    db.commit()
    db.refresh(new_investment)
    return new_investment

@router.get("/", response_model=List[schemas.InvestmentResponse])
def list_investments(db: Session = Depends(get_db)):
    return db.query(models.Investment).all()


@router.post("/{investment_id}/history", response_model=schemas.InvestmentHistoryResponse, status_code=status.HTTP_201_CREATED)
def create_investment_history(
    investment_id: int,
    history: schemas.InvestmentHistoryCreate,
    db: Session = Depends(get_db)
):
    # 1. Busca o investimento pelo investment_id
    investment = db.query(models.Investment).filter(models.Investment.id == investment_id).first()
    if not investment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Investimento não encontrado."
        )
    
    # 2. Atualiza o current_balance do investimento principal
    investment.current_balance = history.balance

    # 3. Instancia e adiciona o registro de histórico
    new_history = models.InvestmentHistory(
        investment_id=investment_id,
        date=history.date,
        balance=history.balance
    )
    db.add(new_history)
    
    # 4. Executa commit e refresh
    db.commit()
    db.refresh(new_history)
    
    return new_history


@router.get("/{investment_id}/history", response_model=List[schemas.InvestmentHistoryResponse])
def list_investment_history(investment_id: int, db: Session = Depends(get_db)):
    # 1. Busca o investimento pelo investment_id para validar sua existência
    investment = db.query(models.Investment).filter(models.Investment.id == investment_id).first()
    if not investment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Investimento não encontrado."
        )
    
    # 2. Retorna a lista com todo o histórico do investimento específico
    return db.query(models.InvestmentHistory).filter(models.InvestmentHistory.investment_id == investment_id).all()
