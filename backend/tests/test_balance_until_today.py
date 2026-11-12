"""Saldo até hoje, saldo comprometido e parcela atual pela data.

Decisão em `docs/design-patterns.md` → "Saldo até hoje, saldo comprometido e
parcela atual pela data" (S-1 a S-4), registrada em 12/11/2026 antes deste
arquivo, com as respostas do usuário (1b, 2b, 3).

Escrito **antes** da implementação. As datas são **relativas a hoje**
(`add_months(hoje, n)`), nunca literais: nada aqui depende do mês em que a
suíte roda (backlog 0.1).
"""

import datetime
from decimal import Decimal

from app import models
from app.installment_schedule import add_months
from tests.conftest import create_account, create_transaction, money, owner_id_of

TODAY = datetime.date.today()


def iso(months: int, day: int | None = None) -> str:
    base = TODAY if day is None else TODAY.replace(day=day)
    return add_months(base, months).isoformat()


def create(client, account_id, category_id, **overrides):
    body = {
        "title": "Geladeira", "category_id": category_id, "account_id": account_id,
        "installment_amount": "100.00", "total_installments": 5,
        "current_installment": 1, "current_due_date": TODAY.isoformat(),
    }
    body.update(overrides)
    response = client.post("/api/installments", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def balance(client, account_id):
    rows = {a["id"]: a for a in client.get("/api/accounts").json()}
    return money(rows[account_id]["current_balance"])


# --- S-1: saldo até hoje -----------------------------------------------------


def test_future_transaction_does_not_move_the_balance_until_its_date(client, default_category):
    account = create_account(client, initial_balance=1000.0)
    cat = default_category["id"]
    create_transaction(client, account, cat, "SAÍDA", 100.0, date=TODAY.isoformat())
    create_transaction(client, account, cat, "SAÍDA", 300.0, date=(TODAY + datetime.timedelta(days=1)).isoformat())

    assert balance(client, account) == Decimal("900.00")
    assert money(client.get("/api/dashboard/summary").json()["total_balance"]) == Decimal("900.00")


def test_installment_only_debits_the_parcels_already_due(client, default_category):
    """5× de 100 com a parcela 1 hoje: o saldo cai 100, não 500."""
    account = create_account(client, initial_balance=1000.0)
    create(client, account, default_category["id"])
    assert balance(client, account) == Decimal("900.00")


def test_balance_change_uses_the_balance_at_the_end_of_last_month(client, default_category):
    """Fim do mês anterior: 1000. Este mês: +100 hoje e −50 no futuro (ainda
    neste mês ou no próximo). Saldo até hoje 1100 → variação de +10%."""
    account = create_account(client, initial_balance=1000.0)
    cat = default_category["id"]
    create_transaction(client, account, cat, "ENTRADA", 100.0, date=TODAY.isoformat())
    create_transaction(client, account, cat, "SAÍDA", 50.0, date=iso(1))
    summary = client.get("/api/dashboard/summary").json()
    assert money(summary["total_balance"]) == Decimal("1100.00")
    assert round(summary["balance_change_pct"], 2) == 10.0


# --- S-2: saldo comprometido -------------------------------------------------


def test_committed_balance_subtracts_the_future_parcels(client, default_category):
    account = create_account(client, initial_balance=1000.0)
    create(client, account, default_category["id"])  # 1 hoje, 2..5 no futuro
    summary = client.get("/api/installments/summary").json()
    assert money(summary["committed_balance"]) == Decimal("500.00")  # 900 − 4 × 100


def test_committed_balance_includes_legacy_installments_without_parcels(client, session, default_account, default_category):
    """Parcelamento antigo (sem cronograma) não tem parcela no extrato: o
    restante dele entra no comprometido."""
    session.add(models.Installment(
        owner_id=owner_id_of(session), title="Antigo", category_id=default_category["id"],
        total_amount=Decimal("600.00"), installment_amount=Decimal("100.00"),
        current_installment=4, total_installments=6, end_date="Ago/2027",
        account_id=default_account,
    ))
    session.commit()
    summary = client.get("/api/installments/summary").json()
    # 10000 de saldo − 300 restantes (parcelas 4, 5 e 6)
    assert money(summary["committed_balance"]) == Decimal("9700.00")


# --- S-3: parcela atual pela data --------------------------------------------


def test_current_installment_follows_the_calendar(client, default_account, default_category):
    """3 de 5 com vencimento há dois meses: hoje é o mês da parcela 5."""
    inst = create(client, default_account, default_category["id"],
                  current_installment=3, current_due_date=iso(-2))
    assert inst["current_installment"] == 5
    listed = client.get("/api/installments").json()[0]
    assert listed["current_installment"] == 5
    assert money(listed["remaining_amount"]) == Decimal("100.00")


def test_the_whole_due_month_is_the_current_installment(client, default_account, default_category):
    """A parcela do mês continua "atual" mesmo depois do dia do débito."""
    inst = create(client, default_account, default_category["id"],
                  current_installment=2, current_due_date=iso(0, day=1))
    assert inst["current_installment"] == 2


def test_after_the_last_due_month_it_is_paid_off(client, default_account, default_category):
    create(client, default_account, default_category["id"],
           current_installment=5, current_due_date=iso(-1))
    listed = client.get("/api/installments").json()[0]
    assert listed["current_installment"] == 6
    assert money(listed["remaining_amount"]) == Decimal("0.00")
    summary = client.get("/api/installments/summary").json()
    assert summary["active_count"] == 0
    assert client.get("/api/dashboard/summary").json()["active_installments_count"] == 0


def test_monthly_committed_counts_only_installments_due_this_month_or_later(client, default_account, default_category):
    cat = default_category["id"]
    create(client, default_account, cat, title="Ativo")  # 1 de 5 hoje
    create(client, default_account, cat, title="Quitado", current_installment=5, current_due_date=iso(-1))
    summary = client.get("/api/installments/summary").json()
    assert summary["active_count"] == 1
    assert money(summary["monthly_committed_amount"]) == Decimal("100.00")


def test_patch_current_installment_is_rejected_when_it_comes_from_the_calendar(client, default_account, default_category):
    inst = create(client, default_account, default_category["id"])
    response = client.patch(f"/api/installments/{inst['id']}", json={"current_installment": 3})
    assert response.status_code == 400
    assert "calculada pela data" in response.json()["detail"]


def test_resending_the_same_current_installment_is_not_rejected(client, default_account, default_category):
    """Um formulário que manda o objeto inteiro não pode cair no 400."""
    inst = create(client, default_account, default_category["id"])
    response = client.patch(
        f"/api/installments/{inst['id']}",
        json={"title": "Geladeira nova", "current_installment": inst["current_installment"]},
    )
    assert response.status_code == 200, response.text


# --- S-4: parcelamento antigo ------------------------------------------------


def test_legacy_installment_keeps_the_stored_current_and_can_advance(client, session, default_account, default_category):
    legacy = models.Installment(
        owner_id=owner_id_of(session), title="Antigo", category_id=default_category["id"],
        total_amount=Decimal("600.00"), installment_amount=Decimal("100.00"),
        current_installment=2, total_installments=6, end_date="Ago/2027",
        account_id=default_account,
    )
    session.add(legacy)
    session.commit()
    response = client.patch(f"/api/installments/{legacy.id}", json={"current_installment": 3})
    assert response.status_code == 200, response.text
    assert response.json()["current_installment"] == 3
    assert response.json()["anchor_due_date"] is None


# --- Revisão de 12/11/2026 (escritos antes da correção) ----------------------


def test_anchor_in_a_future_month_never_goes_below_the_first_generated_parcel(client, default_account, default_category):
    """3 de 10 com a parcela 3 vencendo mês que vem: só existem as parcelas 3 a
    10 (800). Antes, a parcela atual derivada era a 2 e o restante dava 900."""
    inst = create(client, default_account, default_category["id"],
                  current_installment=3, total_installments=10,
                  current_due_date=iso(1))
    assert inst["current_installment"] == 3
    assert money(inst["remaining_amount"]) == Decimal("800.00")
    summary = client.get("/api/installments/summary").json()
    assert money(summary["remaining_total_amount"]) == Decimal("800.00")
    assert summary["active_count"] == 1


def test_migration_backfills_the_anchor_of_installments_created_before_it():
    """Parcelamentos criados entre a P-1 e a S-3 têm `first_due_date` e parcelas
    geradas, mas âncora nula: ficariam no modo antigo para sempre."""
    from app.installment_schedule import anchor_from_first_due_date

    assert anchor_from_first_due_date(datetime.date(2026, 1, 15), 3) == datetime.date(2026, 3, 15)
    assert anchor_from_first_due_date(datetime.date(2026, 2, 28), 2) == datetime.date(2026, 3, 28)
