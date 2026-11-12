"""Parcelamento gera as próprias transações, com cronograma calculado.

Issues #3 e #4. Decisão em `docs/design-patterns.md` → "Parcelamento gera as
próprias transações" (P-1 a P-7), registrada em 11/11/2026 antes deste arquivo.

Escrito **antes** da implementação. A aprovação foi delegada pelo usuário em
11/11/2026. Todo teste que espera 404 assere o `detail`: `DELETE
/installments/{id}` e `/installments/preview` não existem hoje, e o 404/405 do
FastAPI passaria pelo motivo errado.

Datas literais aqui **não** dependem do mês em que a suíte roda: nenhum teste
com data fixa assere agregado do mês corrente (backlog 0.1). Os que assertam o
dashboard usam `date.today()`.
"""

import datetime
from decimal import Decimal

import pytest

from tests.conftest import create_account, create_category, money

PARCELAMENTO_INEXISTENTE = 9999

# `default_account` é o **id** (int); `default_category` é o objeto (conftest).


def payload(account_id, category_id, **overrides):
    body = {
        "title": "Geladeira",
        "category_id": category_id,
        "account_id": account_id,
        "installment_amount": "500.00",
        "total_installments": 5,
        "current_installment": 3,
        "current_due_date": "2026-03-15",
    }
    body.update(overrides)
    return {k: v for k, v in body.items() if v is not None}


