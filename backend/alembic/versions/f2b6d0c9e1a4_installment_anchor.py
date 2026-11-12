"""installment anchor: installments.anchor_due_date

Revision ID: f2b6d0c9e1a4
Revises: e5c1a9b47d20
Create Date: 2026-11-12

S-3 e S-4 em `docs/design-patterns.md` → "Saldo até hoje, saldo comprometido e
parcela atual pela data". Só schema, coluna nula: nenhuma linha muda e nada é
apagado. Parcelamento sem âncora fica no modo antigo (parcela atual gravada).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2b6d0c9e1a4"
down_revision: Union[str, Sequence[str], None] = "e5c1a9b47d20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("installments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("anchor_due_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("installments", schema=None) as batch_op:
        batch_op.drop_column("anchor_due_date")
