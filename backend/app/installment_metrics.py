"""Regra de agregação de parcelamentos, compartilhada entre routers.

Existe pelo mesmo motivo de `periods.py`: `dashboard.py` e
`routers/installments.py` precisam da **mesma** definição de "ativo", e
duplicá-la é como o `<=` frágil do dia 4.3 viraria `<` de um lado só — a mesma
métrica passando a ter dois valores no mesmo app, ambos plausíveis.
"""

from decimal import Decimal
from typing import List

from sqlalchemy.orm import Session

from app import models
from app.installment_schedule import remaining_from_schedule

ZERO = Decimal("0.00")


def active_installments(db: Session) -> List[models.Installment]:
    """Parcelamentos que ainda têm parcela a pagar.

    ⚠️ O `<=` é a parte frágil. `current == total` é a **última parcela**,
    ainda a pagar; quitado começa em `total + 1`. Trocar por `<` derruba o mês
    final de todo parcelamento do app, e o número continua parecendo plausível.
    Ver `test_last_installment_counts_as_active_in_both`.
    """
    return db.query(models.Installment).filter(
        models.Installment.current_installment <= models.Installment.total_installments
    ).all()


def remaining_installment_count(installment: models.Installment) -> int:
    """Quantas parcelas ainda faltam pagar.

    O `+1` vem da D13: `current` é a parcela **ainda a pagar**, então 2/12 tem
    11 pela frente. Para um quitado (13/12) a conta dá zero naturalmente, sem
    caso especial.

    Os limites cobrem estados que o schema não impede: `current` acima do total
    (quitado, e bem além dele) não pode gerar contagem negativa, e `current`
    abaixo de 1 não pode gerar mais parcelas do que o parcelamento tem.
    """
    pending = installment.total_installments - installment.current_installment + 1
    return max(0, min(pending, installment.total_installments))


def remaining_amount(installment: models.Installment) -> Decimal:
    """Quanto ainda falta pagar deste parcelamento.

    Campo derivado exposto em `InstallmentResponse` — **exceção declarada ao
    padrão de serialização direta do ORM**, mesma natureza de `spent`/`txs_count`
    em `categories.py`.

    Com cronograma (`first_due_date` preenchido, P-4) é a **soma exata** das
    parcelas restantes pela regra de sobra do cadastro: `parcela × restantes`
    erraria o centavo que ficou nas primeiras (100,00 / 3 → 33,34 + 33,33 +
    33,33). Sem cronograma, os parcelamentos antigos, a fórmula é a de sempre.
    """
    if installment.first_due_date is not None:
        return remaining_from_schedule(
            total_amount=installment.total_amount,
            total_installments=installment.total_installments,
            current_installment=installment.current_installment,
        )
    return installment.installment_amount * remaining_installment_count(installment)


def monthly_committed(installments: List[models.Installment]) -> Decimal:
    """Soma das parcelas mensais. `start` explícito: sem ele uma lista vazia
    devolveria `int 0` e a conta seguinte misturaria tipos."""
    return sum((it.installment_amount for it in installments), ZERO)


def remaining_total(installments: List[models.Installment]) -> Decimal:
    return sum((remaining_amount(it) for it in installments), ZERO)
