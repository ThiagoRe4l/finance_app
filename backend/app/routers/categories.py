from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case
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
    # Uma query agregada só, via FK. A versão anterior comparava strings e
    # rodava duas queries por categoria (N+1); com `category_id` o banco resolve
    # tudo em um GROUP BY.
    #
    # O join é OUTER de propósito: categoria sem movimento tem que continuar
    # aparecendo com zeros. Um INNER JOIN a faria sumir da listagem — e do
    # `category_distribution` do dashboard, que reusa esta função.
    #
    # A assimetria entre as duas agregações é intencional: `spent` só considera
    # SAÍDA (daí o CASE), enquanto `txs_count` conta a categoria inteira,
    # ENTRADA incluída.
    rows = db.query(
        models.Category,
        func.coalesce(
            func.sum(
                case((models.Transaction.type == "SAÍDA", models.Transaction.amount), else_=0.0)
            ),
            0.0,
        ).label("spent"),
        func.count(models.Transaction.id).label("txs_count"),
    ).outerjoin(
        models.Transaction, models.Transaction.category_id == models.Category.id
    ).group_by(
        models.Category.id
    ).order_by(
        models.Category.id
    ).all()

    return [
        schemas.CategoryResponse(
            id=cat.id,
            name=cat.name,
            icon_name=cat.icon_name,
            budget=cat.budget,
            color=cat.color,
            spent=spent,
            txs_count=txs_count,
        )
        for cat, spent, txs_count in rows
    ]
