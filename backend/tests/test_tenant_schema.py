"""Fatia 1 — `users`, `owner_id` e a migration (D-Tenant-1, 2 e 6).

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Estes testes são de **schema**, não de API: a pergunta aqui é se o banco
guarda o dono e se recusa sozinho o que não pode existir. O isolamento visto
pela API é a fatia 2 (`test_tenant_isolation.py`).

Os inserts são em SQL cru de propósito, pela mesma razão de
`test_fk_cascade.py`: pelo ORM, a regra testada seria a do código, não a do
banco. A FK composta só vale alguma coisa se o **banco** a aplicar.

Por que vermelho hoje
---------------------
O schema está na revisão inicial: não há `users` nem `owner_id`. Os testes de
inspeção falham por coluna/tabela ausente; os de migration falham porque
`upgrade head` não chega a criar nada.
"""

import argparse
import datetime

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool

from tests.conftest import BACKEND_DIR

INITIAL_REVISION = "96fdc067f386"

# As 5 tabelas que passam a ter dono direto. `investment_history` fica de fora
# de propósito: é filha com CASCADE e herda o dono pelo investimento.
OWNED_TABLES = ("accounts", "categories", "investments", "installments", "transactions")

# As que tinham `UNIQUE(name)` global e passam a `UNIQUE(owner_id, name)`.
NAMED_TABLES = ("accounts", "categories", "investments")


# ---------------------------------------------------------------------------
# Helpers de SQL cru
# ---------------------------------------------------------------------------

def _insert_user(db, user_id, email):
    db.execute(
        text("INSERT INTO users (id, email) VALUES (:id, :email)"),
        {"id": user_id, "email": email},
    )


def _insert_named(db, table, row_id, owner_id, name):
    """Linha mínima válida de uma das três tabelas com nome."""
    columns = {
        "accounts": {"initial_balance": 0},
        "categories": {"icon_name": "Home", "budget": 0, "color": "oklch(0.5 0 0)"},
        "investments": {"current_balance": 0},
    }[table]
    values = {"id": row_id, "owner_id": owner_id, "name": name, **columns}
    names = ", ".join(values)
    params = ", ".join(f":{k}" for k in values)
    db.execute(text(f"INSERT INTO {table} ({names}) VALUES ({params})"), values)


def _insert_transaction(db, row_id, owner_id, account_id, category_id):
    db.execute(
        text(
            "INSERT INTO transactions "
            "(id, title, type, amount, date, category_id, is_fixed, account_id, owner_id) "
            "VALUES (:id, 'x', 'SAÍDA', 10, :date, :category_id, false, :account_id, :owner_id)"
        ),
        {
            "id": row_id,
            "date": datetime.date.today(),
            "category_id": category_id,
            "account_id": account_id,
            "owner_id": owner_id,
        },
    )


def _insert_installment(db, row_id, owner_id, account_id, category_id):
    db.execute(
        text(
            "INSERT INTO installments "
            "(id, title, category_id, total_amount, installment_amount, "
            " current_installment, total_installments, end_date, account_id, owner_id) "
            "VALUES (:id, 'x', :category_id, 120, 10, 1, 12, 'Ago/2026', :account_id, :owner_id)"
        ),
        {"id": row_id, "category_id": category_id, "account_id": account_id, "owner_id": owner_id},
    )


def _two_users_with_one_account_and_category_each(db):
    """A (1) e B (2), cada um com conta e categoria próprias.

    Ids: conta/categoria 10 são de A, 20 são de B.
    """
    _insert_user(db, 1, "a@example.com")
    _insert_user(db, 2, "b@example.com")
    _insert_named(db, "accounts", 10, 1, "Conta A")
    _insert_named(db, "accounts", 20, 2, "Conta B")
    _insert_named(db, "categories", 10, 1, "Cat A")
    _insert_named(db, "categories", 20, 2, "Cat B")
    db.commit()


# ---------------------------------------------------------------------------
# D-Tenant-1: users
# ---------------------------------------------------------------------------

def test_users_table_exists_with_id_and_email(session):
    columns = {c["name"] for c in inspect(session.get_bind()).get_columns("users")}

    assert {"id", "email"} <= columns


