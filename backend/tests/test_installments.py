"""CRUD do router de parcelamentos.

`category_name` (string livre) virou `category_id` (FK). O 404 de categoria
inexistente e a categoria aninhada na response são testados em
`test_category_fk.py`; aqui fica o resto do CRUD.

Fixtures vêm do `conftest.py`.
"""

import datetime
from decimal import Decimal

import pytest

from app.installment_schedule import add_months, month_label
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
    # Calculado do cronograma (P-3): parcela 2 hoje → a 1 há um mês, a 12
    # daqui a dez meses (datas relativas, backlog 0.1).
    today = datetime.date.today()
    assert data["end_date"] == month_label(add_months(today, 10))
    assert data["first_due_date"] == add_months(today, -1).isoformat()
    assert data["account_id"] == default_account


def test_create_installment_debits_only_the_parcel_already_due(client, default_account, category_id):
    """⚠️ **Mudou duas vezes.** Até 10/11 era `..._does_not_touch_account_balance`
    (criar não mexia no saldo). Em 11/11 (P-1) as parcelas 2 a 12 passaram a ser
    SAÍDAs e, sem recorte de data, o saldo caía 11 × 500. Desde 12/11 (S-1,
    resposta 1b do usuário) o saldo para em hoje: só a parcela 2, que vence
    hoje, sai — 10.000 − 500."""
    client.post("/api/installments/", json=installment_payload(default_account, category_id))

    account = client.get("/api/accounts").json()[0]
    assert money(account["current_balance"]) == Decimal("9500.00")


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
    "installment_amount",
    "total_installments",
    "current_due_date",
    "account_id",
])
def test_create_installment_missing_required_fields(client, default_account, category_id, missing_field):
    """Campos obrigatórios do cadastro (P-3 a P-5).

    Saíram da lista em 11/11/2026: `end_date` (calculado, agora proibido),
    `total_amount` (é um **ou** outro com `installment_amount`) e
    `current_installment` (default 1). Sem `installment_amount` o payload fica
    sem valor nenhum, e o erro vem do validador do modelo, não do campo."""
    payload = installment_payload(default_account, category_id)
    del payload[missing_field]

    response = client.post("/api/installments/", json=payload)

    assert response.status_code == 422
    errors = response.json()["detail"]
    if missing_field == "installment_amount":
        assert any("exatamente um" in err["msg"] for err in errors)
    else:
        assert any(missing_field in err["loc"] for err in errors)


def test_create_installment_title_exceeds_max_length(client, default_account, category_id):
    response = client.post(
        "/api/installments/",
        json=installment_payload(default_account, category_id, title="A" * 101),  # max_length=100
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field,bad_value", [
    ("installment_amount", "quinhentos"),
    ("current_due_date", "ontem"),
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
        installment_amount="250.00",
        current_installment=5,
        total_installments=12,
        current_due_date="2020-05-10",
    ))

    response = client.get("/api/installments/")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2

    by_title = {i["title"]: i for i in data}
    assert by_title["Notebook Dell"]["current_installment"] == 2
    assert money(by_title["Geladeira"]["installment_amount"]) == Decimal("250.00")
    assert by_title["Geladeira"]["end_date"] == "Dez/2020"
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
