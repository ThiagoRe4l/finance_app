"""Saldo de conta derivado do ledger.

`Account.current_balance` era coluna mutável e cada caminho de escrita
precisava lembrar de ajustá-la. A regra passa a ser calculada na leitura:

    saldo = initial_balance + SUM(ENTRADA) − SUM(SAÍDA)

**Sem recorte de data.** Saldo é acumulado por definição, ao contrário de
`spent` em `categories.py`, que é do mês corrente. Um gasto de meses atrás
continua descontado e um lançamento futuro já conta.

Este módulo existe pelo mesmo motivo de `installment_metrics.py`: a regra tem
dois consumidores (`GET /accounts` e o `total_balance` do dashboard) e duplicar
o `CASE` é como o sinal de ENTRADA/SAÍDA inverteria de um lado só, com a mesma
métrica passando a ter dois valores no mesmo app.
"""

from decimal import Decimal
from typing import Optional

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app import models

# `Decimal("0.00")` e não `Decimal(0)`: a escala faz parte do contrato, e
# misturar este fallback com `0.0` float levanta TypeError na primeira soma.
ZERO = Decimal("0.00")


def ledger_delta():
    """Efeito de uma transação no saldo: `+amount` na entrada, `−amount` na saída.

    Expressão SQL, não valor — serve tanto ao agrupamento por conta quanto ao
    total do dashboard.
    """
    return case(
        (models.Transaction.type == "ENTRADA", models.Transaction.amount),
        (models.Transaction.type == "SAÍDA", -models.Transaction.amount),
        else_=ZERO,
    )


def accounts_with_balance(db: Session, account_id: Optional[int] = None):
    """Contas com o movimento do ledger já somado no banco.

    Devolve tuplas `(Account, ledger)`; o saldo exibido é
    `account.initial_balance + ledger`.

    ⚠️ **O join é OUTER.** Conta sem transação nenhuma tem que aparecer com o
    saldo inicial — com `INNER JOIN` ela sumiria da listagem, mesmo motivo pelo
    qual `_aggregated_rows` em `categories.py` também usa OUTER.

    O `coalesce` é o par disso: sem ele a conta sem movimento traria `NULL` e o
    saldo viraria `null` no JSON em vez de `initial_balance`.
    """
    ledger = func.coalesce(func.sum(ledger_delta()), ZERO).label("ledger")

    query = db.query(models.Account, ledger).outerjoin(
        models.Transaction,
        models.Transaction.account_id == models.Account.id,
    )

    if account_id is not None:
        query = query.filter(models.Account.id == account_id)

    return query.group_by(models.Account.id).order_by(models.Account.id).all()
