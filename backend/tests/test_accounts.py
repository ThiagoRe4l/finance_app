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


def test_create_and_list_accounts(client):
    # 1. Try to create a bank account (POST to /api/accounts)
    account_data = {
        "name": "Conta de Teste",
        "initial_balance": 1500.0
    }
    response_post = client.post("/api/accounts", json=account_data)
    assert response_post.status_code == 201
    
    data_post = response_post.json()
    assert data_post["name"] == "Conta de Teste"
    assert data_post["initial_balance"] == 1500.0
    assert data_post["current_balance"] == 1500.0
    assert "id" in data_post

    # 2. Try to list bank accounts (GET to /api/accounts)
    response_get = client.get("/api/accounts")
    assert response_get.status_code == 200
    
    data_get = response_get.json()
    assert isinstance(data_get, list)
    assert len(data_get) >= 1
    
    # Check that the newly created account is present in the list
    created_account = next(acc for acc in data_get if acc["id"] == data_post["id"])
    assert created_account["name"] == "Conta de Teste"
    assert created_account["current_balance"] == 1500.0


def test_create_duplicate_account_name(client):
    # 1. Cria uma conta bancária inicial
    account_data = {
        "name": "Conta Única",
        "initial_balance": 500.0
    }
    response_post1 = client.post("/api/accounts", json=account_data)
    assert response_post1.status_code == 201

    # 2. Tenta criar outra conta com o mesmo nome exato
    response_post2 = client.post("/api/accounts", json=account_data)
    assert response_post2.status_code == 400
    assert response_post2.json()["detail"] == "Já existe uma conta cadastrada com este nome."

