"""Assinaturas no Dashboard — R-7 (`docs/recorrencias.md`).

Escrito **antes** da implementação (13/11/2026). `GET /dashboard/summary` ganha
`active_subscriptions_count`, `monthly_subscriptions_amount` e
`monthly_recurring_amount` (parcelamentos + assinaturas). Os campos que já existem
**não mudam de significado**: continuam só de parcelamento.

Hoje os testes novos ficam vermelhos por `KeyError` do campo que ainda não existe;
os rotulados com ✅ descrevem o que não pode mudar e já passam.
"""

import datetime
from decimal import Decimal

import pytest

from tests.conftest import installment_payload, money

UTC = datetime.timezone.utc


@pytest.fixture(autouse=True)
def _today(time_machine):
    time_machine.move_to(datetime.datetime(2026, 11, 13, 12, tzinfo=UTC), tick=False)


def _summary(client):
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200, response.text
    return response.json()


def _subscription(client, account_id, category_id, **overrides):
    payload = {
        "title": "Netflix",
        "amount": "49.90",
        "category_id": category_id,
        "account_id": account_id,
        "first_charge_date": "2026-11-15",
    }
    payload.update(overrides)
    response = client.post("/api/subscriptions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_without_subscriptions_the_new_fields_are_zero(client):
    summary = _summary(client)

    assert summary["active_subscriptions_count"] == 0
    assert money(summary["monthly_subscriptions_amount"]) == Decimal("0.00")
    assert money(summary["monthly_recurring_amount"]) == Decimal("0.00")


def test_an_active_subscription_counts_and_adds_its_monthly_amount(client, default_account, default_category):
    _subscription(client, default_account, default_category["id"])

    summary = _summary(client)

    assert summary["active_subscriptions_count"] == 1
    assert money(summary["monthly_subscriptions_amount"]) == Decimal("49.90")
    assert money(summary["monthly_recurring_amount"]) == Decimal("49.90")


def test_several_subscriptions_add_up_exactly(client, default_account, default_category):
    cat = default_category["id"]
    _subscription(client, default_account, cat, title="Netflix", amount="49.90")
    _subscription(client, default_account, cat, title="Spotify", amount="19.90")
    _subscription(client, default_account, cat, title="iCloud", amount="0.10")

    summary = _summary(client)

    assert summary["active_subscriptions_count"] == 3
    assert money(summary["monthly_subscriptions_amount"]) == Decimal("69.90")  # 49,90 + 19,90 + 0,10


def test_an_ended_subscription_is_not_counted(client, default_account, default_category):
    cat = default_category["id"]
    _subscription(client, default_account, cat, title="Netflix", amount="49.90")
    old = _subscription(client, default_account, cat, title="Antiga", amount="100.00",
                        first_charge_date="2026-09-15")
    client.patch(f"/api/subscriptions/{old['id']}", json={"ended_on": "2026-11-13"})

    summary = _summary(client)

    assert summary["active_subscriptions_count"] == 1
    assert money(summary["monthly_subscriptions_amount"]) == Decimal("49.90")


def test_the_recurring_total_adds_installments_and_subscriptions(client, default_account, default_category):
    # Parcela 2 de 12 de R$ 500,00 vencendo hoje: comprometido do mês = 500,00.
    created = client.post(
        "/api/installments", json=installment_payload(default_account, default_category["id"])
    )
    assert created.status_code == 201, created.text
    _subscription(client, default_account, default_category["id"])

    summary = _summary(client)

    assert money(summary["monthly_committed_amount"]) == Decimal("500.00")
    assert money(summary["monthly_subscriptions_amount"]) == Decimal("49.90")
    assert money(summary["monthly_recurring_amount"]) == Decimal("549.90")


def test_existing_installment_fields_keep_their_meaning(client, default_account, default_category):
    """✅ Já passa hoje: assinatura não entra em `active_installments_count` nem em
    `monthly_committed_amount`. A aba de Parcelamentos, o insight de Relatórios e o
    teste que iguala estes campos ao `GET /installments/summary` dependem disso."""
    _subscription(client, default_account, default_category["id"])

    summary = _summary(client)

    assert summary["active_installments_count"] == 0
    assert money(summary["monthly_committed_amount"]) == Decimal("0.00")


def test_dashboard_and_subscriptions_summary_agree(client, default_account, default_category):
    cat = default_category["id"]
    _subscription(client, default_account, cat, title="Netflix", amount="49.90")
    _subscription(client, default_account, cat, title="Spotify", amount="19.90")
    old = _subscription(client, default_account, cat, title="Antiga", amount="100.00",
                        first_charge_date="2026-09-15")
    client.patch(f"/api/subscriptions/{old['id']}", json={"ended_on": "2026-11-13"})

    dashboard = _summary(client)
    own = client.get("/api/subscriptions/summary").json()

    assert dashboard["active_subscriptions_count"] == own["active_count"] == 2
    assert money(dashboard["monthly_subscriptions_amount"]) == money(own["monthly_amount"])


def test_a_subscription_of_another_owner_never_reaches_my_dashboard(client_as):
    ana, bia = client_as("ana@example.com"), client_as("bia@example.com")
    for c in (ana, bia):
        assert c.get("/api/auth/me").status_code == 200

    account = ana.get("/api/accounts").json()[0]["id"]
    category = ana.get("/api/categories").json()[0]["id"]
    _subscription(ana, account, category, amount="888.88")

    mine = _summary(bia)

    assert mine["active_subscriptions_count"] == 0
    assert money(mine["monthly_subscriptions_amount"]) == Decimal("0.00")
    assert money(mine["monthly_recurring_amount"]) == Decimal("0.00")
    assert _summary(ana)["active_subscriptions_count"] == 1
