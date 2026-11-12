"""owner per row: users, owner_id e FKs compostas

Revision ID: b7d41c2e9a05
Revises: 96fdc067f386
Create Date: 2026-10-03

Decisões D-Tenant-1, 2 e 6 do CLAUDE.md. **Escrita à mão, não por
`--autogenerate`**: há migração de dados no meio, e a ordem dos passos importa
(o pai precisa de `UNIQUE(id, owner_id)` antes de o filho apontar para ele).

Num passo só, sem expand/contract (decidido em 03/10/2026). A janela entre
esta migration e o deploy do código novo é aceita: o código antigo não
preenche `owner_id` e recebe 500 nesse intervalo.

Como rodar contra um banco com dado
-----------------------------------
    alembic -x owner_email=<e-mail do dono dos dados> upgrade head

O e-mail **não** fica no repositório — mesmo motivo de a allowlist não ser
hardcoded (D-Auth-2). Com dado e sem o argumento, a migration levanta antes de
tocar em qualquer coisa. Em banco vazio (a suíte, um dev novo), dispensável.

Antes de aplicar em produção: o roteiro de backup da D-Tenant-6 (branch do Neon
+ `pg_dump`, restore exercitado, ensaio num branch, contagem antes/depois).
"""
import os
import warnings
from typing import Optional, Sequence, Union

from alembic import context, op
import sqlalchemy as sa


revision: str = "b7d41c2e9a05"
down_revision: Union[str, Sequence[str], None] = "96fdc067f386"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tabelas que ganham dono. `investment_history` herda pelo investimento.
PARENTS = ("accounts", "categories", "investments")
CHILDREN = ("installments", "transactions")
OWNED = PARENTS + CHILDREN

# ⚠️ As FKs da migration inicial **não têm nome**. O Postgres as batizou
# `<tabela>_<coluna>_fkey`; o SQLite não guarda nome nenhum. Esta convenção faz o
# modo batch do SQLite reconstruí-las com o **mesmo** nome que o Postgres usa,
# e assim um único `drop_constraint` funciona nos dois bancos.
LEGACY_FK_NAMING = {"fk": "%(table_name)s_%(column_0_name)s_fkey"}


def _owner_email() -> Optional[str]:
    raw = context.get_x_argument(as_dictionary=True).get("owner_email")
    if raw is None or not raw.strip():
        return None
    # Minúsculo: a allowlist e a sessão comparam assim (D-Auth-2). Um dono
    # gravado com maiúscula nunca casaria com quem faz login.
    return raw.strip().lower()


def _check_owner_in_allowlist(owner_email: str) -> None:
    """O dono informado tem que estar em `AUTH_ALLOWED_EMAILS` (05/10/2026).

    Pega o erro mais caro desta migration: um `-x owner_email` que não é o
    e-mail que o dono usa no Google. O dado ficaria preso a um usuário que
    ninguém loga, e o dono entraria num app vazio.

    * **Variável definida** (mesmo vazia) → o e-mail tem que constar, ou a
      migration levanta antes de qualquer DDL. Vazia é a allowlist que não deixa
      ninguém entrar (D-Auth-2), e o dono também não está nela.
    * **Variável ausente** → não há com o que comparar. Não bloqueia, mas avisa.

    ⚠️ A variável vem do shell **ou do `backend/.env.local`**, que o `env.py`
    carrega ao importar `app.settings` (`override=False`: o shell vence). Para
    conferir contra a allowlist de produção, exporte a da Vercel no shell —
    senão vale a do arquivo local, que pode estar desatualizada.

    A comparação é feita aqui, e não por `app.settings.resolve_allowed_emails`:
    migration que importa código da aplicação quebra quando esse código muda
    depois. Mesma regra, em uma linha: minúsculo, `strip`, itens vazios fora.
    """
    raw = os.environ.get("AUTH_ALLOWED_EMAILS")
    if raw is None:
        warnings.warn(
            "AUTH_ALLOWED_EMAILS não está definida neste ambiente: o "
            "-x owner_email NÃO foi conferido contra a allowlist. Confira à mão "
            "que ele é o e-mail que o dono usa no Google.",
            UserWarning,
            stacklevel=2,
        )
        return

    allowed = {item.strip().lower() for item in raw.split(",") if item.strip()}
    if owner_email not in allowed:
        raise RuntimeError(
            f"-x owner_email não está em AUTH_ALLOWED_EMAILS ({len(allowed)} e-mail(s) "
            "na lista lida do shell ou do backend/.env.local). Com um dono fora da "
            "allowlist, ninguém conseguiria entrar para ver os dados migrados."
        )


def _has_data(bind) -> bool:
    for table in OWNED + ("investment_history",):
        if bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first():
            return True
    return False


