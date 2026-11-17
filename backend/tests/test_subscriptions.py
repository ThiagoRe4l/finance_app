"""Assinaturas — cobrança recorrente que entra sozinha (R-1 a R-6).

Escrito **antes** da implementação (`docs/recorrencias.md`, 13/11/2026). Hoje todo
teste daqui fica vermelho porque a rota não existe: o FastAPI devolve 404
`"Not Found"` em `/api/subscriptions` (e 404 `"Not Found"` também em
`/subscriptions/sync`). Os testes de 404 de assinatura inexistente assertam o
`detail` real ("Assinatura não encontrada."), para não passarem contra o 404 de
rota ausente.

O relógio é fixado em **13/11/2026** (`time_machine`) em quase todo teste: as datas
de cobrança dependem de "hoje" e um teste com data relativa mudaria de resultado
conforme o dia em que roda (backlog 0.1).

O que cada bloco protege:
* cadastro e cobrança retroativa (R-2, R-3);
* `sync` idempotente, que não ressuscita cobrança apagada e não é um GET (R-3);
* edição para frente, cancelar e reativar (R-4);
* leitura e resumo (R-5); validação (R-6);
* isolamento por dono no `sync` (D-Tenant-3).
"""

import datetime
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from tests.conftest import create_category, money, owner_id_of

UTC = datetime.timezone.utc
D = datetime.date


def at(time_machine, y, m, d, hh=12, mm=0):
    time_machine.move_to(datetime.datetime(y, m, d, hh, mm, tzinfo=UTC), tick=False)


@pytest.fixture(autouse=True)
def _today(time_machine):
    """Hoje = 13/11/2026 em todo teste deste arquivo (os que precisam de outro dia
    chamam `at` de novo)."""
    at(time_machine, 2026, 11, 13)


def subscription_payload(account_id, category_id, **overrides):
    payload = {
        "title": "Netflix",
        "amount": "49.90",
        "category_id": category_id,
        "account_id": account_id,
        "first_charge_date": "2026-11-15",
    }
    payload.update(overrides)
    return {key: value for key, value in payload.items() if value is not None}