def test_user_email_is_unique(fk_session):
    _insert_user(fk_session, 1, "a@example.com")
    fk_session.commit()

    with pytest.raises(IntegrityError):
        _insert_user(fk_session, 2, "a@example.com")
        fk_session.commit()
    fk_session.rollback()


# ---------------------------------------------------------------------------
# D-Tenant-2: owner_id
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("table", OWNED_TABLES)
def test_owned_table_has_a_non_nullable_owner(session, table):
    columns = {c["name"]: c for c in inspect(session.get_bind()).get_columns(table)}

    assert "owner_id" in columns, f"{table} sem owner_id"
    assert columns["owner_id"]["nullable"] is False, f"{table}.owner_id aceita NULL"


@pytest.mark.parametrize("table", OWNED_TABLES)
def test_owner_is_a_foreign_key_to_users(session, table):
    fks = inspect(session.get_bind()).get_foreign_keys(table)

    assert any(
        fk["referred_table"] == "users" and fk["constrained_columns"] == ["owner_id"]
        for fk in fks
    ), f"{table}.owner_id não referencia users: {fks}"


def test_investment_history_inherits_the_owner_instead_of_storing_it(session):
    """✅ **Já passa hoje** — regressão, não cobertura nova. Exceção declarada na D-Tenant-2: filha com CASCADE herda pelo pai.

    Uma coluna própria aqui seria um segundo lugar para o dono divergir do
    investimento.
    """
    columns = {c["name"] for c in inspect(session.get_bind()).get_columns("investment_history")}

    assert "owner_id" not in columns


@pytest.mark.parametrize("table", NAMED_TABLES)
def test_two_owners_can_use_the_same_name(fk_session, table):
    """🔴 Sem isto o segundo usuário não recebe as categorias padrão.

    "Moradia" já existiria — e o provisionamento (D-Tenant-5) morreria no
    primeiro login de quem não é o dono migrado.
    """
    _insert_user(fk_session, 1, "a@example.com")
    _insert_user(fk_session, 2, "b@example.com")
    _insert_named(fk_session, table, 1, 1, "Moradia")
    _insert_named(fk_session, table, 2, 2, "Moradia")
    fk_session.commit()

    count = fk_session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
    assert count == 2


@pytest.mark.parametrize("table", NAMED_TABLES)
def test_the_same_owner_cannot_repeat_a_name(fk_session, table):
    _insert_user(fk_session, 1, "a@example.com")
    _insert_named(fk_session, table, 1, 1, "Moradia")
    fk_session.commit()

    with pytest.raises(IntegrityError):
        _insert_named(fk_session, table, 2, 1, "Moradia")
        fk_session.commit()
    fk_session.rollback()


# ---------------------------------------------------------------------------
# D-Tenant-2: FK composta — o banco recusa referência cruzada
# ---------------------------------------------------------------------------

def test_transaction_cannot_point_to_another_owners_account(fk_session):
    """🔴 O terceiro defeito do mapeamento, fechado por construção.

    Transação de B (owner 2) na conta de A (10). Com FK simples em
    `account_id`, o banco aceita: a conta existe. Só a FK composta
    `(account_id, owner_id)` recusa.
    """
    _two_users_with_one_account_and_category_each(fk_session)

    with pytest.raises(IntegrityError):
        _insert_transaction(fk_session, 1, owner_id=2, account_id=10, category_id=20)
        fk_session.commit()
    fk_session.rollback()


def test_transaction_cannot_point_to_another_owners_category(fk_session):
    _two_users_with_one_account_and_category_each(fk_session)

    with pytest.raises(IntegrityError):
        _insert_transaction(fk_session, 1, owner_id=2, account_id=20, category_id=10)
        fk_session.commit()
    fk_session.rollback()


def test_installment_cannot_point_to_another_owners_account(fk_session):
    _two_users_with_one_account_and_category_each(fk_session)

    with pytest.raises(IntegrityError):
        _insert_installment(fk_session, 1, owner_id=2, account_id=10, category_id=20)
        fk_session.commit()
    fk_session.rollback()


