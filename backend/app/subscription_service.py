"""Lançamento das cobranças de assinatura que já venceram (R-3).

Uma função só serve ao `POST /subscriptions`, ao `PATCH` e ao `POST
/subscriptions/sync`. Não faz commit: o chamador decide a transação de banco.

Só lança o que tem data **até hoje**. Cobrança futura nunca vira linha: o saldo
(S-1) e as despesas do mês só veem o que já aconteceu.
"""

import datetime

from sqlalchemy.orm import Session

from app import models
from app.subscription_schedule import charge_dates


def post_due_charges(db: Session, subscription: models.Subscription, today: datetime.date) -> int:
    """Lança uma SAÍDA por cobrança depois de `charged_through` e até hoje.

    Avança o cursor só quando lançou algo: com nada vencido ele fica onde está, e
    uma assinatura de primeira cobrança futura continua com cursor nulo.

    Devolve quantas cobranças lançou.
    """
    due = charge_dates(
        subscription.first_charge_date,
        today,
        after=subscription.charged_through,
        ended_on=subscription.ended_on,
    )
    for day in due:
        db.add(models.Transaction(
            owner_id=subscription.owner_id,
            title=subscription.title,
            type="SAÍDA",
            amount=subscription.amount,
            date=day,
            category_id=subscription.category_id,
            is_fixed=True,
            account_id=subscription.account_id,
            subscription_id=subscription.id,
        ))
    if due:
        subscription.charged_through = due[-1]
    return len(due)
