"""Assinaturas — cobrança recorrente que entra sozinha (R-1 a R-6).

Decisão em `docs/recorrencias.md`. Nenhuma leitura escreve: a cobrança é lançada
por `POST /subscriptions/sync` (e pelo cadastro e pela edição), nunca por um `GET`.
"""

import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app import models, schemas, subscription_metrics, subscription_service
from app.subscription_schedule import next_charge_date
from app.tenancy import owned_db, owner_id

router = APIRouter(
    prefix="/subscriptions",
    tags=["Subscriptions"],
)


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assinatura não encontrada.")


def _to_response(subscription: models.Subscription) -> schemas.SubscriptionResponse:
    """Monta a resposta com os campos derivados `status` e `next_charge_date`
    (mesma natureza de `remaining_amount` em `installments.py`)."""
    upcoming = next_charge_date(
        subscription.first_charge_date, datetime.date.today(), subscription.ended_on
    )
    return schemas.SubscriptionResponse(
        id=subscription.id,
        title=subscription.title,
        amount=subscription.amount,
        category_id=subscription.category_id,
        account_id=subscription.account_id,
        first_charge_date=subscription.first_charge_date,
        ended_on=subscription.ended_on,
        status="ativa" if upcoming is not None else "encerrada",
        next_charge_date=upcoming,
        category=subscription.category,
    )


def _require_category(db: Session, category_id: int) -> None:
    if not db.query(models.Category).filter(models.Category.id == category_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoria não encontrada.")


# ⚠️ `/summary` e `/sync` antes das rotas com `{subscription_id}`: o path casa com
# aquele padrão, e o FastAPI tentaria converter "summary" em int.
@router.get("/summary", response_model=schemas.SubscriptionSummary)
def get_subscriptions_summary(db: Session = Depends(owned_db)):
    # A regra de "ativa" vive em `subscription_metrics`, compartilhada com o
    # Dashboard (R-7).
    active = subscription_metrics.active_subscriptions(db)
    return schemas.SubscriptionSummary(
        active_count=len(active),
        monthly_amount=subscription_metrics.monthly_amount(active),
    )


@router.post("/sync", response_model=schemas.SubscriptionSyncResult)
def sync_subscriptions(db: Session = Depends(owned_db)):
    """Lança as cobranças vencidas de **todas as assinaturas do dono** (R-3).

    Idempotente. Se duas chamadas correm juntas, o `UNIQUE (subscription_id, date)`
    derruba a perdedora; ela refaz a leitura uma vez, já com o cursor da outra.
    """
    today = datetime.date.today()
    for _attempt in range(2):
        try:
            created = sum(
                subscription_service.post_due_charges(db, subscription, today)
                for subscription in db.query(models.Subscription).all()
            )
            db.commit()
            return schemas.SubscriptionSyncResult(created=created)
        except IntegrityError:
            db.rollback()
    return schemas.SubscriptionSyncResult(created=0)


@router.get("", response_model=List[schemas.SubscriptionResponse])
def list_subscriptions(db: Session = Depends(owned_db)):
    subscriptions = db.query(models.Subscription).options(
        joinedload(models.Subscription.category)
    ).order_by(models.Subscription.id).all()
    return [_to_response(s) for s in subscriptions]


@router.post("", response_model=schemas.SubscriptionResponse, status_code=status.HTTP_201_CREATED)
def create_subscription(payload: schemas.SubscriptionCreate, db: Session = Depends(owned_db)):
    """Cria a assinatura e lança as cobranças que já venceram (primeira cobrança
    no passado), numa transação de banco só."""
    if not db.query(models.Account).filter(models.Account.id == payload.account_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conta não encontrada.")
    _require_category(db, payload.category_id)

    subscription = models.Subscription(owner_id=owner_id(db), **payload.model_dump())
    db.add(subscription)
    db.flush()
    subscription_service.post_due_charges(db, subscription, datetime.date.today())

    db.commit()
    db.refresh(subscription)
    return _to_response(subscription)


@router.patch("/{subscription_id}", response_model=schemas.SubscriptionResponse)
def update_subscription(
    subscription_id: int,
    payload: schemas.SubscriptionUpdate,
    db: Session = Depends(owned_db),
):
    """Edição que vale daqui para frente (R-4).

    As cobranças vencidas são lançadas **antes** de aplicar a mudança, com os dados
    antigos: reajustar o preço não pode reescrever uma cobrança que já venceu.
    """
    subscription = db.query(models.Subscription).filter(
        models.Subscription.id == subscription_id
    ).first()
    if not subscription:
        raise _not_found()

    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data:
        _require_category(db, data["category_id"])

    today = datetime.date.today()
    subscription_service.post_due_charges(db, subscription, today)

    # Reativar recomeça de hoje: os meses em que ficou encerrada não são lançados
    # depois (R-4).
    reactivating = (
        "ended_on" in data and data["ended_on"] is None and subscription.ended_on is not None
    )
    for field, value in data.items():
        setattr(subscription, field, value)
    if reactivating:
        subscription.charged_through = today

    db.commit()
    db.refresh(subscription)
    return _to_response(subscription)


@router.delete("/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subscription(subscription_id: int, db: Session = Depends(owned_db)):
    """Apaga a assinatura e **desvincula** as cobranças já lançadas (R-4): o dinheiro
    saiu de verdade, então o extrato fica.

    Objeto por objeto: o filtro de dono da D-Tenant-3 só age em SELECT.
    """
    subscription = db.query(models.Subscription).filter(
        models.Subscription.id == subscription_id
    ).first()
    if not subscription:
        raise _not_found()

    for transaction in db.query(models.Transaction).filter(
        models.Transaction.subscription_id == subscription_id
    ).all():
        transaction.subscription_id = None

    db.delete(subscription)
    db.commit()
