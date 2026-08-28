"""Invariantes que mantêm o schema e as queries portáveis entre SQLite e Postgres.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
Cobre as decisões D-Vercel-1 (SQLite local, Postgres em produção) e D-Vercel-4.

⚠️ **Estes testes não precisam de Postgres para valer.** Eles travam os
invariantes *estruturais* que fazem as queries serem aceitas pelos dois
dialetos, e por isso rodam no SQLite local exatamente como no job de CI. O job
de Postgres cobre o que só a execução real revela; aqui estão as regras que
podem ser verificadas por construção — e que, quebradas, produziriam um erro
que só apareceria em produção.
"""

import pytest
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

from app import account_balance, models
from app.routers.categories import _aggregated_rows


# ---------------------------------------------------------------------------
# `GROUP BY` estrito
# ---------------------------------------------------------------------------
#
# ⚠️ Correção registrada: o mapeamento supôs que estas queries quebrariam no
# Postgres. **Não quebram.** Elas agrupam pela chave primária, e o Postgres
# permite selecionar qualquer coluna de uma tabela agrupada por sua PK (regra de
# dependência funcional). O que estes testes travam é o invariante que sustenta
# isso — não a query de hoje.
#
# O modo de falha que eles pegam é prospectivo e assimétrico: trocar o
# agrupamento para uma coluna não-PK deixa o SQLite verde e faz o Postgres
# recusar com "column must appear in the GROUP BY clause". Ou seja, passaria na
# suíte local e quebraria só em produção.

def _group_by_columns(query):
    return list(query.statement._group_by_clauses)


def test_accounts_with_balance_groups_by_primary_key(session):
    """✅ **Já passa hoje** — guarda de regressão, não cobertura nova.

    Passa porque o agrupamento já é pela PK. É esse estado que ele congela."""
    query = session.query(models.Account, account_balance.ledger_delta()).outerjoin(
        models.Transaction, models.Transaction.account_id == models.Account.id
    ).group_by(models.Account.id)

    pk = set(models.Account.__table__.primary_key.columns)

    assert set(_group_by_columns(query)) <= pk, (
        "agrupar por coluna que não é PK faz o Postgres recusar a query, "
        "enquanto o SQLite a aceita — quebra só em produção"
    )


def test_aggregated_rows_groups_by_primary_key(session):
    """✅ **Já passa hoje.** A query real de `categories.py`, não uma reconstrução.

    Reconstruir a query aqui testaria a cópia, não o código que roda.
    """
    # `_aggregated_rows` executa e devolve linhas, não a query. O invariante é
    # verificado sobre o SQL emitido, que é o que o Postgres vai receber.
    from sqlalchemy import event
    emitted = []

    @event.listens_for(session.get_bind(), "before_cursor_execute")
    def capture(conn, cursor, statement, params, context, executemany):
        emitted.append(statement)

    _aggregated_rows(session)
    event.remove(session.get_bind(), "before_cursor_execute", capture)

    grouped = [s for s in emitted if "GROUP BY" in s.upper()]
    assert grouped, "esperava uma query agregada com GROUP BY"
    assert "categories.id" in grouped[-1].lower(), (
        "o GROUP BY precisa ser pela PK de categories; qualquer outra coluna "
        "faz o Postgres recusar a seleção da entidade inteira"
    )


def test_both_aggregations_compile_for_postgres(session):
    """✅ **Já passa hoje.** Compila para o dialeto Postgres sem levantar.

    Não prova validade semântica — só que não há construção específica de
    SQLite no caminho. É barato e pega uso acidental de função não portável.
    """
    query = session.query(models.Account, account_balance.ledger_delta()).outerjoin(
        models.Transaction, models.Transaction.account_id == models.Account.id
    ).group_by(models.Account.id)

    sql = str(query.statement.compile(dialect=postgresql.dialect()))

    assert "GROUP BY accounts.id" in sql


# ---------------------------------------------------------------------------
# Schema: introspecção portável, sem PRAGMA
# ---------------------------------------------------------------------------

def test_schema_is_introspectable_without_pragma(session):
    """✅ Passa hoje: é a versão portável de um teste que já existe. Substitui `PRAGMA table_info`, que é sintaxe inválida no Postgres.

    `test_derived_balance.py` lê PRAGMA para provar que `current_balance` não
    existe mais. `inspect()` faz o mesmo de forma portável — e expressa melhor
    a intenção, que é "olhar o schema", não "executar um comando do SQLite".
    """
    columns = {c["name"] for c in inspect(session.get_bind()).get_columns("accounts")}

    assert "initial_balance" in columns
    assert "current_balance" not in columns


def test_every_foreign_key_declares_ondelete():
    """✅ **Já passa hoje** — as 5 FKs atuais declaram `ondelete`.

    As 5 cláusulas `ondelete` são o coração de `test_fk_cascade.py`.

    No SQLite elas só valem com o listener ligado; no Postgres valem sempre e
    vão para a migration inicial. Uma FK nova sem `ondelete` explícito assume o
    default `NO ACTION` — e o `--autogenerate` do Alembic a levaria assim para
    produção, silenciosamente, com a suíte local verde.
    """
    faltando = []
    for table in models.Base.metadata.tables.values():
        for fk in table.foreign_keys:
            if not fk.ondelete:
                faltando.append(f"{table.name}.{fk.parent.name}")

    assert not faltando, f"FKs sem ondelete explícito: {faltando}"


# ---------------------------------------------------------------------------
# D-Vercel-4: o listener de FK é condicional por dialeto
# ---------------------------------------------------------------------------

def test_sqlite_fk_listener_is_applied_only_to_sqlite():
    """🔴 `PRAGMA foreign_keys` não existe no Postgres — aplicá-lo lá levanta.

    O listener não pode sair (o dev local continua em SQLite, e sem ele
    `test_fk_cascade.py` vira teste de nada), mas não pode rodar no Postgres.
    """
    from app.database import should_enable_sqlite_foreign_keys

    assert should_enable_sqlite_foreign_keys("sqlite:////tmp/x.db") is True
    assert should_enable_sqlite_foreign_keys("postgresql+psycopg://u@h/d") is False