def create_subscription(client, account_id, category_id, **overrides):
    response = client.post(
        "/api/subscriptions", json=subscription_payload(account_id, category_id, **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()


def charges_of(client, subscription_id):
    """Transações geradas pela assinatura, da mais antiga para a mais nova."""
    rows = [
        t for t in client.get("/api/transactions").json()
        if t["subscription_id"] == subscription_id
    ]
    return sorted(rows, key=lambda t: t["date"])


def sync(client):
    response = client.post("/api/subscriptions/sync")
    assert response.status_code == 200, response.text
    return response.json()["created"]


# ---------------------------------------------------------------------------
# Cadastro (R-1, R-2, R-3)
# ---------------------------------------------------------------------------

def test_create_returns_the_subscription_with_money_as_a_string(client, default_account, default_category):
    body = create_subscription(client, default_account, default_category["id"])

    assert body["title"] == "Netflix"
    assert money(body["amount"]) == Decimal("49.90")
    assert body["account_id"] == default_account
    assert body["category_id"] == default_category["id"]
    assert body["first_charge_date"] == "2026-11-15"
    assert body["ended_on"] is None
    assert body["status"] == "ativa"
    assert body["next_charge_date"] == "2026-11-15"


def test_a_first_charge_in_the_future_creates_no_transaction_yet(client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])

    assert charges_of(client, sub["id"]) == []
    # Nem saldo nem despesas do mês veem uma cobrança que não aconteceu.
    assert money(client.get("/api/accounts").json()[0]["current_balance"]) == Decimal("10000.00")


def test_a_past_first_charge_is_backfilled_up_to_today_and_no_further(client, default_account, default_category):
    sub = create_subscription(
        client, default_account, default_category["id"], first_charge_date="2026-09-15"
    )

    rows = charges_of(client, sub["id"])
    assert [r["date"] for r in rows] == ["2026-09-15", "2026-10-15"]  # 15/11 ainda não chegou
    assert sub["next_charge_date"] == "2026-11-15"


def test_the_charge_due_today_is_posted_on_creation(client, default_account, default_category):
    sub = create_subscription(
        client, default_account, default_category["id"], first_charge_date="2026-11-13"
    )

    assert [r["date"] for r in charges_of(client, sub["id"])] == ["2026-11-13"]
    assert sub["next_charge_date"] == "2026-12-13"


def test_a_generated_charge_is_a_fixed_expense_with_the_subscription_data(client, default_account, default_category):
    sub = create_subscription(
        client, default_account, default_category["id"], first_charge_date="2026-10-15"
    )

    (charge,) = charges_of(client, sub["id"])
    assert charge["type"] == "SAÍDA"
    assert charge["title"] == "Netflix"
    assert money(charge["amount"]) == Decimal("49.90")
    assert charge["is_fixed"] is True
    assert charge["account_id"] == default_account
    assert charge["category"]["id"] == default_category["id"]
    assert charge["subscription_id"] == sub["id"]


def test_an_ordinary_transaction_has_no_subscription_id(client, default_account, default_category):
    from tests.conftest import create_transaction

    create_transaction(client, default_account, default_category["id"], "SAÍDA", 10.0)

    assert client.get("/api/transactions").json()[0]["subscription_id"] is None


def test_charges_hit_the_balance_only_for_dates_up_to_today(client, default_account, default_category):
    create_subscription(client, default_account, default_category["id"], first_charge_date="2026-09-15")

    # 15/09 e 15/10: R$ 99,80. A cobrança de 15/11 não existe ainda.
    assert money(client.get("/api/accounts").json()[0]["current_balance"]) == Decimal("9900.20")


def test_day_31_is_backfilled_with_the_clamped_dates(client, default_account, default_category):
    sub = create_subscription(
        client, default_account, default_category["id"], first_charge_date="2025-12-31"
    )

    assert [r["date"] for r in charges_of(client, sub["id"])] == [
        "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
        "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31",
    ]


# ---------------------------------------------------------------------------
# sync (R-3)
# ---------------------------------------------------------------------------

def test_sync_posts_the_charge_when_its_day_arrives(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])  # 1ª cobrança: 15/11

    at(time_machine, 2026, 11, 14)
    assert sync(client) == 0
    at(time_machine, 2026, 11, 15)
    assert sync(client) == 1
    assert [r["date"] for r in charges_of(client, sub["id"])] == ["2026-11-15"]


def test_sync_is_idempotent(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])
    at(time_machine, 2026, 12, 20)

    assert sync(client) == 2  # 15/11 e 15/12
    assert sync(client) == 0
    assert sync(client) == 0
    assert len(charges_of(client, sub["id"])) == 2


def test_sync_catches_up_every_month_missed_while_the_app_was_closed(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])
    at(time_machine, 2027, 3, 1)

    assert sync(client) == 4  # 15/11, 15/12, 15/01, 15/02
    assert [r["date"] for r in charges_of(client, sub["id"])] == [
        "2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15",
    ]


def test_sync_does_not_resurrect_a_charge_the_user_deleted(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"], first_charge_date="2026-10-15")
    (charge,) = charges_of(client, sub["id"])
    assert client.delete(f"/api/transactions/{charge['id']}").status_code == 204

    assert sync(client) == 0
    at(time_machine, 2026, 11, 16)
    assert sync(client) == 1  # só a de novembro
    assert [r["date"] for r in charges_of(client, sub["id"])] == ["2026-11-15"]


def test_reading_the_list_never_writes_charges(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])
    at(time_machine, 2027, 1, 1)

    assert client.get("/api/subscriptions").status_code == 200
    assert client.get("/api/subscriptions/summary").status_code == 200
    assert client.get("/api/dashboard/summary").status_code == 200

    assert charges_of(client, sub["id"]) == []