def test_installment_cannot_point_to_another_owners_category(fk_session):
    _two_users_with_one_account_and_category_each(fk_session)

    with pytest.raises(IntegrityError):
        _insert_installment(fk_session, 1, owner_id=2, account_id=20, category_id=10)
        fk_session.commit()
    fk_session.rollback()


def test_same_owner_references_are_still_accepted(fk_session):
    """O par dos quatro acima: a FK composta não pode recusar o caso legítimo.

    Sem este, uma FK composta mal declarada (colunas trocadas, por exemplo)
    deixaria os quatro verdes recusando **tudo**.
    """
    _two_users_with_one_account_and_category_each(fk_session)

    _insert_transaction(fk_session, 1, owner_id=2, account_id=20, category_id=20)
    _insert_installment(fk_session, 1, owner_id=2, account_id=20, category_id=20)
    fk_session.commit()

    assert fk_session.execute(text("SELECT COUNT(*) FROM transactions")).scalar() == 1
    assert fk_session.execute(text("SELECT COUNT(*) FROM installments")).scalar() == 1


# ---------------------------------------------------------------------------
# D-Tenant-6: a migration de dados
#
# Engine próprio, sempre SQLite em memória: estes testes descem e sobem
# revisões, e fazer isso no banco compartilhado da suíte o deixaria num schema
# diferente para os testes seguintes. A migration contra Postgres com dado real
# é verificada pelo ensaio num branch do Neon (D-Tenant-6, passo 3).
# ---------------------------------------------------------------------------

@pytest.fixture(name="migration_engine")
def migration_engine_fixture():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    yield engine
    engine.dispose()


def _alembic(engine, action, revision, owner_email=None):
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    # É assim que `-x owner_email=...` da linha de comando chega ao env.py.
    config.cmd_opts = argparse.Namespace(
        x=[f"owner_email={owner_email}"] if owner_email is not None else []
    )

    with engine.begin() as connection:
        config.attributes["connection"] = connection
        getattr(command, action)(config, revision)


def _populate_initial_schema(engine):
    """Dado como existe hoje em produção: sem dono nenhum."""
    with engine.begin() as db:
        db.execute(text(
            "INSERT INTO accounts (id, name, initial_balance) VALUES (1, 'Conta Principal', 10000)"
        ))
        db.execute(text(
            "INSERT INTO categories (id, name, icon_name, budget, color) "
            "VALUES (1, 'Moradia', 'Home', 2500, 'oklch(0.45 0.04 235)')"
        ))
        db.execute(text(
            "INSERT INTO installments (id, title, category_id, total_amount, installment_amount, "
            "current_installment, total_installments, end_date, account_id) "
            "VALUES (1, 'Notebook', 1, 6000, 500, 2, 12, 'Ago/2026', 1)"
        ))
        db.execute(text(
            "INSERT INTO transactions "
            "(id, title, type, amount, date, category_id, is_fixed, account_id, installment_id) "
            "VALUES (1, 'Aluguel', 'SAÍDA', 1800.50, '2026-09-05', 1, true, 1, NULL), "
            "       (2, 'Parcela', 'SAÍDA', 500, '2026-09-10', 1, false, 1, 1)"
        ))
        db.execute(text(
            "INSERT INTO investments (id, name, current_balance) VALUES (1, 'Tesouro', 3000)"
        ))
        db.execute(text(
            "INSERT INTO investment_history (id, investment_id, date, balance) "
            "VALUES (1, 1, '2026-09-01', 2900)"
        ))


def _assert_migrated(engine):
    """Pré-condição: a migration de dono rodou de fato.

    Sem isto, os testes de preservação passam hoje por vacuidade — `upgrade
    head` não faz nada enquanto a revisão nova não existe, e "nada mudou" é
    trivialmente verdade. Verificado ao escrever: os dois ficaram verdes antes
    desta guarda.
    """
    columns = {c["name"] for c in inspect(engine).get_columns("accounts")}
    assert "owner_id" in columns, "a migration de dono não rodou"


def _counts(engine):
    tables = OWNED_TABLES + ("investment_history",)
    with engine.connect() as db:
        return {t: db.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() for t in tables}


