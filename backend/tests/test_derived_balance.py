"""Saldo derivado do ledger, não armazenado.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

`Account.current_balance` era coluna mutável, ajustada à mão em três caminhos
de escrita (`POST`, `PATCH`, `DELETE` de transação). Todos cobertos por teste —
mas a proteção era por **disciplina**, não por construção: qualquer escrita
futura que não passasse por eles deixaria o saldo obsoleto em silêncio.

O que decide a mudança
----------------------
Escritas que **não passam pelos routers** deixam o saldo obsoleto: SQL cru,
seed, script de importação, migração. Dois testes aqui provam isso —
`..._deleted_outside_the_router` e `..._inserted_outside_the_router` falham
contra o mecanismo armazenado.

⚠️ **Correção de uma afirmação do mapeamento.** Eu havia dito que o
`ON DELETE CASCADE` já provava a divergência. **Não prova.** O CASCADE de
`Transaction.account_id` só dispara quando a *conta* é apagada — conta e
transações somem juntas, e não sobra saldo obsoleto em lugar nenhum. O teste
de CASCADE abaixo passa hoje e continuará passando; vale como regressão, não
como motivação.

O argumento que sobra é real, mas é sobre caminhos **futuros ou externos**, não
sobre um defeito já presente na aplicação.

⚠️ Alguns testes abaixo **já passam hoje** — os que apenas conferem o valor do
saldo pelos caminhos normais. Estão rotulados com ✅: descrevem o que **não**
pode mudar, e são a rede que garante que a troca de mecanismo não altera
nenhum número.
"""

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import inspect, text

from app import models
from tests.conftest import create_account, create_category, create_transaction, money, owner_id_of


def _balance(client, index=0) -> Decimal:
    return money(client.get("/api/accounts").json()[index]["current_balance"])


def _total_balance(client) -> Decimal:
    return money(client.get("/api/dashboard/summary").json()["total_balance"])


# ---------------------------------------------------------------------------
# A coluna deixa de existir
# ---------------------------------------------------------------------------

def test_accounts_table_has_no_current_balance_column(session):
    """A coluna sai do schema, não fica como campo morto.

    Campo que ninguém mais atualiza é campo que alguém preenche errado — e
    voltaria a divergir do ledger sem nada denunciar.
    """
    # `inspect()` em vez de `PRAGMA table_info`: PRAGMA é sintaxe inválida no
    # Postgres, e a intenção aqui é "olhar o schema", não "executar um comando
    # do SQLite". Ver `test_dialect_portability.py`.
    columns = {c["name"] for c in inspect(session.get_bind()).get_columns("accounts")}

    assert "initial_balance" in columns
    assert "current_balance" not in columns


def test_response_still_exposes_current_balance(client, default_account, default_category):
    """✅ **Contrato preservado.** O campo continua na resposta — muda de onde
    vem, não que existe. Nenhum consumidor do front precisa mudar."""
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0)

    account = client.get("/api/accounts").json()[0]

    assert "current_balance" in account
    assert money(account["current_balance"]) == Decimal("9900.00")


# ---------------------------------------------------------------------------
# A fórmula
# ---------------------------------------------------------------------------

def test_balance_is_initial_plus_income_minus_expenses(client, default_account, default_category):
    """✅ **Já passa hoje.** A igualdade que o mecanismo antigo mantinha à mão."""
    cat = default_category["id"]
    create_transaction(client, default_account, cat, "ENTRADA", 8450.0)
    create_transaction(client, default_account, cat, "SAÍDA", 2100.0)
    create_transaction(client, default_account, cat, "SAÍDA", 342.5)

    assert _balance(client) == Decimal("10000.00") + Decimal("8450.00") - Decimal("2442.50")


def test_account_without_transactions_keeps_the_initial_balance(client):
    """✅ **Já passa hoje.** Sem lançamento, o saldo é o inicial.

    Com a coluna removida, este é o caminho em que a agregação não encontra
    linha nenhuma — o `LEFT JOIN` tem que devolver zero, não `NULL`, senão o
    saldo vira `null` no JSON.
    """
    create_account(client, name="Conta Nova", initial_balance=1500.0)

    assert _balance(client) == Decimal("1500.00")


def test_balance_has_no_date_cutoff(client, default_account, default_category):
    """Saldo é acumulado por definição, ao contrário de `spent`.

    Um gasto de mês passado continua descontado; um lançamento futuro também
    conta. Se alguém aplicar aqui o recorte mensal de `_aggregated_rows` por
    engano, este teste denuncia.
    """
    today = datetime.date.today()
    last_month = (today.replace(day=1) - datetime.timedelta(days=1)).isoformat()
    next_month = (today.replace(day=28) + datetime.timedelta(days=10)).replace(day=5).isoformat()
    cat = default_category["id"]

    create_transaction(client, default_account, cat, "SAÍDA", 100.0, date=last_month)
    create_transaction(client, default_account, cat, "SAÍDA", 200.0, date=next_month)

    assert _balance(client) == Decimal("9700.00")


# ---------------------------------------------------------------------------
# O que o mecanismo antigo não cobria: escrita fora dos routers
# ---------------------------------------------------------------------------

