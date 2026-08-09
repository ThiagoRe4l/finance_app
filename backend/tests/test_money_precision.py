"""Dinheiro como `Decimal` — contrato, precisão e os fallbacks vazios.

Escrito **antes** da implementação da troca `Float` → `Numeric(12, 2)`.

Este arquivo é a **cobertura nova** da mudança. Os outros arquivos de teste
foram reescritos para comparação exata, mas eles já exercitavam os caminhos;
aqui estão os cenários que ninguém exercitava e que a troca torna perigosos.

Os 4 fallbacks `or 0.0`
-----------------------
`dashboard.py` e `reports.py` usam `.scalar() or 0.0` e `else 0.0` para o caso
de a agregação não encontrar linha nenhuma. Com colunas `Numeric`, a agregação
devolve `Decimal` — e `Decimal - float` levanta **TypeError**, não devolve
número errado.

O detalhe que torna isso traiçoeiro: o erro **não** aparece quando as duas
pontas caem no fallback (`0.0 - 0.0` é float aritmética válida). Ele aparece no
caso **misto** — uma agregação com linhas e a outra vazia. Por isso não basta
um teste de "banco vazio": cada combinação precisa do seu.

Nenhum destes cenários tinha teste antes: `test_dashboard.py` sempre criou
conta e transação antes de chamar o summary.

⚠️ Estado hoje
--------------
Todos vermelhos, e a maioria falha no `money()` — o campo vem como `float` em
vez de string. Os de precisão (0.1 + 0.2, acúmulo) falham no valor.
"""

from decimal import Decimal

import pytest

from tests.conftest import create_category, money


