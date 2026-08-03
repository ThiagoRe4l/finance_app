from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/categories",
    tags=["Categories"]
)

@router.post("/", response_model=schemas.CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(category: schemas.CategoryCreate, db: Session = Depends(get_db)):
    db_category = db.query(models.Category).filter(models.Category.name == category.name).first()
    if db_category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Categoria já existe."
        )
    
    new_category = models.Category(
        name=category.name,
        icon_name=category.icon_name,
        budget=category.budget,
        color=category.color
    )
    db.add(new_category)
    db.commit()
    db.refresh(new_category)
    return new_category

@router.get("/", response_model=List[schemas.CategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    categories = db.query(models.Category).all()
    
    # Para cada categoria, calcula o gasto total e a contagem de transações
    # Nota: Em um app real, isso seria feito com uma query otimizada ou views
    response = []
    for cat in categories:
        spent = db.query(func.sum(models.Transaction.amount)).filter(
            models.Transaction.category == cat.name,
            models.Transaction.type == "SAÍDA"
        ).scalar() or 0.0
        
        count = db.query(func.count(models.Transaction.id)).filter(
            models.Transaction.category == cat.name
        ).scalar()
        
        response.append(schemas.CategoryResponse(
            id=cat.id,
            name=cat.name,
            icon_name=cat.icon_name,
            budget=cat.budget,
            color=cat.color,
            spent=spent,
            txs_count=count
        ))
    
    return response
