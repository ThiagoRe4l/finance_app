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

def _aggregated_rows(db: Session, category_id: int | None = None):
    """Categorias com `spent` e `txs_count` resolvidos no banco.

    Uma query agregada só, via FK. A versão anterior comparava strings e rodava
    duas queries por categoria (N+1); com `category_id` o banco resolve tudo em
    um GROUP BY.

    O join é OUTER de propósito: categoria sem movimento tem que continuar
    aparecendo com zeros. Um INNER JOIN a faria sumir da listagem — e do
    `category_distribution` do dashboard, que reusa `list_categories`.

    A assimetria entre as duas agregações é intencional: `spent` só considera
    SAÍDA (daí o CASE), enquanto `txs_count` conta a categoria inteira, ENTRADA
    incluída.

    `category_id` filtra uma só, para o PATCH devolver os mesmos números da
    listagem sem montar uma segunda query — se o update respondesse com o objeto
    ORM puro, `spent`/`txs_count` cairiam nos defaults `0.0`/`0` do schema e a
    tela piscaria zerada até o próximo GET.
    """
    query = db.query(
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
    )

    if category_id is not None:
        query = query.filter(models.Category.id == category_id)

    return query.group_by(models.Category.id).order_by(models.Category.id).all()


def _to_response(row) -> schemas.CategoryResponse:
    cat, spent, txs_count = row
    return schemas.CategoryResponse(
        id=cat.id,
        name=cat.name,
        icon_name=cat.icon_name,
        budget=cat.budget,
        color=cat.color,
        spent=spent,
        txs_count=txs_count,
    )


@router.get("/", response_model=List[schemas.CategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    return [_to_response(row) for row in _aggregated_rows(db)]


@router.patch("/{category_id}", response_model=schemas.CategoryResponse)
def update_category(
    category_id: int,
    payload: schemas.CategoryUpdate,
    db: Session = Depends(get_db)
):
    """Edição parcial. Renomear categoria em uso é permitido (decisão C11)."""
    category = db.query(models.Category).filter(
        models.Category.id == category_id
    ).first()
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria não encontrada."
        )

    data = payload.model_dump(exclude_unset=True)

    # `name` é UNIQUE no model. Sem esta checagem o banco levanta IntegrityError
    # e o router devolve 500 para um conflito de negócio previsto. O `!=` no id
    # é o que permite reenviar o próprio nome junto de outros campos.
    if "name" in data:
        duplicate = db.query(models.Category).filter(
            models.Category.name == data["name"],
            models.Category.id != category_id,
        ).first()
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Categoria já existe."
            )

    for field, value in data.items():
        setattr(category, field, value)

    db.commit()

    return _to_response(_aggregated_rows(db, category_id=category_id)[0])


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    """Exclui a categoria; **409** se ela estiver em uso (decisões C9/C10).

    As duas FKs para `categories.id` são `ondelete="RESTRICT"`, então o banco já
    recusaria — mas via `IntegrityError`, que sobe como 500. A checagem
    antecipada é o que transforma isso num conflito legível.

    Os dois vínculos são verificados: uma categoria pode estar presa a um
    parcelamento **sem ter transação nenhuma**, e olhar só `Transaction`
    deixaria esse caso escapar para o 500.
    """
    category = db.query(models.Category).filter(
        models.Category.id == category_id
    ).first()
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria não encontrada."
        )

    in_use_by_transaction = db.query(models.Transaction).filter(
        models.Transaction.category_id == category_id
    ).first()
    in_use_by_installment = db.query(models.Installment).filter(
        models.Installment.category_id == category_id
    ).first()

    if in_use_by_transaction or in_use_by_installment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Categoria em uso por transações ou parcelamentos. "
                "Remova os vínculos antes de excluí-la."
            )
        )

    db.delete(category)
    db.commit()
