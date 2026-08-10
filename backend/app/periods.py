"""Limites de período usados pelas agregações.

Existe para que `categories.py` e `dashboard.py` usem **o mesmo** recorte. Antes
havia duas convenções convivendo: o laço do `monthly_flow` usava o intervalo
semiaberto correto, e `total_revenues`/`total_expenses` usavam `date >= first_day`
sem teto — então um lançamento datado no futuro contava num e não no outro, com
os dois números lado a lado na mesma tela.
"""

import datetime


def month_bounds(year: int, month: int) -> tuple[datetime.date, datetime.date]:
    """Intervalo **semiaberto** `[primeiro dia, primeiro dia do mês seguinte)`.

    Semiaberto e não fechado: com `<=` no limite superior, o primeiro dia do mês
    seguinte contaria em dois meses ao mesmo tempo.
    """
    start = datetime.date(year, month, 1)
    if month == 12:
        end = datetime.date(year + 1, 1, 1)
    else:
        end = datetime.date(year, month + 1, 1)
    return start, end


def current_month_bounds() -> tuple[datetime.date, datetime.date]:
    today = datetime.date.today()
    return month_bounds(today.year, today.month)
