"""Retrato **somente leitura** do banco, para rodar antes e depois da migration.

Uso (de `backend/`):

    DATABASE_URL='<url direta do branch>' python -m scripts.verify_db > antes.txt
    ... migration ...
    DATABASE_URL='<url direta do branch>' python -m scripts.verify_db \\
        --expect-owner '<e-mail do Google do dono>' > depois.txt
    diff antes.txt depois.txt

O que o retrato traz: revisão do Alembic, contagem de linhas por tabela, soma dos
saldos iniciais, saldo derivado por conta (o mesmo cálculo de
`account_balance.py`, em SQL cru), as FKs de `transactions` e `installments`
com nome e `ondelete` e, depois da migration, as linhas por dono.

🔴 **Não escreve.** A conexão é somente leitura por construção: `PRAGMA
query_only` no SQLite, `SET TRANSACTION READ ONLY` em toda transação no
Postgres. Uma escrita acidental levanta.

🔴 **Não imprime credencial.** O alvo aparece como host/banco, e qualquer
mensagem de erro passa por `scrub` antes de sair. E-mails saem mascarados.

⚠️ **Defina `DATABASE_URL` sempre, explicitamente.** Sem ela, `settings` cai no
`.env.local` — que aponta para o Neon de **produção**. A primeira linha da
saída é o alvo: confira antes de seguir.

SQL cru, não ORM: os models descrevem o schema **depois** da migration, e o
script precisa funcionar também antes dela.
"""

import argparse
import sys
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Connection, Engine, make_url

from app import settings

CENT = Decimal("0.01")

# Tabelas que existiam antes da série multiusuário. As contagens delas têm que
# bater antes e depois.
LEGACY_TABLES = (
    "accounts",
    "categories",
    "installments",
    "transactions",
    "investments",
    "investment_history",
)
NEW_TABLES = ("users", "shared_expenses", "shared_expense_participants")
OWNED_TABLES = ("accounts", "categories", "installments", "transactions", "investments")
FK_TABLES = ("transactions", "installments")


# ---------------------------------------------------------------------------
# Conexão
# ---------------------------------------------------------------------------

def read_only_engine(url: str) -> Engine:
    """Engine cuja conexão recusa escrita."""
    url = settings.normalize_database_url(url)
    engine = create_engine(url, **settings.engine_options_for(url))

    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def _sqlite_read_only(dbapi_connection, _record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA query_only = ON")
            cursor.close()
    else:
        # Por transação, e não por sessão: atrás do pooler em transaction mode
        # não há garantia de sessão, e parâmetro de inicialização pode ser
        # recusado. Dentro da transação vale nos dois endpoints.
        @event.listens_for(engine, "begin")
        def _postgres_read_only(connection):
            connection.exec_driver_sql("SET TRANSACTION READ ONLY")

    return engine


def describe_target(url: str) -> str:
    """Onde o script vai ler — sem usuário nem senha."""
    parsed = make_url(settings.normalize_database_url(url))
    if parsed.get_backend_name() == "sqlite":
        return f"sqlite {parsed.database or '(memória)'}"
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.get_backend_name()} {parsed.host}{port}/{parsed.database}"


def scrub(message: str, url: str) -> str:
    """Tira a senha de qualquer texto que vá para a saída."""
    password = make_url(settings.normalize_database_url(url)).password
    if password:
        message = message.replace(str(password), "***")
    return message


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


# ---------------------------------------------------------------------------
# O retrato
# ---------------------------------------------------------------------------

def _money(value: Any) -> str:
    """Escala fixa: o SQLite devolve float, o Postgres `Decimal`. O retrato
    precisa ser o mesmo texto nos dois para o `diff` funcionar."""
    return str(Decimal(str(value if value is not None else 0)).quantize(CENT))


def _scalar(connection: Connection, sql: str, **params) -> Any:
    return connection.execute(text(sql), params).scalar()