def test_sync_handles_several_subscriptions(time_machine, client, default_account, default_category):
    cat = default_category["id"]
    a = create_subscription(client, default_account, cat, title="Netflix", first_charge_date="2026-11-15")
    b = create_subscription(client, default_account, cat, title="Spotify", amount="21.90",
                            first_charge_date="2026-11-20")
    at(time_machine, 2026, 11, 25)

    assert sync(client) == 2
    assert [r["title"] for r in charges_of(client, a["id"])] == ["Netflix"]
    assert [money(r["amount"]) for r in charges_of(client, b["id"])] == [Decimal("21.90")]


def test_two_charges_of_the_same_subscription_on_the_same_day_cannot_coexist(session, client, default_account, default_category):
    """O banco recusa a duplicata — é a proteção contra duas requisições de `sync`
    simultâneas, que o cursor sozinho não cobre."""
    from app import models

    sub = create_subscription(
        client, default_account, default_category["id"], first_charge_date="2026-10-15"
    )
    owner = owner_id_of(session)

    session.add(models.Transaction(
        owner_id=owner, title="Netflix", type="SAÍDA", amount=Decimal("49.90"),
        date=D(2026, 10, 15), category_id=default_category["id"], is_fixed=True,
        account_id=default_account, subscription_id=sub["id"],
    ))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


# ---------------------------------------------------------------------------
# Edição, cancelamento, exclusão (R-4)
# ---------------------------------------------------------------------------

