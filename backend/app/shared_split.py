"""Divisão igualitária de uma despesa compartilhada (D-Shared-3).

Função pura, no espírito de `periods.py` e `installment_metrics.py`: é a regra
que mais precisa ser exata, e a que o banco não garante — nenhuma constraint
impede as partes de somarem diferente do total.

A conta é em **centavos inteiros**, não em `Decimal` dividido: `100 / 3` em
`Decimal` dá uma dízima de 28 dígitos que teria de ser arredondada, e
arredondar cada parte independentemente perde ou inventa centavo. Em inteiros,
a sobra é explícita e tem dono.
"""

from decimal import Decimal
from typing import Dict, Sequence

CENT = Decimal("0.01")


class PartBelowOneCent(ValueError):
    """O total não dá um centavo a cada participante."""


def split_equally(total: Decimal, creator: str, others: Sequence[str]) -> Dict[str, Decimal]:
    """Parte de cada participante, com a sobra de centavo para o criador.

    `R$ 100 ÷ 3` → criador 33,34, os outros 33,33. A sobra vai sempre para o
    criador para que a mesma divisão dê sempre o mesmo resultado — a resposta
    da API recalcula as partes por aqui, sem ler o ledger de outros donos.

    Invariante: `sum(partes) == total`, exato.
    """
    cents = int((total / CENT).to_integral_value())
    if Decimal(cents) * CENT != total:
        raise ValueError(f"total com mais de duas casas: {total}")

    count = 1 + len(others)
    base, leftover = divmod(cents, count)
    if base < 1:
        raise PartBelowOneCent(f"R$ {total} não dá um centavo a cada um dos {count} participantes")

    parts = {email: Decimal(base) * CENT for email in others}
    parts[creator] = Decimal(base + leftover) * CENT
    return parts
