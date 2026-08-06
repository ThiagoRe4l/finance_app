import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

# Configuração de um banco de dados SQLite limpo em memória para testes
SQLALCHEMY_DATABASE_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(name="session")
def session_fixture():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(name="client")
def client_fixture(session):
    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    del app.dependency_overrides[get_db]


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
        "category": "Alimentação",
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
    assert data["total_revenues"] == pytest.approx(1000.0)
    assert data["total_expenses"] == pytest.approx(500.0)
    assert data["average_savings"] == pytest.approx(500.0 / 6)

    # O comparativo mensal reflete a mesma janela de 6 meses do dashboard
    assert len(data["monthly_comparative"]) == 6

    assert data["top_categories"] == [{"name": "Alimentação", "value": 500.0}]

    assert isinstance(data["insights"], list)
    assert all(isinstance(i, str) for i in data["insights"])
