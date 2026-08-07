import pytest

from tests.conftest import create_category

# Fixtures `session` e `client` vêm do conftest.py.

# Com `category_id` obrigatório, toda transação precisa de uma categoria já
# cadastrada. O banco de teste sobe vazio, então as categorias usadas nos
# payloads são semeadas aqui e os ids ficam acessíveis por nome.
CATEGORY_IDS = {}

CATEGORIAS_USADAS = [
    "Alimentação",
    "Depósito",
    "Eletrônicos",
    "Empréstimos",
    "Moradia",
    "Salário",
    "Tarifa",
]


@pytest.fixture(autouse=True)
def seed_categories(client):
    CATEGORY_IDS.clear()
    for name in CATEGORIAS_USADAS:
        CATEGORY_IDS[name] = create_category(client, name=name)["id"]
    return CATEGORY_IDS


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
        "title": "Supermercado",
        "type": "SAÍDA",
        "amount": 200.0,
        "date": "2026-07-25",
        "category_id": CATEGORY_IDS["Alimentação"],
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
        "title": "Compra Avulsa",
        "type": "SAÍDA",
        "amount": 100.0,
        "date": "2026-07-25",
        "category_id": CATEGORY_IDS["Alimentação"],
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
        "title": "Empréstimo Pessoal",
        "type": "EMPRESTIMO",
        "amount": 100.0,
        "date": "2026-07-25",
        "category_id": CATEGORY_IDS["Empréstimos"],
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
        "title": "Salário",
        "type": "ENTRADA",
        "amount": "mil reais",
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Salário"],
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
        "title": "Padaria",
        "type": "SAÍDA",
        "amount": 0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Alimentação"],
        "account_id": account_id
    }
    response_zero = client.post("/api/transactions", json=transaction_zero)
    assert response_zero.status_code == 422

    # 3. Tenta fazer um POST com 'amount' igual a -50.0
    transaction_negative = {
        "title": "Estorno",
        "type": "SAÍDA",
        "amount": -50.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Alimentação"],
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
        "title": "Depósito",
        "type": "entrada",
        "amount": 100.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Depósito"],
        "account_id": account_id
    }
    response_entrada = client.post("/api/transactions", json=transaction_entrada)
    
    # O teste deve esperar que a API responda com sucesso ('201 Created')
    assert response_entrada.status_code == 201
    # E que o JSON retornado traga o tipo convertido em maiúsculo ('ENTRADA')
    assert response_entrada.json()["type"] == "ENTRADA"

    # 3. Faz uma requisição POST enviando 'type': 'SaÍdA'
    transaction_saida = {
        "title": "Tarifa Bancária",
        "type": "SaÍdA",
        "amount": 50.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Tarifa"],
        "account_id": account_id
    }
    response_saida = client.post("/api/transactions", json=transaction_saida)
    
    # O teste deve esperar que a API responda com sucesso ('201 Created')
    assert response_saida.status_code == 201
    # E que o JSON retornado traga o tipo convertido em maiúsculo ('SAÍDA')
    assert response_saida.json()["type"] == "SAÍDA"


def _create_account(client, name="Conta Corrente", initial_balance=1000.0):
    response = client.post("/api/accounts", json={"name": name, "initial_balance": initial_balance})
    assert response.status_code == 201
    return response.json()["id"]


def _create_installment(client, account_id, current=2, total=12):
    response = client.post("/api/installments", json={
        "title": "Notebook Pro",
        "category_id": CATEGORY_IDS["Eletrônicos"],
        "total_amount": 5400.0,
        "installment_amount": 450.0,
        "current_installment": current,
        "total_installments": total,
        "end_date": "Ago/2026",
        "account_id": account_id
    })
    assert response.status_code == 201
    return response.json()["id"]


def test_transaction_requires_title(client):
    account_id = _create_account(client)

    # Omitir o título deve ser barrado pela validação do Pydantic
    response = client.post("/api/transactions", json={
        "type": "SAÍDA",
        "amount": 100.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Alimentação"],
        "account_id": account_id
    })
    assert response.status_code == 422


def test_transaction_linked_to_installment(client):
    account_id = _create_account(client)
    installment_id = _create_installment(client, account_id, current=2, total=12)

    response = client.post("/api/transactions", json={
        "title": "Notebook Pro",
        "type": "SAÍDA",
        "amount": 450.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Eletrônicos"],
        "account_id": account_id,
        "installment_id": installment_id
    })
    assert response.status_code == 201

    data = response.json()
    assert data["installment_id"] == installment_id
    assert data["is_fixed"] is False
    # O progresso da parcela vem embutido para o frontend exibir "2/12"
    assert data["installment"] == {"current_installment": 2, "total_installments": 12}

    # A listagem também precisa trazer o progresso da parcela
    response_list = client.get("/api/transactions")
    assert response_list.status_code == 200
    listed = next(tx for tx in response_list.json() if tx["id"] == data["id"])
    assert listed["installment"] == {"current_installment": 2, "total_installments": 12}


def test_transaction_without_installment_has_null_progress(client):
    account_id = _create_account(client)

    response = client.post("/api/transactions", json={
        "title": "Aluguel",
        "type": "SAÍDA",
        "amount": 2100.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Moradia"],
        "is_fixed": True,
        "account_id": account_id
    })
    assert response.status_code == 201

    data = response.json()
    assert data["is_fixed"] is True
    assert data["installment_id"] is None
    assert data["installment"] is None


def test_transaction_installment_and_fixed_mutually_exclusive(client):
    account_id = _create_account(client)
    installment_id = _create_installment(client, account_id)

    # Uma transação parcelada não pode ser marcada como fixa ao mesmo tempo
    response = client.post("/api/transactions", json={
        "title": "Notebook Pro",
        "type": "SAÍDA",
        "amount": 450.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Eletrônicos"],
        "is_fixed": True,
        "account_id": account_id,
        "installment_id": installment_id
    })
    assert response.status_code == 422


def test_transaction_installment_not_found(client):
    account_id = _create_account(client)

    response = client.post("/api/transactions", json={
        "title": "Compra Parcelada",
        "type": "SAÍDA",
        "amount": 450.0,
        "date": "2026-07-29",
        "category_id": CATEGORY_IDS["Eletrônicos"],
        "account_id": account_id,
        "installment_id": 9999
    })
    assert response.status_code == 404
    assert response.json()["detail"] == "Parcelamento não encontrado."
