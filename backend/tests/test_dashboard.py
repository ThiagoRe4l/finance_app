from decimal import Decimal

import datetime

import pytest

from tests.conftest import money, create_category

# Fixtures `session` e `client` vêm do conftest.py.

# `category_id` é obrigatório e o banco de teste sobe vazio — a categoria usada
# pelos helpers precisa existir antes de qualquer transação.
CATEGORY_ID = {}


@pytest.fixture(autouse=True)
def seed_category(client):
    CATEGORY_ID["Alimentação"] = create_category(client, name="Alimentação")["id"]
    return CATEGORY_ID


def _month_offset(months_ago: int) -> str:
    """Data no dia 15 do mês N meses atrás — evita datas fixas que expiram com o tempo."""
    today = datetime.date.today()
    month = today.month - months_ago
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return datetime.date(year, month, 15).isoformat()


def _create_account(client, initial_balance=0.0):
    response = client.post("/api/accounts", json={
        "name": "Conta Principal",
        "initial_balance": initial_balance
    })
    assert response.status_code == 201
    return response.json()["id"]


def _create_transaction(client, account_id, tx_type, amount, date, title="Movimentação"):
    response = client.post("/api/transactions", json={
        "title": title,
        "type": tx_type,
        "amount": amount,
        "date": date,
        "category_id": CATEGORY_ID["Alimentação"],
        "account_id": account_id
    })
    assert response.status_code == 201
    return response.json()


def _summary(client):
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    return response.json()


def test_percentages_with_no_history(client):
    _create_account(client, initial_balance=0.0)

    data = _summary(client)

    # Sem transações todos os denominadores são zero — nenhuma variação é calculável
    assert data["balance_change_pct"] is None
    assert data["expenses_change_pct"] is None
    assert data["savings_pct_of_revenue"] is None


def test_expenses_change_pct_previous_month_zero(client):
    account_id = _create_account(client, initial_balance=5000.0)
    _create_transaction(client, account_id, "ENTRADA", 1000.0, _month_offset(0))
    _create_transaction(client, account_id, "SAÍDA", 400.0, _month_offset(0))

    data = _summary(client)

    # Mês anterior sem despesas: divisão por zero não pode virar erro nem 0%
    assert data["expenses_change_pct"] is None
    # As demais métricas seguem calculáveis
    assert data["savings_pct_of_revenue"] == pytest.approx(60.0)


def test_expenses_change_pct_computed(client):
    account_id = _create_account(client, initial_balance=5000.0)
    _create_transaction(client, account_id, "SAÍDA", 100.0, _month_offset(1))
    _create_transaction(client, account_id, "SAÍDA", 150.0, _month_offset(0))

    data = _summary(client)

    assert data["expenses_change_pct"] == pytest.approx(50.0)


def test_balance_change_pct_negative_previous_balance(client):
    # Saldo ao fim do mês anterior fica negativo (-500)
    account_id = _create_account(client, initial_balance=-500.0)
    # Movimentação líquida positiva no mês atual (+200)
    _create_transaction(client, account_id, "ENTRADA", 200.0, _month_offset(0))

    data = _summary(client)

    # Com saldo anterior negativo, uma economia positiva precisa reportar variação
    # positiva — dividir pelo valor com sinal inverteria a leitura.
    assert data["balance_change_pct"] == pytest.approx(40.0)


def test_savings_pct_of_revenue(client):
    account_id = _create_account(client, initial_balance=0.0)
    _create_transaction(client, account_id, "ENTRADA", 1000.0, _month_offset(0))
    _create_transaction(client, account_id, "SAÍDA", 400.0, _month_offset(0))

    data = _summary(client)

    assert data["savings_pct_of_revenue"] == pytest.approx(60.0)


def test_reports_overview_smoke(client):
    """Regressão de acoplamento: /reports/overview delega para get_dashboard_summary,
    então qualquer exceção nova no dashboard derruba os relatórios junto."""
    account_id = _create_account(client, initial_balance=5000.0)
    _create_transaction(client, account_id, "SAÍDA", 100.0, _month_offset(1))
    _create_transaction(client, account_id, "ENTRADA", 1000.0, _month_offset(0))
    _create_transaction(client, account_id, "SAÍDA", 400.0, _month_offset(0))

    response = client.get("/api/reports/overview")
    assert response.status_code == 200
    data = response.json()

    # Totais agregados sobre os 6 meses do fluxo mensal
    assert money(data["total_revenues"]) == Decimal("1000.00")
    assert money(data["total_expenses"]) == Decimal("500.00")
    assert data["average_savings"] == pytest.approx(500.0 / 6)

    # O comparativo mensal reflete a mesma janela de 6 meses do dashboard
    assert len(data["monthly_comparative"]) == 6

    assert [c["name"] for c in data["top_categories"]] == ["Alimentação"]
    assert money(data["top_categories"][0]["value"]) == Decimal("500.00")

    assert isinstance(data["insights"], list)
    assert all(isinstance(i, str) for i in data["insights"])
