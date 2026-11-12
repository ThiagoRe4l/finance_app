"""installment anchor: installments.anchor_due_date

Revision ID: f2b6d0c9e1a4
Revises: e5c1a9b47d20
Create Date: 2026-11-12

S-3 e S-4 em `docs/design-patterns.md` → "Saldo até hoje, saldo comprometido e
parcela atual pela data". Só schema, coluna nula: nenhuma linha muda e nada é
apagado. Parcelamento sem âncora fica no modo antigo (parcela atual gravada).
"""
import calendar
import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2b6d0c9e1a4"
down_revision: Union[str, Sequence[str], None] = "e5c1a9b47d20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_months(day: datetime.date, months: int) -> datetime.date:
    # Cópia de `app.installment_schedule.add_months`: migration não importa a
    # aplicação (o código dela muda, a migration não pode mudar junto).
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    return datetime.date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def upgrade() -> None:
    with op.batch_alter_table("installments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("anchor_due_date", sa.Date(), nullable=True))

    # Backfill (revisão de 12/11/2026): parcelamento criado entre a P-1 e a S-3
    # já tem `first_due_date` e parcelas geradas, mas ficaria no modo antigo para
    # sempre. A âncora é a data da parcela `current_installment`. Sem
    # `first_due_date` (o modo antigo de verdade), nada muda.
    connection = op.get_bind()
    rows = connection.execute(sa.text(
        "SELECT id, first_due_date, current_installment FROM installments "
        "WHERE first_due_date IS NOT NULL"
    )).all()
    for row in rows:
        first = row.first_due_date
        if isinstance(first, str):
            first = datetime.date.fromisoformat(first)
        anchor = _add_months(first, max(row.current_installment, 1) - 1)
        connection.execute(
            sa.text("UPDATE installments SET anchor_due_date = :anchor WHERE id = :id"),
            {"anchor": anchor, "id": row.id},
        )


def downgrade() -> None:
    with op.batch_alter_table("installments", schema=None) as batch_op:
        batch_op.drop_column("anchor_due_date")
