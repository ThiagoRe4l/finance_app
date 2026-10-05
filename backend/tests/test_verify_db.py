"""`scripts/verify_db.py` — o retrato somente leitura do banco, antes e depois.

Escrito **antes** do script, conforme o processo do CLAUDE.md.

O script roda contra o Neon de produção, então o que estes testes travam é o
que não pode falhar lá:

* **Não escreve.** A conexão é aberta em modo somente leitura; uma escrita
  acidental tem que levantar, não acontecer.
* **Não imprime credencial.** O alvo aparece como host/banco; a senha não
  aparece em lugar nenhum da saída, nem em mensagem de erro.
* **Funciona nas duas pontas da migration.** Antes dela não há `users` nem
  `owner_id`; depois há. O "antes" e o "depois" têm que bater no dinheiro.
* **Pega o e-mail de dono errado** (`--expect-owner`), sem imprimir o e-mail.
"""

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from tests.test_tenant_schema import INITIAL_REVISION, _alembic, _populate_initial_schema

OWNER = "dono@example.com"


def _verify():
    """Import tardio: o script ainda não existe."""
    from scripts import verify_db

    return verify_db


@pytest.fixture(name="initial_engine")
def initial_engine_fixture(monkeypatch):
    """Banco na revisão inicial, com o dado de exemplo — o estado de hoje.

    O dono está na allowlist: a migration recusa `-x owner_email` fora dela.
    """
    monkeypatch.setenv("AUTH_ALLOWED_EMAILS", OWNER)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    _alembic(engine, "upgrade", INITIAL_REVISION)
    _populate_initial_schema(engine)
    yield engine
    engine.dispose()


def _report(engine, **kwargs):
    with engine.connect() as connection:
        return _verify().collect(connection, **kwargs)


# ---------------------------------------------------------------------------
# O conteúdo do retrato
# ---------------------------------------------------------------------------

def test_reports_counts_money_and_balances_before_the_migration(initial_engine):
    report = _report(initial_engine)

    assert report["revision"] == INITIAL_REVISION
    assert report["counts"]["accounts"] == 1
    assert report["counts"]["transactions"] == 2
    assert report["counts"]["investment_history"] == 1
    assert report["sum_initial_balance"] == "10000.00"
    # 10.000 − 1.800,50 − 500 = 7.699,50
    assert report["balances"] == [
        {"account_id": 1, "initial": "10000.00", "ledger": "-2300.50", "balance": "7699.50"}
    ]
    assert "owners" not in report


def test_money_and_counts_are_identical_across_the_owner_migration(initial_engine):
    """🔴 O critério de sucesso do ensaio: o dinheiro não muda.

    Contagens das 6 tabelas que já existiam, soma dos saldos iniciais e saldo
    derivado por conta — idênticos antes e depois.
    """
    before = _report(initial_engine)
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)
    after = _report(initial_engine)

    for table, count in before["counts"].items():
        assert after["counts"][table] == count, table
    assert after["sum_initial_balance"] == before["sum_initial_balance"]
    assert after["balances"] == before["balances"]
    assert after["revision"] != before["revision"]


def test_after_the_migration_every_row_has_the_one_owner(initial_engine):
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)

    report = _report(initial_engine)

    assert report["counts"]["users"] == 1
    assert len(report["owners"]) == 1
    owner = report["owners"][0]
    assert owner["accounts"] == 1 and owner["transactions"] == 2
    assert report["rows_without_owner"] == 0


def test_foreign_key_names_are_reported(initial_engine):
    """O ensaio compara estes nomes com os que a migration vai derrubar."""
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)

    names = {fk["name"] for fk in _report(initial_engine)["foreign_keys"]["transactions"]}

    assert "fk_transactions_account_owner" in names
    assert "fk_transactions_category_owner" in names


# ---------------------------------------------------------------------------
# --expect-owner: o e-mail do Google tem que ser o da migration
# ---------------------------------------------------------------------------

def test_expected_owner_matches(initial_engine):
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)

    assert _report(initial_engine, expect_owner="  Dono@Example.com ")["owner_check"] == "OK"


