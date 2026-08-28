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


def test_create_and_list_investments(client):
    # 1. Faz um POST para '/api/investments' criando um novo investimento
    investment_data = {
        "name": "CDB Inter 100% CDI",
        "current_balance": 1000.0
    }
    response_post = client.post("/api/investments", json=investment_data)
    
    # Valida se o status code de retorno é '201 Created'
    assert response_post.status_code == 201
    
    # Valida se o nome e o saldo foram preenchidos corretamente no JSON de resposta
    data_post = response_post.json()
    assert data_post["name"] == "CDB Inter 100% CDI"
    assert money(data_post["current_balance"]) == Decimal("1000.00")
    assert "id" in data_post

    # 2. Faz um GET para '/api/investments'
    response_get = client.get("/api/investments")
    
    # Valide se o status é '200 OK'
    assert response_get.status_code == 200
    
    # Valide se o retorno é uma lista
    data_get = response_get.json()
    assert isinstance(data_get, list)
    assert len(data_get) >= 1
    
    # Valida se o investimento criado está presente na lista
    created_investment = next(
        inv for inv in data_get if inv["id"] == data_post["id"]
    )
    assert created_investment["name"] == "CDB Inter 100% CDI"
    assert money(created_investment["current_balance"]) == Decimal("1000.00")


def test_investment_history_logging(client):
    # 1. Cria um investimento inicial
    investment_data = {
        "name": "CDB Inter 100% CDI",
        "current_balance": 1000.0
    }
    response_post = client.post("/api/investments", json=investment_data)
    assert response_post.status_code == 201
    investment_id = response_post.json()["id"]

    # 2. Faz um POST para '/api/investments/{investment_id}/history' enviando uma atualização de saldo (valorização)
    history_data = {
        "date": "2026-07-27",
        "balance": 1050.0
    }
    response_history_post = client.post(f"/api/investments/{investment_id}/history", json=history_data)
    
    # No estágio RED, isso deve falhar com 404 Not Found porque o endpoint não existe
    assert response_history_post.status_code == 201
    
    history_post_data = response_history_post.json()
    assert money(history_post_data["balance"]) == Decimal("1050.00")
    assert history_post_data["date"] == "2026-07-27"
    assert history_post_data["investment_id"] == investment_id

    # 3. Faz um GET para '/api/investments/{investment_id}/history' para verificar a listagem do histórico
    response_history_get = client.get(f"/api/investments/{investment_id}/history")
    assert response_history_get.status_code == 200
    
    history_list = response_history_get.json()
    assert isinstance(history_list, list)
    assert len(history_list) >= 1
    assert money(history_list[0]["balance"]) == Decimal("1050.00")

    # 4. Checa se o saldo do investimento principal foi atualizado de forma atômica para R$ 1050
    response_investments = client.get("/api/investments")
    assert response_investments.status_code == 200
    investments_list = response_investments.json()
    updated_investment = next(inv for inv in investments_list if inv["id"] == investment_id)
    assert money(updated_investment["current_balance"]) == Decimal("1050.00")

