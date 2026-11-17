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


# ---------------------------------------------------------------------------
# Filtro de período (`docs/periodos.md`, PER-1 a PER-7)
# ---------------------------------------------------------------------------

import re
from dataclasses import dataclass
from typing import List, Optional

MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_YEAR_RE = re.compile(r"^\d{4}$")
# Intervalo entre meses, extremos incluídos: `2026-03..2026-08` (PER-9).
_RANGE_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])\.\.(\d{4})-(0[1-9]|1[0-2])$")
MAX_RANGE_MONTHS = 120
# Janelas que terminam no mês corrente (atalhos 3M / 6M / 1A do seletor).
TRAILING_WINDOWS = (3, 6, 12)
MIN_YEAR, MAX_YEAR = 1900, 2200
TREND_MONTHS = 6


class InvalidPeriod(ValueError):
    pass


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


@dataclass(frozen=True)
class Period:
    """Período escolhido. `end` é **exclusivo**; `chart` são os meses do gráfico."""

    key: str
    kind: str  # "month" | "year" | "trailing" | "range" | "all"
    start: datetime.date
    end: datetime.date
    chart: List[tuple[int, int]]
    months_in_period: int

    @property
    def last_day(self) -> datetime.date:
        return self.end - datetime.timedelta(days=1)


def _trailing(year: int, month: int, count: int) -> List[tuple[int, int]]:
    return [shift_month(year, month, -(count - 1 - i)) for i in range(count)]


def parse_period(
    raw: Optional[str],
    first_month: Optional[tuple[int, int]] = None,
    today: Optional[datetime.date] = None,
) -> Period:
    """`YYYY-MM`, `YYYY`, `YYYY-MM..YYYY-MM`, `3m`, `6m`, `12m` ou `all`; ausente = mês corrente. Outro valor levanta
    `InvalidPeriod`. `first_month` (mês do lançamento mais antigo) só serve ao `all`."""
    today = today or datetime.date.today()
    current = (today.year, today.month)

    if raw is None:
        raw = month_key(*current)

    trailing = re.fullmatch(r"(\d+)m", raw)
    if trailing and int(trailing.group(1)) in TRAILING_WINDOWS:
        count = int(trailing.group(1))
        start, end = trailing_months_bounds(count)
        return Period(raw, "trailing", start, end, _trailing(*current, count), count)

    if raw == "all":
        first = min(first_month or current, current)
        months: List[tuple[int, int]] = []
        cursor = first
        while cursor <= current:
            months.append(cursor)
            cursor = shift_month(*cursor, 1)
        start, _ = month_bounds(*first)
        _, end = month_bounds(*current)
        return Period("all", "all", start, end, months, len(months))

    span = _RANGE_RE.match(raw)
    if span:
        first = (int(span.group(1)), int(span.group(2)))
        last = (int(span.group(3)), int(span.group(4)))
        if not (MIN_YEAR <= first[0] <= MAX_YEAR and MIN_YEAR <= last[0] <= MAX_YEAR):
            raise InvalidPeriod(raw)
        if last < first:
            raise InvalidPeriod(raw)
        months: List[tuple[int, int]] = []
        cursor = first
        while cursor <= last:
            months.append(cursor)
            cursor = shift_month(*cursor, 1)
            if len(months) > MAX_RANGE_MONTHS:
                raise InvalidPeriod(raw)
        start, _ = month_bounds(*first)
        _, end = month_bounds(*last)
        return Period(raw, "range", start, end, months, len(months))

    match = _MONTH_RE.match(raw)
    if match:
        year, month = int(match.group(1)), int(match.group(2))
        if not MIN_YEAR <= year <= MAX_YEAR:
            raise InvalidPeriod(raw)
        start, end = month_bounds(year, month)
        return Period(raw, "month", start, end, _trailing(year, month, TREND_MONTHS), 1)

    if _YEAR_RE.match(raw):
        year = int(raw)
        if not MIN_YEAR <= year <= MAX_YEAR:
            raise InvalidPeriod(raw)
        return Period(
            raw, "year", datetime.date(year, 1, 1), datetime.date(year + 1, 1, 1),
            [(year, m) for m in range(1, 13)], 12,
        )

    raise InvalidPeriod(raw)
