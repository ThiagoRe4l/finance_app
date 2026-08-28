from decimal import Decimal

from tests.conftest import money

# ⚠️ As fixtures locais de engine saíram daqui (28/08/2026).
#
# Este arquivo carregava a própria cópia do setup de SQLite — débito já
# registrado no CLAUDE.md ("migrar quando forem tocados"). O pivô para Postgres
# os toca: com engine próprio e `create_all()`, estes testes escapariam tanto do
# schema construído pela migration quanto do job de Postgres do CI, e ficariam
# verdes contra um schema que ninguém mais usa.
#
# `session`/`client` vêm do `conftest.py`.


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
    assert money(data_post["initial_balance"]) == Decimal("1500.00")
    assert money(data_post["current_balance"]) == Decimal("1500.00")
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
    assert money(created_account["current_balance"]) == Decimal("1500.00")


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

