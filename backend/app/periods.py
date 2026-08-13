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


def trailing_months_bounds(months: int) -> tuple[datetime.date, datetime.date]:
    """Janela semiaberta cobrindo os últimos `months` meses, **incluindo o corrente**.

    `trailing_months_bounds(6)` devolve `[primeiro dia de 5 meses atrás,
    primeiro dia do mês seguinte)` — exatamente o intervalo que o laço do
    `monthly_flow` percorre bucket a bucket.

    Existe para o relatório: `total_revenues`/`total_expenses` vinham da soma
    dos 6 buckets, mas `top_categories` não tinha recorte nenhum, e as duas
    metades do mesmo relatório falavam de períodos diferentes.
    """
    today = datetime.date.today()
    month = today.month - (months - 1)
    year = today.year
    while month <= 0:
        month += 12
        year -= 1

    start, _ = month_bounds(year, month)
    _, end = current_month_bounds()
    return start, end