def _add_owner_constraints(batch_op, table: str) -> None:
    batch_op.alter_column("owner_id", existing_type=sa.Integer(), nullable=False)
    batch_op.create_foreign_key(
        f"fk_{table}_owner_id_users", "users", ["owner_id"], ["id"], ondelete="RESTRICT"
    )
    batch_op.create_index(f"ix_{table}_owner_id", ["owner_id"], unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    owner_email = _owner_email()

    # 🔴 Fail closed, e **antes** de qualquer DDL: dado sem dono informado não é
    # atribuído a ninguém, e o schema não fica pela metade.
    if _has_data(bind) and owner_email is None:
        raise RuntimeError(
            "Há dados financeiros sem dono. Informe a quem eles pertencem: "
            "alembic -x owner_email=<e-mail> upgrade head"
        )
    if owner_email is not None:
        _check_owner_in_allowlist(owner_email)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.create_index("ix_users_email", ["email"], unique=True)

    # 1. Coluna nula primeiro: há linha existente, e ela ainda não tem dono.
    for table in OWNED:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))

    # 2. Preenchimento.
    if owner_email is not None:
        bind.execute(sa.text("INSERT INTO users (email) VALUES (:email)"), {"email": owner_email})
        owner_id = bind.execute(
            sa.text("SELECT id FROM users WHERE email = :email"), {"email": owner_email}
        ).scalar_one()
        for table in OWNED:
            bind.execute(sa.text(f"UPDATE {table} SET owner_id = :owner"), {"owner": owner_id})

    # 3. Pais: dono obrigatório, nome único por dono, e o alvo das FKs compostas.
    for table in PARENTS:
        with op.batch_alter_table(table, schema=None) as batch_op:
            _add_owner_constraints(batch_op, table)
            batch_op.drop_index(f"ix_{table}_name")
            batch_op.create_unique_constraint(f"uq_{table}_owner_id_name", ["owner_id", "name"])
            if table != "investments":
                batch_op.create_unique_constraint(f"uq_{table}_id_owner_id", ["id", "owner_id"])

    # 4. Filhos: as FKs simples de conta e categoria viram compostas.
    #    `installment_id` fica simples — ver o comentário em `models.Transaction`.
    for table in CHILDREN:
        with op.batch_alter_table(table, schema=None, naming_convention=LEGACY_FK_NAMING) as batch_op:
            _add_owner_constraints(batch_op, table)
            batch_op.drop_constraint(f"{table}_account_id_fkey", type_="foreignkey")
            batch_op.drop_constraint(f"{table}_category_id_fkey", type_="foreignkey")
            batch_op.create_foreign_key(
                f"fk_{table}_account_owner", "accounts",
                ["account_id", "owner_id"], ["id", "owner_id"], ondelete="CASCADE",
            )
            batch_op.create_foreign_key(
                f"fk_{table}_category_owner", "categories",
                ["category_id", "owner_id"], ["id", "owner_id"], ondelete="RESTRICT",
            )


def downgrade() -> None:
    bind = op.get_bind()

    # Com dois donos, voltar ao `UNIQUE(name)` global pode colidir — a
    # "Moradia" de cada um. Recusar é melhor que perder uma das duas.
    owners = bind.execute(sa.text("SELECT COUNT(*) FROM users")).scalar()
    if owners > 1:
        raise RuntimeError(
            f"downgrade recusado: há {owners} donos, e o schema anterior só comporta um."
        )

    for table in CHILDREN:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_constraint(f"fk_{table}_account_owner", type_="foreignkey")
            batch_op.drop_constraint(f"fk_{table}_category_owner", type_="foreignkey")
            batch_op.drop_constraint(f"fk_{table}_owner_id_users", type_="foreignkey")
            batch_op.drop_index(f"ix_{table}_owner_id")
            batch_op.create_foreign_key(
                f"{table}_account_id_fkey", "accounts", ["account_id"], ["id"], ondelete="CASCADE"
            )
            batch_op.create_foreign_key(
                f"{table}_category_id_fkey", "categories", ["category_id"], ["id"], ondelete="RESTRICT"
            )
            batch_op.drop_column("owner_id")

    for table in PARENTS:
        with op.batch_alter_table(table, schema=None) as batch_op:
            if table != "investments":
                batch_op.drop_constraint(f"uq_{table}_id_owner_id", type_="unique")
            batch_op.drop_constraint(f"uq_{table}_owner_id_name", type_="unique")
            batch_op.drop_constraint(f"fk_{table}_owner_id_users", type_="foreignkey")
            batch_op.drop_index(f"ix_{table}_owner_id")
            batch_op.create_index(f"ix_{table}_name", ["name"], unique=True)
            batch_op.drop_column("owner_id")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index("ix_users_email")
    op.drop_table("users")
