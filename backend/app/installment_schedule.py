"""Cronograma de parcelamento — funções puras, sem banco.

Decisão em `docs/design-patterns.md` → "Parcelamento gera as próprias
transações" (P-3 e P-4). Uma função só serve ao cadastro (`POST
/installments`) e à pré-visualização (`POST /installments/preview`): o que a
tela mostra antes de salvar é, por construção, o que vai ser gravado.

Toda a conta é em `Decimal` com centavos inteiros. O front não divide dinheiro.
"""

import calendar
import datetime
from dataclasses import dataclass
from decimal import Decimal
from typing import List, Optional

CENT = Decimal("0.01")
MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
                "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def add_months(anchor: datetime.date, months: int) -> datetime.date:
    """`anchor` deslocada de `months` meses, com o dia limitado ao fim do mês.

    O dia vem sempre da **âncora**, nunca de uma data já limitada: 31/03 − 1
    mês dá 28/02, mas 31/03 + 1 dá 30/04, e não 28/04. Por isso toda parcela
    é calculada a partir da data da parcela atual, e não em cadeia.
    """
    index = anchor.year * 12 + (anchor.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return datetime.date(year, month, day)


def month_label(day: datetime.date) -> str:
    """Rótulo `"Ago/2026"` — o mesmo formato que `end_date` sempre teve."""
    return f"{MONTH_LABELS[day.month - 1]}/{day.year}"


def split_amounts(total: Decimal, count: int) -> List[Decimal]:
    """`total` em `count` parcelas que somam **exatamente** `total`.

    Centavos inteiros: `base = ⌊total/count⌋`, e os centavos que sobram vão um
    em cada parcela, a partir da primeira (100,00 / 3 = 33,34 + 33,33 + 33,33).
    """
    cents = int((total / CENT).to_integral_value())
    base, leftover = divmod(cents, count)
    return [
        (Decimal(base + (1 if number < leftover else 0)) * CENT).quantize(CENT)
        for number in range(count)
    ]


@dataclass(frozen=True)
class Parcel:
    number: int
    date: datetime.date
    amount: Decimal


@dataclass(frozen=True)
class Schedule:
    total_amount: Decimal
    installment_amount: Decimal
    first_due_date: datetime.date
    end_date: str
    #: Só as parcelas de `current` a `total` — as que são geradas (P-2).
    parcels: List[Parcel]

    @property
    def remaining_amount(self) -> Decimal:
        return sum((p.amount for p in self.parcels), Decimal("0.00"))


def build_schedule(
    *,
    total_installments: int,
    current_installment: int,
    current_due_date: datetime.date,
    total_amount: Optional[Decimal] = None,
    installment_amount: Optional[Decimal] = None,
) -> Schedule:
    """Cronograma completo. Exatamente um de `total_amount`/`installment_amount`.

    A validação de faixa (1 ≤ current ≤ total ≤ 120, valores > 0 com 2 casas)
    é do schema; aqui só a regra que o schema não expressa.
    """
    if (total_amount is None) == (installment_amount is None):
        raise ValueError("Informe o valor total ou o valor da parcela, não os dois.")

    if total_amount is not None:
        amounts = split_amounts(total_amount, total_installments)
        total = total_amount.quantize(CENT)
        # A parcela regular é a menor: os centavos da sobra ficam nas primeiras.
        regular = amounts[-1]
    else:
        regular = installment_amount.quantize(CENT)
        amounts = [regular] * total_installments
        total = (regular * total_installments).quantize(CENT)

    parcels = [
        Parcel(
            number=number,
            date=add_months(current_due_date, number - current_installment),
            amount=amounts[number - 1],
        )
        for number in range(current_installment, total_installments + 1)
    ]

    return Schedule(
        total_amount=total,
        installment_amount=regular,
        first_due_date=add_months(current_due_date, 1 - current_installment),
        end_date=month_label(
            add_months(current_due_date, total_installments - current_installment)
        ),
        parcels=parcels,
    )


def remaining_from_schedule(
    *,
    total_amount: Decimal,
    total_installments: int,
    current_installment: int,
) -> Decimal:
    """Saldo a pagar exato de um parcelamento com cronograma.

    Mesma regra de sobra do cadastro, aplicada às parcelas de `current` em
    diante. Os limites cobrem o "quitado" da D13 (`current > total` → zero).
    """
    if current_installment > total_installments:
        return Decimal("0.00")
    start = max(current_installment, 1)
    amounts = split_amounts(total_amount, total_installments)
    return sum(amounts[start - 1:], Decimal("0.00"))