def create(client, account_id, category_id, **overrides):
    response = client.post(
        "/api/installments", json=payload(account_id, category_id, **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()


def parcels(client, installment_id):
    rows = client.get("/api/transactions").json()
    return sorted(
        (t for t in rows if t["installment_id"] == installment_id),
        # Ligadas à mão (`installment_number` nulo) vão para o fim.
        key=lambda t: (t["installment_number"] is None, t["installment_number"] or 0),
    )


# --- P-1 / P-2: geração -----------------------------------------------------


def test_creation_generates_one_expense_per_remaining_installment(
    client, default_account, default_category
):
    inst = create(client, default_account, default_category["id"])

    rows = parcels(client, inst["id"])
    assert [t["installment_number"] for t in rows] == [3, 4, 5]
    assert [t["date"] for t in rows] == ["2026-03-15", "2026-04-15", "2026-05-15"]
    for t in rows:
        assert t["type"] == "SAÍDA"
        assert money(t["amount"]) == Decimal("500.00")
        assert t["title"] == "Geladeira"
        assert t["category"]["id"] == default_category["id"]
        assert t["account_id"] == default_account
        assert t["is_fixed"] is False


def test_installments_before_the_current_one_are_not_generated(
    client, default_account, default_category
):
    """P-2: "3 de 5" já pagou a 1 e a 2 antes do app — gerar duplicaria."""
    inst = create(client, default_account, default_category["id"])
    numbers = [t["installment_number"] for t in parcels(client, inst["id"])]
    assert 1 not in numbers and 2 not in numbers


def test_transaction_response_carries_installment_number(
    client, default_account, default_category
):
    inst = create(client, default_account, default_category["id"])
    first = parcels(client, inst["id"])[0]
    one = client.get(f"/api/transactions/{first['id']}")
    if one.status_code == 405:  # sem GET por id: a listagem basta
        return
    assert one.json()["installment_number"] == 3


# --- P-3: cronograma ----------------------------------------------------------


def test_response_has_computed_first_due_date_and_end_date(
    client, default_account, default_category
):
    inst = create(client, default_account, default_category["id"])
    assert inst["first_due_date"] == "2026-01-15"
    assert inst["end_date"] == "Mai/2026"
    assert inst["current_installment"] == 3
    assert inst["total_installments"] == 5


def test_schedule_crosses_the_year(client, default_account, default_category):
    inst = create(
        client,
        default_account,
        default_category["id"],
        total_installments=4,
        current_installment=1,
        current_due_date="2026-11-30",
    )
    assert [t["date"] for t in parcels(client, inst["id"])] == [
        "2026-11-30",
        "2026-12-30",
        "2027-01-30",
        "2027-02-28",
    ]
    assert inst["end_date"] == "Fev/2027"


def test_day_is_anchored_on_the_current_due_date_not_the_clamped_first(
    client, default_account, default_category
):
    """31/03 na parcela 2: a 1 cai em 28/02, mas a 3 tem que voltar a 30/04,
    e não herdar o 28 do mês curto."""
    inst = create(
        client,
        default_account,
        default_category["id"],
        total_installments=3,
        current_installment=2,
        current_due_date="2026-03-31",
    )
    assert inst["first_due_date"] == "2026-02-28"
    assert [t["date"] for t in parcels(client, inst["id"])] == [
        "2026-03-31",
        "2026-04-30",
    ]


def test_end_date_is_no_longer_accepted(client, default_account, default_category):
    response = client.post(
        "/api/installments",
        json=payload(
            default_account, default_category["id"], end_date="Ago/2026"
        ),
    )
    assert response.status_code == 422


def test_current_due_date_is_required(client, default_account, default_category):
    response = client.post(
        "/api/installments",
        json=payload(
            default_account, default_category["id"], current_due_date=None
        ),
    )
    assert response.status_code == 422


# --- P-4: valor total ou valor da parcela -----------------------------------


def test_total_amount_is_split_with_leftover_cents_on_the_first_installments(
    client, default_account, default_category
):
    inst = create(
        client,
        default_account,
        default_category["id"],
        installment_amount=None,
        total_amount="100.00",
        total_installments=3,
        current_installment=1,
    )
    amounts = [money(t["amount"]) for t in parcels(client, inst["id"])]
    assert amounts == [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")]
    assert sum(amounts) == Decimal("100.00")
    assert money(inst["total_amount"]) == Decimal("100.00")
    assert money(inst["installment_amount"]) == Decimal("33.33")
    assert money(inst["remaining_amount"]) == Decimal("100.00")


def test_remaining_amount_is_exact_when_starting_mid_way(
    client, default_account, default_category
):
    inst = create(
        client,
        default_account,
        default_category["id"],
        installment_amount=None,
        total_amount="100.00",
        total_installments=3,
        current_installment=2,
    )
    amounts = [money(t["amount"]) for t in parcels(client, inst["id"])]
    assert amounts == [Decimal("33.33"), Decimal("33.33")]
    assert money(inst["remaining_amount"]) == Decimal("66.66")


def test_installment_amount_gives_equal_installments_and_total(
    client, default_account, default_category
):
    inst = create(client, default_account, default_category["id"])
    assert money(inst["total_amount"]) == Decimal("2500.00")
    assert money(inst["remaining_amount"]) == Decimal("1500.00")


@pytest.mark.parametrize(
    "amounts",
    [
        {"installment_amount": "500.00", "total_amount": "2500.00"},
        {"installment_amount": None},
    ],
    ids=["both", "neither"],
)
def test_exactly_one_of_total_or_installment_amount(
    client, default_account, default_category, amounts
):
    response = client.post(
        "/api/installments",
        json=payload(default_account, default_category["id"], **amounts),
    )
    assert response.status_code == 422


# --- P-5: validação ----------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"current_installment": 6},
        {"current_installment": 0},
        {"total_installments": 0},
        {"total_installments": 121, "current_installment": 1},
        {"installment_amount": "10.001"},
        {"installment_amount": "0"},
    ],
    ids=["current>total", "current=0", "total=0", "total>120", "3-decimals", "zero"],
)
def test_invalid_schedule_is_rejected(
    client, default_account, default_category, overrides
):
    response = client.post(
        "/api/installments",
        json=payload(default_account, default_category["id"], **overrides),
    )
    assert response.status_code == 422, response.text
    assert client.get("/api/transactions").json() == []
    assert client.get("/api/installments").json() == []


def test_unknown_account_creates_nothing(client, default_category):
    response = client.post(
        "/api/installments", json=payload(9999, default_category["id"])
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."
    assert client.get("/api/transactions").json() == []
    assert client.get("/api/installments").json() == []


# --- Preview -----------------------------------------------------------------


def test_preview_returns_the_schedule_without_persisting(client, default_account):
    response = client.post(
        "/api/installments/preview",
        json={
            "total_amount": "100.00",
            "total_installments": 3,
            "current_installment": 1,
            "current_due_date": "2026-11-10",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert money(body["installment_amount"]) == Decimal("33.33")
    assert money(body["total_amount"]) == Decimal("100.00")
    assert money(body["remaining_amount"]) == Decimal("100.00")
    assert body["end_date"] == "Jan/2027"
    assert body["first_due_date"] == "2026-11-10"
    assert [(p["number"], p["date"]) for p in body["installments"]] == [
        (1, "2026-11-10"),
        (2, "2026-12-10"),
        (3, "2027-01-10"),
    ]
    assert [money(p["amount"]) for p in body["installments"]] == [
        Decimal("33.34"),
        Decimal("33.33"),
        Decimal("33.33"),
    ]
    assert client.get("/api/installments").json() == []
    assert client.get("/api/transactions").json() == []


def test_preview_validates_like_creation(client):
    response = client.post(
        "/api/installments/preview",
        json={
            "installment_amount": "10.00",
            "total_installments": 3,
            "current_installment": 4,
            "current_due_date": "2026-11-10",
        },
    )
    assert response.status_code == 422


# --- Totais (dashboard, categorias, saldo) -----------------------------------


def test_current_month_installment_counts_in_dashboard_and_category(
    client, default_account, default_category
):
    today = datetime.date.today()
    create(
        client,
        default_account,
        default_category["id"],
        total_installments=3,
        current_installment=1,
        current_due_date=today.isoformat(),
    )
    summary = client.get("/api/dashboard/summary").json()
    assert money(summary["total_expenses"]) == Decimal("500.00")

    by_id = {c["id"]: c for c in client.get("/api/categories").json()}
    assert money(by_id[default_category["id"]]["spent"]) == Decimal("500.00")


def test_generated_installments_reduce_the_balance_now(
    client, default_category
):
    """⚠️ Consequência aceita da decisão (saldo sem recorte de data), a
    confirmar com o usuário: as parcelas futuras já contam no saldo."""
    account_id = create_account(client, initial_balance=10000.0)
    create(client, account_id, default_category["id"])
    accounts = {a["id"]: a for a in client.get("/api/accounts").json()}
    assert money(accounts[account_id]["current_balance"]) == Decimal("8500.00")


# --- P-6: edição e exclusão --------------------------------------------------


def _manual_link(client, account_id, category_id, installment_id):
    response = client.post(
        "/api/transactions",
        json={
            "title": "Lançada à mão",
            "type": "SAÍDA",
            "amount": "500.00",
            "date": "2026-02-15",
            "category_id": category_id,
            "account_id": account_id,
            "installment_id": installment_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_patch_title_and_category_propagate_to_generated_installments(
    client, default_account, default_category
):
    inst = create(client, default_account, default_category["id"])
    manual = _manual_link(
        client, default_account, default_category["id"], inst["id"]
    )
    other = create_category(client, name="Casa")

    response = client.patch(
        f"/api/installments/{inst['id']}",
        json={"title": "Geladeira Brastemp", "category_id": other["id"]},
    )
    assert response.status_code == 200, response.text

    for t in parcels(client, inst["id"]):
        if t["installment_number"] is None:
            continue
        assert t["title"] == "Geladeira Brastemp"
        assert t["category"]["id"] == other["id"]

    rows = {t["id"]: t for t in client.get("/api/transactions").json()}
    assert rows[manual["id"]]["title"] == "Lançada à mão"
    assert rows[manual["id"]]["category"]["id"] == default_category["id"]


def test_patch_end_date_is_rejected(client, default_account, default_category):
    inst = create(client, default_account, default_category["id"])
    response = client.patch(
        f"/api/installments/{inst['id']}", json={"end_date": "Dez/2030"}
    )
    assert response.status_code == 422


def test_changing_the_amount_is_locked_once_installments_are_generated(
    client, default_account, default_category
):
    """D15 aplicada: todo parcelamento novo tem parcela gerada."""
    inst = create(client, default_account, default_category["id"])
    response = client.patch(
        f"/api/installments/{inst['id']}", json={"installment_amount": "600.00"}
    )
    assert response.status_code == 409


def test_delete_removes_generated_and_unlinks_manual_transactions(
    client, default_account, default_category
):
    inst = create(client, default_account, default_category["id"])
    manual = _manual_link(
        client, default_account, default_category["id"], inst["id"]
    )

    response = client.delete(f"/api/installments/{inst['id']}")
    assert response.status_code == 204, response.text

    rows = client.get("/api/transactions").json()
    assert [t["id"] for t in rows] == [manual["id"]]
    assert rows[0]["installment_id"] is None
    assert rows[0]["installment_number"] is None
    assert client.get("/api/installments").json() == []


def test_delete_unknown_installment_is_404_with_detail(client):
    response = client.delete(f"/api/installments/{PARCELAMENTO_INEXISTENTE}")
    assert response.status_code == 404
    assert response.json()["detail"] == "Parcelamento não encontrado."


def test_unlinking_a_generated_installment_clears_its_number(
    client, default_account, default_category
):
    inst = create(client, default_account, default_category["id"])
    first = parcels(client, inst["id"])[0]
    response = client.patch(
        f"/api/transactions/{first['id']}", json={"installment_id": None}
    )
    assert response.status_code == 200, response.text
    assert response.json()["installment_id"] is None
    assert response.json()["installment_number"] is None


# --- Revisão do backend, 12/11/2026 (escrito antes da correção) --------------


@pytest.mark.parametrize("route", ["/api/installments", "/api/installments/preview"])
def test_total_too_small_for_one_cent_per_installment_is_rejected(
    client, default_account, default_category, route
):
    """R$ 0,02 em 3 daria uma parcela de R$ 0,00 — uma SAÍDA de zero, que o
    próprio `TransactionCreate` recusaria."""
    body = payload(
        default_account, default_category["id"],
        installment_amount=None, total_amount="0.02",
        total_installments=3, current_installment=1,
    )
    if route.endswith("preview"):
        body = {k: v for k, v in body.items() if k not in ("title", "category_id", "account_id")}
    response = client.post(route, json=body)
    assert response.status_code == 422, response.text
    assert client.get("/api/transactions").json() == []


@pytest.mark.parametrize(
    "due,current,total",
    [("0001-01-15", 5, 5), ("9999-12-15", 1, 10)],
    ids=["antes-do-ano-1", "depois-de-9999"],
)
def test_schedule_out_of_calendar_range_is_422_not_500(client, due, current, total):
    """Revisão de segurança, 12/11/2026: `add_months` estourava o calendário e
    o router devolvia 500."""
    response = client.post("/api/installments/preview", json={
        "installment_amount": "10.00", "total_installments": total,
        "current_installment": current, "current_due_date": due,
    })
    assert response.status_code == 422, response.text
