"""`GET /periods/range` — até onde o seletor de período vai (PER-6)."""

import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.period_aggregates import first_transaction_month
from app.periods import month_key, shift_month
from app.tenancy import owned_db

router = APIRouter(prefix="/periods", tags=["Periods"])

MONTHS_AHEAD = 12


@router.get("/range", response_model=schemas.PeriodRange)
def get_period_range(db: Session = Depends(owned_db)):
    """`min`: mês do lançamento mais antigo. `max`: o maior entre 12 meses à frente
    e o mês do último lançamento (a última parcela de um parcelamento é um)."""
    today = datetime.date.today()
    current = (today.year, today.month)

    first = first_transaction_month(db) or current
    latest = db.query(func.max(models.Transaction.date)).scalar()
    ahead = shift_month(*current, MONTHS_AHEAD)
    last = max(ahead, (latest.year, latest.month)) if latest else ahead

    return schemas.PeriodRange(
        min_month=month_key(*min(first, current)),
        max_month=month_key(*last),
        current_month=month_key(*current),
    )
