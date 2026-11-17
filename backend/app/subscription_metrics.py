"""Métricas de assinatura — a regra de "ativa" em um lugar só (R-7).

Usada pelo Dashboard e por `GET /subscriptions/summary`. Duplicar a regra é como a
mesma métrica passaria a ter dois valores no mesmo app (a lição de
`installment_metrics.py`).

Ativa = ainda vai cobrar: `next_charge_date` não nulo. Uma assinatura de primeira
cobrança futura é ativa, como o parcelamento que ainda não começou.
"""

import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.orm import Session

from app import models
from app.subscription_schedule import next_charge_date

ZERO = Decimal("0.00")


def active_subscriptions(
    db: Session, today: Optional[datetime.date] = None
) -> List[models.Subscription]:
    """As assinaturas do dono da sessão que ainda vão cobrar."""
    today = today or datetime.date.today()
    return [
        s for s in db.query(models.Subscription).all()
        if next_charge_date(s.first_charge_date, today, s.ended_on) is not None
    ]


def monthly_amount(subscriptions: List[models.Subscription]) -> Decimal:
    """Soma exata, em `Decimal`, do que as assinaturas cobram por mês."""
    return sum((s.amount for s in subscriptions), ZERO)