def collect(connection: Connection, expect_owner: Optional[str] = None) -> Dict[str, Any]:
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    report: Dict[str, Any] = {}

    report["revision"] = (
        _scalar(connection, "SELECT version_num FROM alembic_version")
        if "alembic_version" in tables else None
    )

    report["counts"] = {
        table: _scalar(connection, f"SELECT COUNT(*) FROM {table}")
        for table in (*LEGACY_TABLES, *NEW_TABLES)
        if table in tables
    }

    report["sum_initial_balance"] = _money(
        _scalar(connection, "SELECT SUM(initial_balance) FROM accounts")
    )

    # Mesmo cálculo de `account_balance.ledger_delta`, sem recorte de data.
    rows = connection.execute(text(
        "SELECT a.id, a.initial_balance, "
        "       COALESCE(SUM(CASE WHEN t.type = 'ENTRADA' THEN t.amount "
        "                         WHEN t.type = 'SAÍDA' THEN -t.amount "
        "                         ELSE 0 END), 0) "
        "FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id "
        "GROUP BY a.id, a.initial_balance ORDER BY a.id"
    )).all()
    report["balances"] = [
        {
            "account_id": account_id,
            "initial": _money(initial),
            "ledger": _money(ledger),
            "balance": _money(Decimal(str(initial)) + Decimal(str(ledger))),
        }
        for account_id, initial, ledger in rows
    ]

    report["foreign_keys"] = {
        table: sorted(
            (
                {
                    "name": fk.get("name") or "(sem nome)",
                    "columns": ",".join(fk["constrained_columns"]),
                    "referred": f"{fk['referred_table']}({','.join(fk['referred_columns'])})",
                    "ondelete": (fk.get("options") or {}).get("ondelete") or "-",
                }
                for fk in inspector.get_foreign_keys(table)
            ),
            key=lambda fk: (fk["columns"], fk["name"]),
        )
        for table in FK_TABLES
        if table in tables
    }

    if "users" in tables:
        users = connection.execute(text("SELECT id, email FROM users ORDER BY id")).all()
        report["owners"] = [
            {
                "user_id": user_id,
                "email": email,
                **{
                    table: _scalar(
                        connection, f"SELECT COUNT(*) FROM {table} WHERE owner_id = :o", o=user_id
                    )
                    for table in OWNED_TABLES
                },
            }
            for user_id, email in users
        ]
        report["rows_without_owner"] = sum(
            _scalar(connection, f"SELECT COUNT(*) FROM {table} WHERE owner_id IS NULL")
            for table in OWNED_TABLES
        )

    if expect_owner is not None:
        if "owners" not in report:
            report["owner_check"] = "N/A (antes da migration)"
        else:
            # 🔴 O dono migrado é o **primeiro** usuário: a migration o cria
            # antes de qualquer login. Conferir só "o e-mail existe" dava OK
            # quando o dono logava com outro e-mail — o provisionamento cria
            # exatamente esse usuário, novo e vazio.
            expected = expect_owner.strip().lower()
            report["expected_owner_id"] = next(
                (o["user_id"] for o in report["owners"] if o["email"] == expected), None
            )
            first = report["owners"][0]["user_id"] if report["owners"] else None
            matches = report["expected_owner_id"] is not None and report["expected_owner_id"] == first
            report["owner_check"] = "OK" if matches else "DIVERGENTE"

    return report


def render(report: Dict[str, Any]) -> str:
    lines: List[str] = [f"revisao: {report['revision']}", "", "[contagens]"]
    lines += [f"{table}: {count}" for table, count in report["counts"].items()]

    lines += ["", "[dinheiro]", f"soma_saldo_inicial: {report['sum_initial_balance']}"]
    lines += [
        f"conta {b['account_id']}: inicial={b['initial']} ledger={b['ledger']} saldo={b['balance']}"
        for b in report["balances"]
    ]

    lines += ["", "[fks]"]
    for table, fks in report["foreign_keys"].items():
        lines += [
            f"{table}.{fk['columns']} -> {fk['referred']} [{fk['name']}] ondelete={fk['ondelete']}"
            for fk in fks
        ]

    if "owners" in report:
        lines += ["", "[donos]"]
        # A máscara pode igualar dois e-mails (`dono@` e `dono.real@`); a marca
        # diz qual linha é a do `--expect-owner`, sem imprimi-lo.
        lines += [
            f"usuario {o['user_id']} {mask_email(o['email'])}: "
            + " ".join(f"{t}={o[t]}" for t in OWNED_TABLES)
            + ("  <- esperado" if o["user_id"] == report.get("expected_owner_id") else "")
            for o in report["owners"]
        ]
        lines.append(f"linhas_sem_dono: {report['rows_without_owner']}")
        if len(report["owners"]) > 1:
            lines.append(
                "⚠️  mais de um usuário: confira se o segundo é outra pessoa da allowlist "
                "ou o dono entrando com um e-mail diferente do da migration"
            )

    if "owner_check" in report:
        lines += ["", f"dono_esperado: {report['owner_check']}"]
        if report["owner_check"] == "DIVERGENTE":
            lines.append(
                "   o e-mail esperado não é o do dono migrado (usuário de menor id) — "
                "ver 'E-mail do dono errado' no VERCEL.md"
            )

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--expect-owner",
        help="e-mail do Google do dono; confere sem imprimi-lo",
    )
    args = parser.parse_args(argv)

    url = settings.resolve_database_url()
    print(f"alvo: {describe_target(url)}", file=sys.stderr)

    engine = read_only_engine(url)
    try:
        with engine.connect() as connection:
            report = collect(connection, expect_owner=args.expect_owner)
    except Exception as exc:  # a mensagem pode trazer a URL; passa por scrub
        print(f"erro: {type(exc).__name__}: {scrub(str(exc), url)}", file=sys.stderr)
        return 2
    finally:
        engine.dispose()

    sys.stdout.write(render(report))
    return 1 if report.get("owner_check") == "DIVERGENTE" else 0


if __name__ == "__main__":
    sys.exit(main())
