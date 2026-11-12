"""installment schedule: transactions.installment_number e installments.first_due_date

Revision ID: e5c1a9b47d20
Revises: d3a8f1e6c720
Create Date: 2026-11-11

Decisão P-7 em `docs/design-patterns.md` → "Parcelamento gera as próprias
transações". Só schema, as duas colunas nulas: nenhuma linha existente muda,
então não pede `-x owner_email` e aplica igual em banco vazio ou com dado.

Os parcelamentos que já existem **não** ganham parcelas aqui: sem data de
início, o mês de cada uma seria inferido do rótulo `end_date`. Ficam com
`first_due_date` nulo (sem cronograma) e são corrigidos excluindo e recriando.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5c1a9b47d20"
down_revision: Union[str, Sequence[str], None] = "d3a8f1e6c720"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("installment_number", sa.Integer(), nullable=True))

    with op.batch_alter_table("installments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("first_due_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("installments", schema=None) as batch_op:
        batch_op.drop_column("first_due_date")

    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_column("installment_number")