def test_balance_reflects_a_transaction_deleted_outside_the_router(session, client, default_account, default_category):
    """🔴 **O caso que motiva a mudança.**

    `DELETE FROM transactions` direto: o que um script de limpeza, um seed ou
    uma migração fariam. Com saldo armazenado ninguém atualiza a coluna e o
    valor fica obsoleto para sempre; derivado, corrige-se sozinho.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()
    assert _balance(client) == Decimal("9900.00")

    session.execute(text("DELETE FROM transactions WHERE id = :id"), {"id": tx["id"]})
    session.commit()

    assert _balance(client) == Decimal("10000.00")


def test_balance_reflects_a_transaction_inserted_outside_the_router(session, client, default_account, default_category):
    """O caminho simétrico: importação, seed, migração.

    Nenhum deles passa por `create_transaction`, e nenhum herdaria o ajuste de
    saldo. É a "quarta escrita" que a nota do dia 5 antecipava.
    """
    session.add(models.Transaction(
        title="Importada",
        type="SAÍDA",
        amount=Decimal("250.00"),
        date=datetime.date.today(),
        category_id=default_category["id"],
        account_id=default_account,
        owner_id=owner_id_of(session),
    ))
    session.commit()

    assert _balance(client) == Decimal("9750.00")


def test_cascade_delete_leaves_no_stale_balance(fk_session, fk_client):
    """✅ **Já passa hoje** — regressão, não motivação.

    Eu esperava que este fosse o caso que provava a divergência. Não é: o
    CASCADE de `Transaction.account_id` dispara ao apagar a **conta**, então
    conta e transações somem juntas e não resta saldo obsoleto. A conta que
    sobra nunca teve suas transações tocadas.

    Fica como regressão: garante que a agregação nova não vaza lançamentos de
    uma conta para outra.
    """
    doomed = create_account(fk_client, name="Conta Encerrada", initial_balance=5000.0)
    survivor = create_account(fk_client, name="Conta Ativa", initial_balance=8000.0)
    category = create_category(fk_client)

    create_transaction(fk_client, doomed, category["id"], "SAÍDA", 1000.0)
    create_transaction(fk_client, survivor, category["id"], "SAÍDA", 300.0)

    fk_session.execute(text("DELETE FROM accounts WHERE id = :id"), {"id": doomed})
    fk_session.commit()

    remaining = fk_client.get("/api/accounts").json()
    assert len(remaining) == 1
    assert money(remaining[0]["current_balance"]) == Decimal("7700.00")


# ---------------------------------------------------------------------------
# Os caminhos normais continuam corretos
# ---------------------------------------------------------------------------

def test_patch_changes_the_balance_without_reversal_code(client, default_account, default_category):
    """✅ **Já passa hoje**, mas por outro mecanismo.

    Antes: estorna o efeito antigo, aplica o novo. Agora: a soma simplesmente
    recalcula. Os números são os mesmos — é isso que este teste garante ao
    trocar a implementação.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()

    assert client.patch(f"/api/transactions/{tx['id']}", json={"amount": 250.0}).status_code == 200

    assert _balance(client) == Decimal("9750.00")


def test_type_flip_still_swings_by_twice_the_amount(client, default_account, default_category):
    """✅ **Já passa hoje.** A oscilação de `2 × amount` era o caso que mais
    dependia do estorno correto; derivada, sai de graça."""
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 300.0).json()
    assert _balance(client) == Decimal("9700.00")

    assert client.patch(f"/api/transactions/{tx['id']}", json={"type": "ENTRADA"}).status_code == 200

    assert _balance(client) == Decimal("10300.00")


def test_delete_via_router_restores_the_balance(client, default_account, default_category):
    """✅ **Já passa hoje.** Sem código de estorno, agora."""
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    assert _balance(client) == Decimal("10000.00")


# ---------------------------------------------------------------------------
# total_balance do dashboard
# ---------------------------------------------------------------------------

def test_total_balance_sums_every_account(client, default_category):
    """`SUM(initial_balance) + SUM(ENTRADA) − SUM(SAÍDA)` em várias contas.

    Deixa de ser `SUM(current_balance)`: a coluna não existe mais.
    """
    first = create_account(client, name="Conta A", initial_balance=1000.0)
    second = create_account(client, name="Conta B", initial_balance=2000.0)
    cat = default_category["id"]

    create_transaction(client, first, cat, "SAÍDA", 100.0)
    create_transaction(client, second, cat, "ENTRADA", 500.0)

    assert _total_balance(client) == Decimal("3400.00")


def test_total_balance_on_an_empty_database(client):
    """✅ **Já passa hoje.** Sem conta nenhuma, zero com a escala do contrato."""
    assert _total_balance(client) == Decimal("0.00")


def test_total_balance_matches_the_sum_of_the_accounts(client, default_category):
    """Invariante entre os dois endpoints, que antes vinha da mesma coluna.

    Com duas agregações independentes, elas podem divergir — este teste é o que
    impede.
    """
    create_account(client, name="Conta A", initial_balance=1000.0)
    create_account(client, name="Conta B", initial_balance=2000.0)
    cat = default_category["id"]
    accounts = client.get("/api/accounts").json()
    create_transaction(client, accounts[0]["id"], cat, "SAÍDA", 342.5)
    create_transaction(client, accounts[1]["id"], cat, "ENTRADA", 28.9)

    per_account = sum(
        (money(a["current_balance"]) for a in client.get("/api/accounts").json()),
        Decimal("0.00"),
    )

    assert _total_balance(client) == per_account
