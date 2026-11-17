"""subscriptions: tabela e transactions.subscription_id

Revision ID: a8d3f5c1b9e7
Revises: f2b6d0c9e1a4
Create Date: 2026-11-13

R-1 e R-3 em `docs/recorrencias.md`. Só schema, aditivo: tabela nova e coluna nula,
nenhuma linha existente muda e nada é apagado. Não pede `-x owner_email`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8d3f5c1b9e7"
down_revision: Union[str, Sequence[str], None] = "f2b6d0c9e1a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("first_charge_date", sa.Date(), nullable=False),
        sa.Column("ended_on", sa.Date(), nullable=True),
        sa.Column("charged_through", sa.Date(), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id", "owner_id"], ["accounts.id", "accounts.owner_id"],
            name="fk_subscriptions_account_owner", ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id", "owner_id"], ["categories.id", "categories.owner_id"],
            name="fk_subscriptions_category_owner", ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_subscriptions_owner_id_users", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("subscriptions", schema=None) as batch_op:
        batch_op.create_index("ix_subscriptions_id", ["id"], unique=False)
        batch_op.create_index("ix_subscriptions_category_id", ["category_id"], unique=False)
        batch_op.create_index("ix_subscriptions_owner_id", ["owner_id"], unique=False)

    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("subscription_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_transactions_subscription", "subscriptions",
            ["subscription_id"], ["id"], ondelete="SET NULL",
        )
        batch_op.create_index("ix_transactions_subscription_id", ["subscription_id"], unique=False)
        batch_op.create_unique_constraint(
            "uq_transactions_subscription_id_date", ["subscription_id", "date"]
        )


def downgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_constraint("uq_transactions_subscription_id_date", type_="unique")
        batch_op.drop_index("ix_transactions_subscription_id")
        batch_op.drop_constraint("fk_transactions_subscription", type_="foreignkey")
        batch_op.drop_column("subscription_id")

    with op.batch_alter_table("subscriptions", schema=None) as batch_op:
        batch_op.drop_index("ix_subscriptions_owner_id")
        batch_op.drop_index("ix_subscriptions_category_id")
        batch_op.drop_index("ix_subscriptions_id")
    op.drop_table("subscriptions")