def _account(client, name="Conta Principal", initial_balance="10000.00"):
    response = client.post("/api/accounts", json={
        "name": name, "initial_balance": initial_balance,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _tx(client, account_id, category_id, tx_type, amount, date="2026-08-07",
        title="Lançamento"):
    """Envia o valor como **string** de propósito.

    Number em JSON já passa por `float` do lado do cliente antes de chegar. Para
    testar precisão, a entrada precisa ser exata — e a API aceita as duas formas.
    """
    response = client.post("/api/transactions", json={
        "title": title, "type": tx_type, "amount": amount, "date": date,
        "category_id": category_id, "account_id": account_id,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _summary(client):
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Contrato: dinheiro é string JSON com 2 casas
# ---------------------------------------------------------------------------

def test_money_fields_are_serialized_as_strings(client, default_account, default_category):
    """A mudança de contrato que o front vai ter que respeitar.

    `Decimal` no Pydantic v2 serializa como string — não é configuração, é o
    default. Toda resposta monetária passa de `342.5` para `"342.50"`.
    """
    data = _tx(client, default_account, default_category["id"], "SAÍDA", "342.50")

    assert isinstance(data["amount"], str)
    assert money(data["amount"]) == Decimal("342.50")


def test_money_keeps_two_decimals_even_on_round_values(client, default_account, default_category):
    """`100` vira `"100.00"`, não `"100"` nem `"100.0"`.

    A escala é parte do contrato: o front formata em BRL e um valor sem as duas
    casas denuncia que a coluna perdeu a escala em algum ponto do caminho.
    """
    data = _tx(client, default_account, default_category["id"], "SAÍDA", "100")

    assert data["amount"] == "100.00"


def test_account_balance_is_money_typed(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "SAÍDA", "342.50")

    account = client.get("/api/accounts").json()[0]

    assert money(account["current_balance"]) == Decimal("9657.50")
    assert money(account["initial_balance"]) == Decimal("10000.00")


def test_aggregates_are_money_typed(client, default_account, default_category):
    """`spent` não vem do ORM — é `func.sum` montado à mão em `categories.py`.

    É o ponto mais fácil de escapar da conversão, porque não herda o tipo da
    coluna por serialização direta.
    """
    _tx(client, default_account, default_category["id"], "SAÍDA", "342.50")

    category = client.get("/api/categories/").json()[0]

    assert money(category["spent"]) == Decimal("342.50")
    assert money(category["budget"]) == Decimal("800.00")


# ---------------------------------------------------------------------------
# Precisão: os casos que `pytest.approx` mascarava
# ---------------------------------------------------------------------------

def test_the_classic_float_error_does_not_reach_the_api(client, default_account, default_category):
    """0,10 + 0,20 tem que dar exatamente 0,30.

    Em `float` a soma dá `0.30000000000000004`, e era isso que os 66
    `pytest.approx` deste projeto vinham tolerando. Este teste é a razão de ser
    da mudança inteira.
    """
    _tx(client, default_account, default_category["id"], "SAÍDA", "0.10", title="A")
    _tx(client, default_account, default_category["id"], "SAÍDA", "0.20", title="B")

    summary = _summary(client)

    assert money(summary["total_expenses"]) == Decimal("0.30")


def test_balance_after_the_classic_pair_is_exact(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "SAÍDA", "0.10", title="A")
    _tx(client, default_account, default_category["id"], "SAÍDA", "0.20", title="B")

    account = client.get("/api/accounts").json()[0]

    assert money(account["current_balance"]) == Decimal("9999.70")


def test_many_small_expenses_do_not_drift(client, default_account, default_category):
    """Cem lançamentos de R$ 0,01 têm que somar exatamente R$ 1,00."""
    for i in range(100):
        _tx(client, default_account, default_category["id"], "SAÍDA", "0.01", title=f"Café {i}")

    summary = _summary(client)
    account = client.get("/api/accounts").json()[0]

    assert money(summary["total_expenses"]) == Decimal("1.00")
    assert money(account["current_balance"]) == Decimal("9999.00")


def test_repeated_patches_do_not_accumulate_cent_error(client, default_account, default_category):
    """O risco que o dia 4.1 aumentou: cada PATCH faz duas operações no saldo.

    `test_repeated_patches_do_not_drift_the_balance` já cobria isso, mas com
    `pytest.approx` — que tolera exatamente o erro de centavo que se quer pegar.
    Aqui a comparação é exata e o valor é escolhido para não ser representável
    em binário.
    """
    tx = _tx(client, default_account, default_category["id"], "SAÍDA", "0.10")

    for _ in range(20):
        response = client.patch(f"/api/transactions/{tx['id']}", json={"amount": "0.10"})
        assert response.status_code == 200, response.text

    account = client.get("/api/accounts").json()[0]

    assert money(account["current_balance"]) == Decimal("9999.90")


def test_type_flip_back_and_forth_is_exact(client, default_account, default_category):
    """ENTRADA↔SAÍDA vinte vezes, com valor não representável em binário."""
    tx = _tx(client, default_account, default_category["id"], "SAÍDA", "0.10")

    for i in range(20):
        new_type = "ENTRADA" if i % 2 == 0 else "SAÍDA"
        assert client.patch(
            f"/api/transactions/{tx['id']}", json={"type": new_type}
        ).status_code == 200

    account = client.get("/api/accounts").json()[0]

    assert money(account["current_balance"]) == Decimal("9999.90")


def test_delete_restores_the_balance_exactly(client, default_account, default_category):
    """Estorno tem que devolver o saldo ao centavo, não a `approx` dele."""
    tx = _tx(client, default_account, default_category["id"], "SAÍDA", "0.07")

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    account = client.get("/api/accounts").json()[0]

    assert money(account["current_balance"]) == Decimal("10000.00")


# ---------------------------------------------------------------------------
# Fallback 1 — `total_balance` sem nenhuma conta (dashboard.py:19)
# ---------------------------------------------------------------------------

def test_summary_with_no_accounts_at_all(client):
    """`func.sum(Account.current_balance)` devolve NULL, cai no `or 0.0`.

    Logo abaixo, `balance_prev_month_end = total_balance - total_savings`. Se
    `total_balance` é `float 0.0` e `total_savings` é `Decimal`, é TypeError.
    Aqui os dois caem no fallback, então o cenário é o mais brando — serve de
    piso: nem esse pode quebrar.
    """
    summary = _summary(client)

    assert money(summary["total_balance"]) == Decimal("0.00")
    assert money(summary["total_savings"]) == Decimal("0.00")


def test_summary_with_an_account_but_no_transactions(client):
    """Conta com saldo (Decimal) e nenhuma movimentação (fallback).

    Aqui o misto já aparece: `total_balance` é Decimal, `total_revenues` e
    `total_expenses` caem no `or 0.0`. A subtração
    `total_balance - total_savings` mistura os dois tipos.
    """
    _account(client, initial_balance="1500.00")

    summary = _summary(client)

    assert money(summary["total_balance"]) == Decimal("1500.00")
    assert money(summary["total_revenues"]) == Decimal("0.00")
    assert money(summary["total_expenses"]) == Decimal("0.00")
    assert money(summary["total_savings"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Fallback 2 — receita sem despesa e vice-versa (dashboard.py:28 e 33)
# ---------------------------------------------------------------------------

def test_summary_with_revenues_but_no_expenses(client, default_account, default_category):
    """O caso misto puro: um lado Decimal, o outro no fallback float.

    `total_savings = total_revenues - total_expenses` → `Decimal - float`.
    É aqui que o TypeError aparece primeiro, e é um cenário completamente
    normal: mês em que só entrou salário e nada foi gasto ainda.
    """
    _tx(client, default_account, default_category["id"], "ENTRADA", "8450.00")

    summary = _summary(client)

    assert money(summary["total_revenues"]) == Decimal("8450.00")
    assert money(summary["total_expenses"]) == Decimal("0.00")
    assert money(summary["total_savings"]) == Decimal("8450.00")


def test_summary_with_expenses_but_no_revenues(client, default_account, default_category):
    """O espelho — `float - Decimal`, que também é TypeError.

    Vale como teste separado porque a ordem dos operandos é diferente e uma
    correção parcial (converter só um dos dois fallbacks) passa em um e falha
    no outro.
    """
    _tx(client, default_account, default_category["id"], "SAÍDA", "342.50")

    summary = _summary(client)

    assert money(summary["total_revenues"]) == Decimal("0.00")
    assert money(summary["total_expenses"]) == Decimal("342.50")
    assert money(summary["total_savings"]) == Decimal("-342.50")


# ---------------------------------------------------------------------------
# Fallback 3 — meses sem movimento no fluxo mensal (dashboard.py:60 e 66)
# ---------------------------------------------------------------------------

def test_monthly_flow_months_without_movement_are_money_typed(client, default_account, default_category):
    """O laço dos 6 meses cai no `or 0.0` em todo mês sem lançamento.

    Um banco novo tem 5 meses vazios e 1 com dados — o caso comum, não o raro.
    """
    _tx(client, default_account, default_category["id"], "ENTRADA", "1000.00")

    flow = _summary(client)["monthly_flow"]

    assert len(flow) == 6
    for month in flow:
        assert isinstance(month["income"], str), month
        assert isinstance(month["outcome"], str), month


def test_monthly_flow_on_an_empty_database(client):
    """Nenhuma conta, nenhuma transação: os 12 valores do fluxo no fallback."""
    flow = _summary(client)["monthly_flow"]

    assert len(flow) == 6
    for month in flow:
        assert money(month["income"]) == Decimal("0.00")
        assert money(month["outcome"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Fallback 4 — coalesce/case com literal float (categories.py:58 e 60)
# ---------------------------------------------------------------------------

def test_category_without_transactions_returns_money_zero(client):
    """`func.coalesce(func.sum(...), 0.0)` — literal float dentro do SQL.

    Categoria sem movimento não passa pelo `sum`; o valor sai direto do
    `coalesce`. Se o literal continuar `0.0`, `spent` volta como float e escapa
    da conversão sem que nenhum outro teste perceba.
    """
    create_category(client, name="Lazer", icon_name="Gamepad2", color="oklch(0.6 0.2 300)")

    category = client.get("/api/categories/").json()[0]

    assert money(category["spent"]) == Decimal("0.00")
    assert category["txs_count"] == 0


def test_category_with_only_income_returns_money_zero_spent(client, default_account, default_category):
    """O `case(...)` com `else_=0.0`: a categoria tem transação, mas nenhuma
    SAÍDA — então o `sum` percorre linhas e soma só os `else_`."""
    _tx(client, default_account, default_category["id"], "ENTRADA", "900.00")

    category = client.get("/api/categories/").json()[0]

    assert money(category["spent"]) == Decimal("0.00")
    assert category["txs_count"] == 1


def test_dashboard_distribution_of_an_untouched_category(client):
    """Mesmo caminho pelo dashboard, que reusa `list_categories`."""
    create_category(client, name="Lazer", icon_name="Gamepad2", color="oklch(0.6 0.2 300)")

    distribution = _summary(client)["category_distribution"]

    assert money(distribution[0]["spent"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# reports.py — herda tudo do dashboard
# ---------------------------------------------------------------------------

def test_reports_overview_on_an_empty_database(client):
    """`get_report_overview` chama `get_dashboard_summary` e soma o fluxo.

    Se o dashboard levantar TypeError, este endpoint cai junto — e ele é a
    única rota de `reports.py`, que não tem arquivo de teste próprio.
    """
    response = client.get("/api/reports/overview")

    assert response.status_code == 200, response.text
    data = response.json()
    assert money(data["total_revenues"]) == Decimal("0.00")
    assert money(data["total_expenses"]) == Decimal("0.00")


def test_reports_top_categories_are_money_typed(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "SAÍDA", "2100.00")

    top = client.get("/api/reports/overview").json()["top_categories"]

    assert money(top[0]["value"]) == Decimal("2100.00")


def test_reports_insight_string_still_formats(client, default_account, default_category):
    """✅ **Já passa hoje.** `f"R$ {avg_saving:,.2f}"` — o `:,.2f` precisa continuar funcionando.

    Funciona em `Decimal`, mas quebra se `avg_saving` virar string em vez de
    número. É a única formatação de dinheiro que sobrou no backend.
    """
    _tx(client, default_account, default_category["id"], "ENTRADA", "1000.00")

    insights = client.get("/api/reports/overview").json()["insights"]

    assert insights[0].startswith("Sua economia média mensal é de R$ ")


# ---------------------------------------------------------------------------
# Percentuais continuam float — a fronteira da mudança
# ---------------------------------------------------------------------------

def test_percentages_remain_json_numbers(client, default_account, default_category):
    """⚠️ **Já passa hoje** — regressão da fronteira.

    Percentual é razão, não dinheiro. Divisão em `Decimal` gera dízima de 28
    dígitos e obrigaria a arredondar arbitrariamente. Estes campos continuam
    `float`, e é isso que este teste trava — para que a conversão em massa não
    os arraste junto.
    """
    _tx(client, default_account, default_category["id"], "ENTRADA", "1000.00")
    _tx(client, default_account, default_category["id"], "SAÍDA", "400.00")

    summary = _summary(client)

    assert isinstance(summary["savings_pct_of_revenue"], float)
    assert summary["savings_pct_of_revenue"] == pytest.approx(60.0)


def test_average_savings_remains_a_number(client, default_account, default_category):
    """✅ **Já passa hoje.** `average_savings` é `(total_in - total_out) / 6` — dízima legítima.

    Fica `float` pelo mesmo motivo dos percentuais, e continua comparado com
    `approx`. Não é máscara de imprecisão: é divisão que não fecha.
    """
    _tx(client, default_account, default_category["id"], "ENTRADA", "1000.00")

    data = client.get("/api/reports/overview").json()

    assert isinstance(data["average_savings"], float)
    assert data["average_savings"] == pytest.approx(1000.0 / 6)
