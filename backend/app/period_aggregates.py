"""Agregações por período, compartilhadas por Dashboard e Relatórios (PER-3 a PER-5).

Existe pelo motivo de `installment_metrics.py`: as duas rotas precisam da **mesma**
conta, e duplicá-la é como o total do Dashboard e o dos Relatórios passariam a
divergir no mesmo período.

Dinheiro é `Decimal` do começo ao fim; o front não soma nada.
"""

import datetime
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import account_balance, models, schemas
from app.periods import (
    MONTH_NAMES, InvalidPeriod, Period, month_bounds, month_key, parse_period,
)
from app.subscription_schedule import charge_dates

ZERO = Decimal("0.00")


def first_transaction_month(db: Session) -> Optional[tuple[int, int]]:
    oldest = db.query(func.min(models.Transaction.date)).scalar()
    return (oldest.year, oldest.month) if oldest else None


def resolve_period(db: Session, raw: Optional[str]) -> Period:
    """Interpreta o `?period=`; valor inválido vira 422."""
    try:
        return parse_period(raw, first_transaction_month(db))
    except InvalidPeriod:
        raise HTTPException(
            status_code=422,
            detail="Período inválido. Use YYYY-MM, YYYY, YYYY-MM..YYYY-MM, 3m, 6m, 12m ou all.",
        )


def period_info(period: Period) -> schemas.PeriodInfo:
    return schemas.PeriodInfo(key=period.key, start=period.start, end=period.end)


@dataclass(frozen=True)
class Charge:
    date: datetime.date
    amount: Decimal
    category_id: int


def projected_charges(
    db: Session, start: datetime.date, end: datetime.date, today: Optional[datetime.date] = None
) -> List[Charge]:
    """Cobranças de assinatura **calculadas** em `[start, end)`, só depois de hoje.

    Até hoje a cobrança já virou linha (R-3, `sync`); calculá-la de novo contaria
    duas vezes. Nada daqui é gravado.
    """
    today = today or datetime.date.today()
    floor = max(start, today + datetime.timedelta(days=1))
    last = end - datetime.timedelta(days=1)
    if floor > last:
        return []
    charges: List[Charge] = []
    for sub in db.query(models.Subscription).all():
        for day in charge_dates(
            sub.first_charge_date, last, after=floor - datetime.timedelta(days=1),
            ended_on=sub.ended_on,
        ):
            charges.append(Charge(day, sub.amount, sub.category_id))
    return charges


def _sum(rows) -> Decimal:
    return sum(rows, ZERO)


@dataclass(frozen=True)
class Totals:
    revenues: Decimal
    expenses: Decimal
    projected: Decimal


def period_totals(db: Session, start: datetime.date, end: datetime.date) -> Totals:
    def total(kind: str) -> Decimal:
        return db.query(func.sum(models.Transaction.amount)).filter(
            models.Transaction.type == kind,
            models.Transaction.date >= start,
            models.Transaction.date < end,
        ).scalar() or ZERO

    projected = _sum(c.amount for c in projected_charges(db, start, end))
    return Totals(revenues=total("ENTRADA"), expenses=total("SAÍDA") + projected, projected=projected)


def monthly_flow(db: Session, months: List[tuple[int, int]]) -> List[schemas.MonthlyFlow]:
    """Uma barra por mês, com a projeção de assinatura somada às saídas."""
    first, _ = month_bounds(*months[0])
    _, last = month_bounds(*months[-1])

    income: Dict[tuple[int, int], Decimal] = defaultdict(lambda: ZERO)
    outcome: Dict[tuple[int, int], Decimal] = defaultdict(lambda: ZERO)
    rows = db.query(
        models.Transaction.date, models.Transaction.type, models.Transaction.amount
    ).filter(models.Transaction.date >= first, models.Transaction.date < last).all()
    for day, kind, amount in rows:
        bucket = income if kind == "ENTRADA" else outcome
        bucket[(day.year, day.month)] += amount
    for charge in projected_charges(db, first, last):
        outcome[(charge.date.year, charge.date.month)] += charge.amount

    return [
        schemas.MonthlyFlow(
            month=MONTH_NAMES[m - 1], month_key=month_key(y, m),
            income=income[(y, m)], outcome=outcome[(y, m)],
        )
        for y, m in months
    ]


def balance_for_period(db: Session, period: Period, today: Optional[datetime.date] = None) -> Decimal:
    """PER-5: hoje se o período contém hoje; fim do período se já passou; fim do
    período menos as cobranças projetadas se ainda não começou."""
    today = today or datetime.date.today()
    if period.start > today:
        projected = _sum(c.amount for c in projected_charges(db, today + datetime.timedelta(days=1), period.end))
        return account_balance.total_balance(db, until=period.last_day) - projected
    if period.last_day < today:
        return account_balance.total_balance(db, until=period.last_day)
    return account_balance.total_balance(db)


def is_projection(period: Period, today: Optional[datetime.date] = None) -> bool:
    return period.start > (today or datetime.date.today())