def test_a_price_change_only_applies_to_future_charges(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"], first_charge_date="2026-09-15")

    response = client.patch(f"/api/subscriptions/{sub['id']}", json={"amount": "59.90"})
    assert response.status_code == 200
    assert money(response.json()["amount"]) == Decimal("59.90")

    at(time_machine, 2026, 12, 16)
    assert sync(client) == 2
    assert [(r["date"], money(r["amount"])) for r in charges_of(client, sub["id"])] == [
        ("2026-09-15", Decimal("49.90")),
        ("2026-10-15", Decimal("49.90")),
        ("2026-11-15", Decimal("59.90")),
        ("2026-12-15", Decimal("59.90")),
    ]


def test_a_title_or_category_change_does_not_rewrite_posted_charges(client, default_account, default_category):
    other = create_category(client, "Lazer")
    sub = create_subscription(client, default_account, default_category["id"], first_charge_date="2026-10-15")

    response = client.patch(
        f"/api/subscriptions/{sub['id']}", json={"title": "Netflix Premium", "category_id": other["id"]}
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Netflix Premium"

    (charge,) = charges_of(client, sub["id"])
    assert charge["title"] == "Netflix"
    assert charge["category"]["id"] == default_category["id"]


@pytest.mark.parametrize("field,value", [
    ("first_charge_date", "2026-01-01"),
    ("account_id", 1),
    ("charged_through", "2026-01-01"),
    ("owner_id", 99),
    ("ignored", "x"),
])
def test_patch_refuses_fields_that_are_not_editable(client, default_account, default_category, field, value):
    sub = create_subscription(client, default_account, default_category["id"])

    response = client.patch(f"/api/subscriptions/{sub['id']}", json={field: value})

    assert response.status_code == 422


def test_cancelling_stops_future_charges_and_keeps_the_history(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"], first_charge_date="2026-09-15")

    response = client.patch(f"/api/subscriptions/{sub['id']}", json={"ended_on": "2026-11-13"})
    assert response.status_code == 200
    assert response.json()["status"] == "encerrada"
    assert response.json()["next_charge_date"] is None

    at(time_machine, 2027, 1, 1)
    assert sync(client) == 0
    assert [r["date"] for r in charges_of(client, sub["id"])] == ["2026-09-15", "2026-10-15"]


def test_a_charge_exactly_on_the_end_date_is_still_posted(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])  # 1ª: 15/11
    client.patch(f"/api/subscriptions/{sub['id']}", json={"ended_on": "2026-12-15"})

    at(time_machine, 2027, 3, 1)
    assert sync(client) == 2  # 15/11 e 15/12, e nenhuma depois
    assert [r["date"] for r in charges_of(client, sub["id"])] == ["2026-11-15", "2026-12-15"]


def test_a_scheduled_end_date_keeps_the_subscription_active_until_then(client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])  # próxima: 15/11

    response = client.patch(f"/api/subscriptions/{sub['id']}", json={"ended_on": "2026-11-20"})

    assert response.json()["status"] == "ativa"
    assert response.json()["next_charge_date"] == "2026-11-15"


def test_reactivating_does_not_post_the_months_skipped_while_it_was_ended(time_machine, client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"], first_charge_date="2026-09-15")
    client.patch(f"/api/subscriptions/{sub['id']}", json={"ended_on": "2026-11-13"})

    at(time_machine, 2026, 12, 20)
    response = client.patch(f"/api/subscriptions/{sub['id']}", json={"ended_on": None})
    assert response.status_code == 200
    assert response.json()["status"] == "ativa"
    assert sync(client) == 0  # 15/11 e 15/12 passaram com ela encerrada

    at(time_machine, 2027, 1, 16)
    assert sync(client) == 1
    assert [r["date"] for r in charges_of(client, sub["id"])][-1] == "2027-01-15"


def test_delete_removes_the_subscription_but_keeps_the_posted_charges(client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"], first_charge_date="2026-09-15")

    response = client.delete(f"/api/subscriptions/{sub['id']}")
    assert response.status_code == 204
    assert client.get("/api/subscriptions").json() == []

    rows = [t for t in client.get("/api/transactions").json() if t["title"] == "Netflix"]
    assert len(rows) == 2
    assert all(t["subscription_id"] is None for t in rows)


def test_deleting_an_unknown_subscription_is_404_with_the_real_detail(client):
    response = client.delete("/api/subscriptions/987654")

    assert response.status_code == 404
    assert response.json()["detail"] == "Assinatura não encontrada."


def test_patching_an_unknown_subscription_is_404_with_the_real_detail(client):
    response = client.patch("/api/subscriptions/987654", json={"title": "x"})

    assert response.status_code == 404
    assert response.json()["detail"] == "Assinatura não encontrada."


# ---------------------------------------------------------------------------
# Leitura (R-5)
# ---------------------------------------------------------------------------

def test_list_returns_every_subscription_with_its_next_charge(client, default_account, default_category):
    cat = default_category["id"]
    create_subscription(client, default_account, cat, title="Netflix", first_charge_date="2026-11-15")
    create_subscription(client, default_account, cat, title="Spotify", amount="21.90",
                        first_charge_date="2026-11-05")

    rows = {r["title"]: r for r in client.get("/api/subscriptions").json()}

    assert set(rows) == {"Netflix", "Spotify"}
    assert rows["Netflix"]["next_charge_date"] == "2026-11-15"
    assert rows["Spotify"]["next_charge_date"] == "2026-12-05"  # a de novembro já foi lançada


def test_summary_adds_only_the_active_subscriptions_in_decimal(client, default_account, default_category):
    cat = default_category["id"]
    create_subscription(client, default_account, cat, title="Netflix", amount="49.90")
    create_subscription(client, default_account, cat, title="Spotify", amount="19.90")
    ended = create_subscription(client, default_account, cat, title="Antiga", amount="100.00",
                                first_charge_date="2026-09-15")
    client.patch(f"/api/subscriptions/{ended['id']}", json={"ended_on": "2026-11-13"})

    summary = client.get("/api/subscriptions/summary").json()

    assert summary["active_count"] == 2
    assert money(summary["monthly_amount"]) == Decimal("69.80")


def test_summary_of_an_empty_account_is_zero(client):
    summary = client.get("/api/subscriptions/summary").json()

    assert summary["active_count"] == 0
    assert money(summary["monthly_amount"]) == Decimal("0.00")


def test_the_summary_route_is_not_shadowed_by_an_id_route(client):
    """`/subscriptions/summary` e `/subscriptions/sync` casam com `/{id}`: têm que
    vir antes, ou o FastAPI tenta converter "summary" em int (422)."""
    assert client.get("/api/subscriptions/summary").status_code == 200
    assert client.post("/api/subscriptions/sync").status_code == 200


# ---------------------------------------------------------------------------
# Validação (R-2, R-6)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("overrides", [
    {"amount": "0"},
    {"amount": "-10.00"},
    {"amount": "10.005"},
    {"title": ""},
    {"title": "x" * 101},
    {"first_charge_date": "1899-12-31"},
    {"first_charge_date": "2201-01-01"},
    {"first_charge_date": "2025-11-12"},   # 12 meses e 1 dia atrás
    {"unknown_field": "x"},
])
def test_create_rejects_invalid_payloads(client, default_account, default_category, overrides):
    response = client.post(
        "/api/subscriptions", json=subscription_payload(default_account, default_category["id"], **overrides)
    )

    assert response.status_code == 422
    assert client.get("/api/subscriptions").json() == []
    assert client.get("/api/transactions").json() == []


def test_create_accepts_a_first_charge_exactly_twelve_months_back(client, default_account, default_category):
    sub = create_subscription(
        client, default_account, default_category["id"], first_charge_date="2025-11-13"
    )

    assert len(charges_of(client, sub["id"])) == 13  # 13/11/2025 a 13/11/2026


def test_create_with_an_unknown_account_is_404_and_writes_nothing(client, default_category):
    response = client.post("/api/subscriptions", json=subscription_payload(987654, default_category["id"]))

    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."
    assert client.get("/api/subscriptions").json() == []


def test_create_with_an_unknown_category_is_404_and_writes_nothing(client, default_account):
    response = client.post("/api/subscriptions", json=subscription_payload(default_account, 987654))

    assert response.status_code == 404
    assert response.json()["detail"] == "Categoria não encontrada."
    assert client.get("/api/subscriptions").json() == []
    assert client.get("/api/transactions").json() == []


def test_patch_with_an_unknown_category_is_404(client, default_account, default_category):
    sub = create_subscription(client, default_account, default_category["id"])

    response = client.patch(f"/api/subscriptions/{sub['id']}", json={"category_id": 987654})

    assert response.status_code == 404
    assert response.json()["detail"] == "Categoria não encontrada."


@pytest.mark.parametrize("amount", ["0", "-1.00", "1.234"])
def test_patch_rejects_an_invalid_amount(client, default_account, default_category, amount):
    sub = create_subscription(client, default_account, default_category["id"])

    assert client.patch(f"/api/subscriptions/{sub['id']}", json={"amount": amount}).status_code == 422


# ---------------------------------------------------------------------------
# Autenticação e dono (D-Tenant-3)
# ---------------------------------------------------------------------------

def test_the_sync_route_requires_a_session(anon_client):
    response = anon_client.post("/api/subscriptions/sync")

    assert response.status_code == 401


def test_sync_only_posts_the_charges_of_the_caller(time_machine, client_as):
    """Se o `sync` varresse todas as assinaturas do banco, a chamada da Bia
    lançaria a cobrança da Ana — no ledger da Ana, sem ela ter aberto o app."""
    ana, bia = client_as("ana@example.com"), client_as("bia@example.com")
    assert ana.get("/api/auth/me").status_code == 200
    assert bia.get("/api/auth/me").status_code == 200

    # O `client_as` provisiona conta e categorias padrão no primeiro acesso (D-Tenant-5):
    # usa o que já existe, em vez de criar "Conta Principal" de novo (400, nome repetido).
    account = ana.get("/api/accounts").json()[0]["id"]
    category = ana.get("/api/categories").json()[0]
    sub = create_subscription(ana, account, category["id"])  # 1ª cobrança: 15/11
    at(time_machine, 2026, 11, 20)

    assert sync(bia) == 0
    assert charges_of(ana, sub["id"]) == []
    assert sync(ana) == 1
    assert len(charges_of(ana, sub["id"])) == 1
    assert bia.get("/api/subscriptions").json() == []
