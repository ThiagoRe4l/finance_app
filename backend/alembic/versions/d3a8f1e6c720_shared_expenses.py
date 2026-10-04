"""shared expenses: grupo, participantes e transactions.shared_expense_id

Revision ID: d3a8f1e6c720
Revises: b7d41c2e9a05
Create Date: 2026-10-04

Decisões D-Shared-2 e D-Shared-9 do CLAUDE.md. Só schema: nenhuma linha
existente muda, então esta migration não pede `-x owner_email` e aplica igual
em banco vazio ou com dado.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d3a8f1e6c720"
down_revision: Union[str, Sequence[str], None] = "b7d41c2e9a05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shared_expenses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("creator_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(
            ["creator_id"], ["users.id"], name="fk_shared_expenses_creator", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("shared_expenses", schema=None) as batch_op:
        batch_op.create_index("ix_shared_expenses_id", ["id"], unique=False)

    op.create_table(
        "shared_expense_participants",
        sa.Column("shared_expense_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["shared_expense_id"], ["shared_expenses.id"],
            name="fk_participants_shared_expense", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_participants_user", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("shared_expense_id", "user_id"),
    )
    with op.batch_alter_table("shared_expense_participants", schema=None) as batch_op:
        batch_op.create_index("ix_shared_expense_participants_user_id", ["user_id"], unique=False)

    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("shared_expense_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_transactions_shared_expense", "shared_expenses",
            ["shared_expense_id"], ["id"], ondelete="CASCADE",
        )
        batch_op.create_index("ix_transactions_shared_expense_id", ["shared_expense_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_index("ix_transactions_shared_expense_id")
        batch_op.drop_constraint("fk_transactions_shared_expense", type_="foreignkey")
        batch_op.drop_column("shared_expense_id")

    with op.batch_alter_table("shared_expense_participants", schema=None) as batch_op:
        batch_op.drop_index("ix_shared_expense_participants_user_id")
    op.drop_table("shared_expense_participants")

    with op.batch_alter_table("shared_expenses", schema=None) as batch_op:
        batch_op.drop_index("ix_shared_expenses_id")
    op.drop_table("shared_expenses")