def test_a_different_expected_owner_is_flagged(initial_engine):
    """🔴 O caso do `-x owner_email` errado: o dado fica preso a um e-mail que
    ninguém usa para logar, e o dono real ganha um usuário novo e vazio."""
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)

    assert _report(initial_engine, expect_owner="outro@example.com")["owner_check"] == "DIVERGENTE"


def test_a_second_user_is_flagged(initial_engine):
    """Depois do primeiro login, um segundo usuário com o dono esperado sem
    dado é o sintoma de e-mail errado — ou de outra pessoa ter entrado."""
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)
    with initial_engine.begin() as db:
        db.execute(text("INSERT INTO users (id, email) VALUES (2, 'outro@example.com')"))

    report = _report(initial_engine, expect_owner=OWNER)

    assert report["counts"]["users"] == 2
    assert report["owner_check"] == "OK"
    assert report["owners"][1]["transactions"] == 0


def test_the_expected_owner_must_be_the_migrated_owner_not_a_newcomer(initial_engine):
    """🔴 O cenário real do `-x owner_email` errado, depois do primeiro login.

    A migration gravou `dono@`; o dono loga com o e-mail que usa de verdade, e
    o provisionamento cria um usuário novo, vazio, com esse e-mail. Conferir só
    "o e-mail existe em `users`" daria OK aqui — e deu, na primeira versão do
    script, num ensaio em SQLite. O dono migrado é sempre o **primeiro**
    usuário: a migration o cria antes de qualquer login.
    """
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)
    with initial_engine.begin() as db:
        db.execute(text("INSERT INTO users (id, email) VALUES (2, 'dono.real@example.com')"))

    assert _report(initial_engine, expect_owner="dono.real@example.com")["owner_check"] == "DIVERGENTE"


def test_the_rendered_report_points_at_the_expected_owner(initial_engine):
    """A máscara iguala `dono@` e `dono.real@` (`d***@example.com`). Sem marcar
    qual linha é a esperada, quem lê não distingue os dois."""
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)
    with initial_engine.begin() as db:
        db.execute(text("INSERT INTO users (id, email) VALUES (2, 'dono.real@example.com')"))

    rendered = _verify().render(_report(initial_engine, expect_owner="dono.real@example.com"))
    marked = [line for line in rendered.splitlines() if "esperado" in line and line.startswith("usuario")]

    assert len(marked) == 1 and marked[0].startswith("usuario 2 ")


def test_emails_are_masked_in_the_rendered_report(initial_engine):
    _alembic(initial_engine, "upgrade", "head", owner_email=OWNER)

    rendered = _verify().render(_report(initial_engine))

    assert OWNER not in rendered
    assert "d***@example.com" in rendered


# ---------------------------------------------------------------------------
# Somente leitura e sem credencial
# ---------------------------------------------------------------------------

def test_the_connection_refuses_writes(tmp_path):
    """🔴 Arquivo SQLite real, conexão aberta pelo próprio script."""
    url = f"sqlite:///{tmp_path / 'db.sqlite'}"
    seed = create_engine(url)
    with seed.begin() as db:
        db.execute(text("CREATE TABLE t (x INTEGER)"))
    seed.dispose()

    engine = _verify().read_only_engine(url)
    try:
        with engine.connect() as connection:
            with pytest.raises(Exception):
                connection.execute(text("INSERT INTO t VALUES (1)"))
    finally:
        engine.dispose()


def test_the_target_is_described_without_credentials():
    url = "postgresql+psycopg://neondb_owner:s3cr3t-Pa55@ep-x-123-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require"

    described = _verify().describe_target(url)

    assert "s3cr3t-Pa55" not in described
    assert "neondb_owner" not in described
    assert "ep-x-123-pooler.sa-east-1.aws.neon.tech" in described
    assert "neondb" in described


def test_error_messages_are_scrubbed_of_the_password():
    url = "postgresql+psycopg://u:s3cr3t-Pa55@host/db"

    scrubbed = _verify().scrub("connection to u:s3cr3t-Pa55@host failed", url)

    assert "s3cr3t-Pa55" not in scrubbed
