import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

# Setup of a clean in-memory SQLite database for testing purposes
SQLALCHEMY_DATABASE_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(name="session")
def session_fixture():
    # Set up tables for the test session
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(name="client")
def client_fixture(session):
    # Override the get_db dependency to use our clean test database session
    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    del app.dependency_overrides[get_db]


def _create_category(client, name="Alimentação", icon_name="utensils", budget=800.0, color="#FF0000"):
    response = client.post("/api/categories/", json={
        "name": name,
        "icon_name": icon_name,
        "budget": budget,
        "color": color,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _create_account(client, name="Conta Categorias", initial_balance=10000.0):
    response = client.post("/api/accounts", json={
        "name": name,
        "initial_balance": initial_balance,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_transaction(client, account_id, tx_type, amount, category, title="Lançamento"):
    response = client.post("/api/transactions", json={
        "title": title,
        "type": tx_type,
        "amount": amount,
        "date": "2026-08-06",
        "category": category,
        "account_id": account_id,
    })
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# POST /api/categories
# ---------------------------------------------------------------------------

def test_create_category(client):
    data = _create_category(client)

    assert data["id"] is not None
    assert data["name"] == "Alimentação"
    assert data["icon_name"] == "utensils"
    assert data["budget"] == 800.0
    assert data["color"] == "#FF0000"
    # Categoria recém-criada nunca tem movimento agregado
    assert data["spent"] == 0.0
    assert data["txs_count"] == 0


def test_create_category_budget_defaults_to_zero(client):
    # `budget` é o único campo opcional do CategoryBase
    response = client.post("/api/categories/", json={
        "name": "Lazer",
        "icon_name": "gamepad",
        "color": "#00FF00",
    })

    assert response.status_code == 201
    assert response.json()["budget"] == 0.0


def test_create_duplicate_category_name(client):
    _create_category(client, name="Transporte")

    response = client.post("/api/categories/", json={
        "name": "Transporte",
        "icon_name": "car",
        "budget": 300.0,
        "color": "#0000FF",
    })

    assert response.status_code == 400
    assert response.json()["detail"] == "Categoria já existe."


@pytest.mark.parametrize("missing_field", ["name", "icon_name", "color"])
def test_create_category_missing_required_fields(client, missing_field):
    payload = {
        "name": "Saúde",
        "icon_name": "heart",
        "budget": 200.0,
        "color": "#FFFFFF",
    }
    del payload[missing_field]

    response = client.post("/api/categories/", json=payload)

    assert response.status_code == 422
    assert any(missing_field in err["loc"] for err in response.json()["detail"])


def test_create_category_name_exceeds_max_length(client):
    response = client.post("/api/categories/", json={
        "name": "A" * 51,  # max_length=50
        "icon_name": "heart",
        "color": "#FFFFFF",
    })

    assert response.status_code == 422


def test_create_category_invalid_budget_type(client):
    response = client.post("/api/categories/", json={
        "name": "Educação",
        "icon_name": "book",
        "budget": "muito caro",
        "color": "#123456",
    })

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/categories — agregação manual de spent / txs_count
# ---------------------------------------------------------------------------

def test_list_categories_empty(client):
    response = client.get("/api/categories/")

    assert response.status_code == 200
    assert response.json() == []


def test_list_categories_without_transactions_returns_zeroed_aggregates(client):
    _create_category(client, name="Alimentação")
    _create_category(client, name="Transporte")

    response = client.get("/api/categories/")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    for category in data:
        assert category["spent"] == 0.0
        assert category["txs_count"] == 0


def test_spent_sums_only_expenses_but_count_includes_all_transactions(client):
    """`spent` filtra por type == 'SAÍDA'; `txs_count` conta a categoria inteira.

    A assimetria é intencional no router, então uma ENTRADA na mesma categoria
    tem que mexer no contador sem mexer no total gasto.
    """
    _create_category(client, name="Alimentação")
    account_id = _create_account(client)

    _create_transaction(client, account_id, "SAÍDA", 150.0, "Alimentação")
    _create_transaction(client, account_id, "SAÍDA", 100.5, "Alimentação")
    _create_transaction(client, account_id, "ENTRADA", 900.0, "Alimentação")

    response = client.get("/api/categories/")

    assert response.status_code == 200
    category = response.json()[0]
    assert category["spent"] == pytest.approx(250.5)
    assert category["txs_count"] == 3


def test_aggregates_are_isolated_per_category(client):
    _create_category(client, name="Alimentação")
    _create_category(client, name="Transporte")
    account_id = _create_account(client)

    _create_transaction(client, account_id, "SAÍDA", 200.0, "Alimentação")
    _create_transaction(client, account_id, "SAÍDA", 75.0, "Transporte")
    _create_transaction(client, account_id, "SAÍDA", 25.0, "Transporte")

    response = client.get("/api/categories/")

    assert response.status_code == 200
    by_name = {c["name"]: c for c in response.json()}

    assert by_name["Alimentação"]["spent"] == pytest.approx(200.0)
    assert by_name["Alimentação"]["txs_count"] == 1
    assert by_name["Transporte"]["spent"] == pytest.approx(100.0)
    assert by_name["Transporte"]["txs_count"] == 2


def test_aggregation_matches_by_name_and_is_case_sensitive(client):
    """O vínculo categoria↔transação é uma string solta, não uma FK.

    Consequência: uma transação gravada com grafia diferente não é agregada em
    lugar nenhum — ela some do relatório em vez de dar erro.
    """
    _create_category(client, name="Alimentação")
    account_id = _create_account(client)

    _create_transaction(client, account_id, "SAÍDA", 300.0, "Alimentação")
    _create_transaction(client, account_id, "SAÍDA", 999.0, "alimentação")

    response = client.get("/api/categories/")

    category = response.json()[0]
    assert category["spent"] == pytest.approx(300.0)
    assert category["txs_count"] == 1


def test_transactions_in_unregistered_category_are_not_reported(client):
    """Transação com categoria que não existe na tabela `categories` é aceita
    pelo POST /transactions e depois fica órfã na listagem de categorias."""
    _create_category(client, name="Alimentação")
    account_id = _create_account(client)

    _create_transaction(client, account_id, "SAÍDA", 500.0, "Categoria Fantasma")

    response = client.get("/api/categories/")

    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alimentação"
    assert data[0]["spent"] == 0.0
    assert data[0]["txs_count"] == 0
