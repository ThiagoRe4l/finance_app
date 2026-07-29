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
    # Cria todas as tabelas para a sessão de teste
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(name="client")
def client_fixture(session):
    # Sobrescreve a dependência get_db para usar a nossa sessão de teste limpa
    def override_get_db():
        try:
            yield session
        finally:
            pass
    
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    del app.dependency_overrides[get_db]


def test_transaction_decrements_balance(client):
    # 1. Crie uma conta com saldo de R$ 1000
    account_data = {
        "name": "Conta Corrente",
        "initial_balance": 1000.0
    }
    response_account = client.post("/api/accounts", json=account_data)
    assert response_account.status_code == 201
    account_id = response_account.json()["id"]

    # 2. Faça um POST para '/api/transactions' registrando uma SAÍDA de R$ 200
    transaction_data = {
        "type": "SAÍDA",
        "amount": 200.0,
        "date": "2026-07-25",
        "category": "Alimentação",
        "account_id": account_id
    }
    response_transaction = client.post("/api/transactions", json=transaction_data)
    
    assert response_transaction.status_code == 201
    
    transaction_res = response_transaction.json()
    assert transaction_res["type"] == "SAÍDA"
    assert transaction_res["amount"] == 200.0
    assert transaction_res["account_id"] == account_id

    # 3. Faça um novo GET para conferir se o 'current_balance' atualizou para R$ 800
    response_get = client.get("/api/accounts")
    assert response_get.status_code == 200
    accounts = response_get.json()
    account = next(acc for acc in accounts if acc["id"] == account_id)
    assert account["current_balance"] == 800.0


def test_transaction_account_not_found(client):
    # Tenta criar uma transação para uma conta que não existe (id 9999)
    transaction_data = {
        "type": "SAÍDA",
        "amount": 100.0,
        "date": "2026-07-25",
        "category": "Alimentação",
        "account_id": 9999
    }
    response = client.post("/api/transactions/", json=transaction_data)
    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."


def test_transaction_invalid_type(client):
    # 1. Cria uma conta válida
    account_data = {
        "name": "Conta Poupança",
        "initial_balance": 500.0
    }
    response_account = client.post("/api/accounts", json=account_data)
    assert response_account.status_code == 201
    account_id = response_account.json()["id"]

    # 2. Tenta fazer um POST enviando um tipo de transação inválido
    transaction_data = {
        "type": "EMPRESTIMO",
        "amount": 100.0,
        "date": "2026-07-25",
        "category": "Empréstimos",
        "account_id": account_id
    }
    response = client.post("/api/transactions/", json=transaction_data)
    assert response.status_code == 400
    assert response.json()["detail"] == "Tipo de transação inválido. Deve ser 'ENTRADA' ou 'SAÍDA'."


def test_transaction_invalid_data_types(client):
    # 1. Cria uma conta válida
    account_data = {
        "name": "Conta Corrente",
        "initial_balance": 1000.0
    }
    response_account = client.post("/api/accounts", json=account_data)
    assert response_account.status_code == 201
    account_id = response_account.json()["id"]

    # 2. Tenta fazer um POST passando uma string no campo 'amount' (ex: "mil reais")
    transaction_data = {
        "type": "ENTRADA",
        "amount": "mil reais",
        "date": "2026-07-29",
        "category": "Salário",
        "account_id": account_id
    }
    response = client.post("/api/transactions", json=transaction_data)
    
    # Valida se o FastAPI barra retornando 422 Unprocessable Entity
    assert response.status_code == 422


def test_transaction_negative_or_zero_amount(client):
    # 1. Cria uma conta válida
    account_data = {
        "name": "Conta Poupança",
        "initial_balance": 500.0
    }
    response_account = client.post("/api/accounts", json=account_data)
    assert response_account.status_code == 201
    account_id = response_account.json()["id"]

    # 2. Tenta fazer um POST com 'amount' igual a 0
    transaction_zero = {
        "type": "SAÍDA",
        "amount": 0,
        "date": "2026-07-29",
        "category": "Alimentação",
        "account_id": account_id
    }
    response_zero = client.post("/api/transactions", json=transaction_zero)
    assert response_zero.status_code == 422

    # 3. Tenta fazer um POST com 'amount' igual a -50.0
    transaction_negative = {
        "type": "SAÍDA",
        "amount": -50.0,
        "date": "2026-07-29",
        "category": "Alimentação",
        "account_id": account_id
    }
    response_negative = client.post("/api/transactions", json=transaction_negative)
    assert response_negative.status_code == 422


def test_transaction_type_case_normalization(client):
    # 1. Cria uma conta válida
    account_data = {
        "name": "Conta Digital",
        "initial_balance": 1000.0
    }
    response_account = client.post("/api/accounts", json=account_data)
    assert response_account.status_code == 201
    account_id = response_account.json()["id"]

    # 2. Faz uma requisição POST enviando 'type': 'entrada'
    transaction_entrada = {
        "type": "entrada",
        "amount": 100.0,
        "date": "2026-07-29",
        "category": "Depósito",
        "account_id": account_id
    }
    response_entrada = client.post("/api/transactions", json=transaction_entrada)
    
    # O teste deve esperar que a API responda com sucesso ('201 Created')
    assert response_entrada.status_code == 201
    # E que o JSON retornado traga o tipo convertido em maiúsculo ('ENTRADA')
    assert response_entrada.json()["type"] == "ENTRADA"

    # 3. Faz uma requisição POST enviando 'type': 'SaÍdA'
    transaction_saida = {
        "type": "SaÍdA",
        "amount": 50.0,
        "date": "2026-07-29",
        "category": "Tarifa",
        "account_id": account_id
    }
    response_saida = client.post("/api/transactions", json=transaction_saida)
    
    # O teste deve esperar que a API responda com sucesso ('201 Created')
    assert response_saida.status_code == 201
    # E que o JSON retornado traga o tipo convertido em maiúsculo ('SAÍDA')
    assert response_saida.json()["type"] == "SAÍDA"