def test_migration_assigns_every_existing_row_to_the_given_owner(migration_engine):
    """🔴 O dado real de produção não pode ficar sem dono nem sumir.

    O e-mail entra com espaço e maiúscula de propósito: ele é digitado à mão no
    terminal, e a allowlist compara em minúsculo (D-Auth-2). Um dono gravado
    como `Dono@Example.com` nunca casaria com a sessão.
    """
    _alembic(migration_engine, "upgrade", INITIAL_REVISION)
    _populate_initial_schema(migration_engine)
    before = _counts(migration_engine)

    _alembic(migration_engine, "upgrade", "head", owner_email="  Dono@Example.com ")

    with migration_engine.connect() as db:
        users = db.execute(text("SELECT id, email FROM users")).all()
        assert [u.email for u in users] == ["dono@example.com"]
        owner_id = users[0].id

        for table in OWNED_TABLES:
            owners = {
                row[0] for row in db.execute(text(f"SELECT DISTINCT owner_id FROM {table}"))
            }
            assert owners == {owner_id}, f"{table}: donos {owners}"

    assert _counts(migration_engine) == before


def test_migration_preserves_money_exactly(migration_engine):
    """Soma do ledger idêntica antes e depois — o saldo derivado não pode mudar."""
    _alembic(migration_engine, "upgrade", INITIAL_REVISION)
    _populate_initial_schema(migration_engine)

    with migration_engine.connect() as db:
        before = db.execute(text("SELECT SUM(amount) FROM transactions")).scalar()

    _alembic(migration_engine, "upgrade", "head", owner_email="dono@example.com")
    _assert_migrated(migration_engine)

    with migration_engine.connect() as db:
        after = db.execute(text("SELECT SUM(amount) FROM transactions")).scalar()

    assert after == before


def test_migration_refuses_populated_tables_without_an_owner(migration_engine):
    """🔴 Fail closed: dado existente sem dono informado não é atribuído a ninguém.

    O modo de falha do outro lado é a migration "dar um jeito" — um dono
    inventado, ou NULL que depois vira NOT NULL quebrado — com dado financeiro
    real no meio.
    """
    _alembic(migration_engine, "upgrade", INITIAL_REVISION)
    _populate_initial_schema(migration_engine)
    before = _counts(migration_engine)

    with pytest.raises(Exception, match="owner_email"):
        _alembic(migration_engine, "upgrade", "head")

    assert _counts(migration_engine) == before


def test_migration_on_an_empty_database_needs_no_owner(migration_engine):
    """A suíte e um dev novo sobem o schema sem argumento nenhum."""
    _alembic(migration_engine, "upgrade", "head")

    with migration_engine.connect() as db:
        assert db.execute(text("SELECT COUNT(*) FROM users")).scalar() == 0


def test_downgrade_with_a_single_owner_keeps_the_data(migration_engine):
    _alembic(migration_engine, "upgrade", INITIAL_REVISION)
    _populate_initial_schema(migration_engine)
    before = _counts(migration_engine)
    _alembic(migration_engine, "upgrade", "head", owner_email="dono@example.com")
    _assert_migrated(migration_engine)

    _alembic(migration_engine, "downgrade", INITIAL_REVISION)

    assert _counts(migration_engine) == before
    columns = {c["name"] for c in inspect(migration_engine).get_columns("accounts")}
    assert "owner_id" not in columns


def test_downgrade_with_two_owners_refuses(migration_engine):
    """Com dois donos, voltar ao `UNIQUE(name)` global pode colidir — "Moradia"
    de cada um. Recusar é melhor que perder uma das duas."""
    _alembic(migration_engine, "upgrade", "head")
    with migration_engine.begin() as db:
        _insert_user(db, 1, "a@example.com")
        _insert_user(db, 2, "b@example.com")
        _insert_named(db, "categories", 1, 1, "Moradia")
        _insert_named(db, "categories", 2, 2, "Moradia")

    with pytest.raises(Exception, match="dono"):
        _alembic(migration_engine, "downgrade", INITIAL_REVISION)
