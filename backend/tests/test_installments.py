"""CRUD do router de parcelamentos.

`category_name` (string livre) virou `category_id` (FK). O 404 de categoria
inexistente e a categoria aninhada na response são testados em
`test_category_fk.py`; aqui fica o resto do CRUD.

Fixtures vêm do `conftest.py`.
"""

from decimal import Decimal

import pytest

from tests.conftest import money, create_account, create_category, installment_payload


@pytest.fixture(name="category_id")
def category_id_fixture(default_category):
    return default_category["id"]


# ---------------------------------------------------------------------------
# POST /api/installments
# ---------------------------------------------------------------------------

def test_create_installment(client, default_account, category_id):
    response = client.post(
        "/api/installments/", json=installment_payload(default_account, category_id)
    )

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["id"] is not None
    assert data["title"] == "Notebook Dell"
    assert data["category_id"] == category_id
    assert money(data["total_amount"]) == Decimal("6000.00")
    assert money(data["installment_amount"]) == Decimal("500.00")
    assert data["current_installment"] == 2
    assert data["total_installments"] == 12
    assert data["end_date"] == "Ago/2026"
    assert data["account_id"] == default_account


def test_create_installment_does_not_touch_account_balance(client, default_account, category_id):
    """Criar o parcelamento é só um registro de acompanhamento — o débito
    acontece quando uma transação é vinculada a ele, não aqui."""
    client.post("/api/installments/", json=installment_payload(default_account, category_id))

    account = client.get("/api/accounts").json()[0]
    assert money(account["current_balance"]) == Decimal("10000.00")


def test_create_installment_account_not_found(client, category_id):
    response = client.post("/api/installments/", json=installment_payload(9999, category_id))

    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."


def test_create_installment_with_invalid_account_persists_nothing(client, category_id):
    client.post("/api/installments/", json=installment_payload(9999, category_id))

    listed = client.get("/api/installments/")
    assert listed.status_code == 200
    assert listed.json() == []


@pytest.mark.parametrize("missing_field", [
    "title",
    "category_id",
    "total_amount",
    "installment_amount",
    "current_installment",
    "total_installments",
    "end_date",
    "account_id",
])
def test_create_installment_missing_required_fields(client, default_account, category_id, missing_field):
    """Nenhum campo do InstallmentBase tem default — todos são obrigatórios."""
    payload = installment_payload(default_account, category_id)
    del payload[missing_field]

    response = client.post("/api/installments/", json=payload)

    assert response.status_code == 422
    assert any(missing_field in err["loc"] for err in response.json()["detail"])


def test_create_installment_title_exceeds_max_length(client, default_account, category_id):
    response = client.post(
        "/api/installments/",
        json=installment_payload(default_account, category_id, title="A" * 101),  # max_length=100
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field,bad_value", [
    ("total_amount", "seis mil"),
    ("installment_amount", "quinhentos"),
    ("current_installment", "duas"),
    ("total_installments", 12.5),
    ("account_id", "abc"),
    ("category_id", "abc"),
])
def test_create_installment_invalid_data_types(client, default_account, category_id, field, bad_value):
    payload = installment_payload(default_account, category_id)
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


def test_list_installments_returns_all_records(client, default_account, category_id):
    casa = create_category(client, name="Casa", icon_name="Home", color="oklch(0.45 0.04 235)")

    client.post("/api/installments/", json=installment_payload(default_account, category_id))
    client.post("/api/installments/", json=installment_payload(
        default_account,
        casa["id"],
        title="Geladeira",
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
    assert money(by_title["Geladeira"]["installment_amount"]) == Decimal("250.00")
    assert by_title["Geladeira"]["end_date"] == "Dez/2026"
    assert by_title["Geladeira"]["category"]["name"] == "Casa"


def test_list_installments_scoped_across_multiple_accounts(client, category_id):
    """`GET /installments` não filtra por conta: devolve a carteira inteira,
    com o account_id preservado em cada item."""
    account_a = create_account(client, name="Banco Inter")
    account_b = create_account(client, name="Nubank")

    client.post("/api/installments/", json=installment_payload(account_a, category_id, title="Notebook"))
    client.post("/api/installments/", json=installment_payload(account_b, category_id, title="Celular"))

    data = client.get("/api/installments/").json()

    assert len(data) == 2
    assert {i["title"]: i["account_id"] for i in data} == {
        "Notebook": account_a,
        "Celular": account_b,
    }
