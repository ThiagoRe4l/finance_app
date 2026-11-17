"""Calendário de cobrança da assinatura — funções puras, sem banco (R-2).

Decisão em `docs/recorrencias.md`. A cobrança k cai em `add_months(first, k)`, com o
dia limitado ao fim do mês e a âncora sempre na primeira cobrança (31/01 → 28/02 →
31/03). Não há lista de cobranças guardada: ela é calculada daqui.
"""

import datetime
from typing import List, Optional

from app.installment_schedule import add_months


def charge_dates(
    first_charge_date: datetime.date,
    through: datetime.date,
    *,
    after: Optional[datetime.date] = None,
    ended_on: Optional[datetime.date] = None,
) -> List[datetime.date]:
    """Datas de cobrança com `after < data <= through`, em ordem.

    `after` nulo = sem piso além da primeira cobrança. Nenhuma data passa de
    `ended_on`, que é inclusivo. O laço termina pelo limite de data, nunca por uma
    contagem: a assinatura não tem fim próprio.
    """
    limit = through if ended_on is None else min(through, ended_on)
    dates: List[datetime.date] = []
    k = 0
    while True:
        day = add_months(first_charge_date, k)
        if day > limit:
            return dates
        if after is None or day > after:
            dates.append(day)
        k += 1


def next_charge_date(
    first_charge_date: datetime.date,
    today: datetime.date,
    ended_on: Optional[datetime.date] = None,
) -> Optional[datetime.date]:
    """Primeira cobrança **depois de hoje**; nula se a assinatura já terá acabado.

    Pula direto para perto de hoje em vez de andar desde a primeira cobrança: uma
    assinatura de 10 anos não custa 120 iterações a cada leitura.
    """
    months_gap = (today.year * 12 + today.month) - (first_charge_date.year * 12 + first_charge_date.month)
    k = max(0, months_gap - 1)
    day = add_months(first_charge_date, k)
    while day <= today:
        k += 1
        day = add_months(first_charge_date, k)
    if ended_on is not None and day > ended_on:
        return None
    return day
