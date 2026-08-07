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


def _create_account(client, name="Conta Parcelamentos", initial_balance=10000.0):
    response = client.post("/api/accounts", json={
        "name": name,
        "initial_balance": initial_balance,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _installment_payload(account_id, **overrides):
    payload = {
        "title": "Notebook Dell",
        "category_name": "Eletrônicos",
        "total_amount": 6000.0,
        "installment_amount": 500.0,
        "current_installment": 2,
        "total_installments": 12,
        "end_date": "Ago/2026",
        "account_id": account_id,
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# POST /api/installments
# ---------------------------------------------------------------------------

def test_create_installment(client):
    account_id = _create_account(client)

    response = client.post("/api/installments/", json=_installment_payload(account_id))

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["id"] is not None
    assert data["title"] == "Notebook Dell"
    assert data["category_name"] == "Eletrônicos"
    assert data["total_amount"] == 6000.0
    assert data["installment_amount"] == 500.0
    assert data["current_installment"] == 2
    assert data["total_installments"] == 12
    assert data["end_date"] == "Ago/2026"
    assert data["account_id"] == account_id


def test_create_installment_does_not_touch_account_balance(client):
    """Criar o parcelamento é só um registro de acompanhamento — o débito
    acontece quando uma transação é vinculada a ele, não aqui."""
    account_id = _create_account(client, initial_balance=10000.0)

    client.post("/api/installments/", json=_installment_payload(account_id))

    account = client.get("/api/accounts").json()[0]
    assert account["current_balance"] == pytest.approx(10000.0)


def test_create_installment_account_not_found(client):
    response = client.post("/api/installments/", json=_installment_payload(9999))

    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."


def test_create_installment_with_invalid_account_persists_nothing(client):
    client.post("/api/installments/", json=_installment_payload(9999))

    listed = client.get("/api/installments/")
    assert listed.status_code == 200
    assert listed.json() == []


@pytest.mark.parametrize("missing_field", [
    "title",
    "category_name",
    "total_amount",
    "installment_amount",
    "current_installment",
    "total_installments",
    "end_date",
    "account_id",
])
def test_create_installment_missing_required_fields(client, missing_field):
    """Nenhum campo do InstallmentBase tem default — todos são obrigatórios."""
    account_id = _create_account(client)
    payload = _installment_payload(account_id)
    del payload[missing_field]

    response = client.post("/api/installments/", json=payload)

    assert response.status_code == 422
    assert any(missing_field in err["loc"] for err in response.json()["detail"])


def test_create_installment_title_exceeds_max_length(client):
    account_id = _create_account(client)

    response = client.post(
        "/api/installments/",
        json=_installment_payload(account_id, title="A" * 101),  # max_length=100
    )

    assert response.status_code == 422


def test_create_installment_category_name_exceeds_max_length(client):
    account_id = _create_account(client)

    response = client.post(
        "/api/installments/",
        json=_installment_payload(account_id, category_name="A" * 51),  # max_length=50
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field,bad_value", [
    ("total_amount", "seis mil"),
    ("installment_amount", "quinhentos"),
    ("current_installment", "duas"),
    ("total_installments", 12.5),
    ("account_id", "abc"),
])
def test_create_installment_invalid_data_types(client, field, bad_value):
    account_id = _create_account(client)

    payload = _installment_payload(account_id)
    payload[field] = bad_value

    response = client.post("/api/installments/", json=payload)

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/installments
# ---------------------------------------------------------------------------

def test_list_installments_empty(client):
    response = client.get("/api/installments/")

    assert response.status_code == 200
    assert response.json() == []


def test_list_installments_returns_all_records(client):
    account_id = _create_account(client)
    client.post("/api/installments/", json=_installment_payload(account_id))
    client.post("/api/installments/", json=_installment_payload(
        account_id,
        title="Geladeira",
        category_name="Casa",
        total_amount=3000.0,
        installment_amount=250.0,
        current_installment=5,
        total_installments=12,
        end_date="Dez/2026",
    ))

    response = client.get("/api/installments/")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2

    by_title = {i["title"]: i for i in data}
    assert by_title["Notebook Dell"]["current_installment"] == 2
    assert by_title["Geladeira"]["installment_amount"] == 250.0
    assert by_title["Geladeira"]["end_date"] == "Dez/2026"


def test_list_installments_scoped_across_multiple_accounts(client):
    """`GET /installments` não filtra por conta: devolve a carteira inteira,
    com o account_id preservado em cada item."""
    account_a = _create_account(client, name="Banco Inter")
    account_b = _create_account(client, name="Nubank")

    client.post("/api/installments/", json=_installment_payload(account_a, title="Notebook"))
    client.post("/api/installments/", json=_installment_payload(account_b, title="Celular"))

    data = client.get("/api/installments/").json()

    assert len(data) == 2
    assert {i["title"]: i["account_id"] for i in data} == {
        "Notebook": account_a,
        "Celular": account_b,
    }
