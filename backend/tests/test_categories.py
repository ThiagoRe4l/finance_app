"""CRUD do router de categorias.

A agregação de `spent`/`txs_count` mudou de comparação de string para join por
FK — os testes dela vivem em `test_category_fk.py`, junto do resto do
comportamento que a foreign key define. Aqui fica o que é do CRUD em si.

Fixtures vêm do `conftest.py`.
"""

import pytest

from tests.conftest import create_category


# ---------------------------------------------------------------------------
# POST /api/categories
# ---------------------------------------------------------------------------

def test_create_category(client):
    data = create_category(client)

    assert data["id"] is not None
    assert data["name"] == "Alimentação"
    assert data["icon_name"] == "UtensilsCrossed"
    assert data["budget"] == 800.0
    assert data["color"] == "oklch(0.6 0.15 155)"
    # Categoria recém-criada nunca tem movimento agregado
    assert data["spent"] == 0.0
    assert data["txs_count"] == 0


def test_create_category_budget_defaults_to_zero(client):
    # `budget` é o único campo opcional do CategoryBase
    response = client.post("/api/categories/", json={
        "name": "Lazer",
        "icon_name": "Gamepad2",
        "color": "oklch(0.6 0.2 300)",
    })

    assert response.status_code == 201
    assert response.json()["budget"] == 0.0


def test_create_duplicate_category_name(client):
    create_category(client, name="Transporte")

    response = client.post("/api/categories/", json={
        "name": "Transporte",
        "icon_name": "Car",
        "budget": 300.0,
        "color": "oklch(0.65 0.18 50)",
    })

    assert response.status_code == 400
    assert response.json()["detail"] == "Categoria já existe."


@pytest.mark.parametrize("missing_field", ["name", "icon_name", "color"])
def test_create_category_missing_required_fields(client, missing_field):
    payload = {
        "name": "Saúde",
        "icon_name": "HeartPulse",
        "budget": 200.0,
        "color": "oklch(0.6 0.2 25)",
    }
    del payload[missing_field]

    response = client.post("/api/categories/", json=payload)

    assert response.status_code == 422
    assert any(missing_field in err["loc"] for err in response.json()["detail"])


def test_create_category_name_exceeds_max_length(client):
    response = client.post("/api/categories/", json={
        "name": "A" * 51,  # max_length=50
        "icon_name": "HeartPulse",
        "color": "oklch(0.6 0.2 25)",
    })

    assert response.status_code == 422


def test_create_category_invalid_budget_type(client):
    response = client.post("/api/categories/", json={
        "name": "Educação",
        "icon_name": "GraduationCap",
        "budget": "muito caro",
        "color": "oklch(0.55 0.15 200)",
    })

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/categories
# ---------------------------------------------------------------------------

def test_list_categories_empty(client):
    response = client.get("/api/categories/")

    assert response.status_code == 200
    assert response.json() == []


def test_list_categories_without_transactions_returns_zeroed_aggregates(client):
    create_category(client, name="Alimentação")
    create_category(client, name="Transporte", icon_name="Car", color="oklch(0.65 0.18 50)")

    response = client.get("/api/categories/")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    for category in data:
        assert category["spent"] == 0.0
        assert category["txs_count"] == 0
