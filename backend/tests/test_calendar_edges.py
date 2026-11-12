"""Viradas de calendário — backlog 0.1, item L (12/11/2026).

Escrito antes de rodar a suíte em datas viajadas. Cada teste põe o relógio do
Python numa virada (fixture `time_machine` do pacote `time-machine`) e confere
as regras que dependem de "hoje": o mês corrente e a janela de 6 meses, o saldo
até hoje (S-1) e a parcela atual pelo calendário (S-3).
"""

import datetime
from decimal import Decimal

from tests.conftest import create_account, create_transaction, money

UTC = datetime.timezone.utc


def at(time_machine, y, m, d, hh=12, mm=0):
    time_machine.move_to(datetime.datetime(y, m, d, hh, mm, tzinfo=UTC), tick=False)


def test_dashboard_window_crosses_the_year(time_machine, client, default_account, default_category):
    at(time_machine, 2027, 1, 5)
    cat = default_category["id"]
    create_transaction(client, default_account, cat, "SAÍDA", 100.0, date="2026-12-31")
    create_transaction(client, default_account, cat, "SAÍDA", 40.0, date="2027-01-02")

    summary = client.get("/api/dashboard/summary").json()
    assert [m["month"] for m in summary["monthly_flow"]] == ["Ago", "Set", "Out", "Nov", "Dez", "Jan"]
    assert money(summary["total_expenses"]) == Decimal("40.00")
    by_month = {m["month"]: money(m["outcome"]) for m in summary["monthly_flow"]}
    assert by_month["Dez"] == Decimal("100.00")
    assert by_month["Jan"] == Decimal("40.00")


def test_report_window_starts_in_august_of_the_previous_year(time_machine, client, default_account, default_category):
    at(time_machine, 2027, 1, 5)
    cat = default_category["id"]
    create_transaction(client, default_account, cat, "SAÍDA", 7.0, date="2026-07-31")
    create_transaction(client, default_account, cat, "SAÍDA", 11.0, date="2026-08-01")

    overview = client.get("/api/reports/overview").json()
    assert money(overview["total_expenses"]) == Decimal("11.00")


def test_balance_counts_new_years_day_only_on_new_years_day(time_machine, client, default_category):
    account = create_account(client, initial_balance=1000.0)
    create_transaction(client, account, default_category["id"], "SAÍDA", 100.0, date="2027-01-01")

    at(time_machine, 2026, 12, 31, 23, 59)
    assert money(client.get("/api/accounts").json()[0]["current_balance"]) == Decimal("1000.00")

    at(time_machine, 2027, 1, 1, 0, 1)
    assert money(client.get("/api/accounts").json()[0]["current_balance"]) == Decimal("900.00")


def test_current_installment_turns_with_the_year(time_machine, client, default_account, default_category):
    at(time_machine, 2026, 12, 10)
    created = client.post("/api/installments", json={
        "title": "Sofá", "category_id": default_category["id"], "account_id": default_account,
        "installment_amount": "100.00", "total_installments": 5,
        "current_installment": 3, "current_due_date": "2026-12-10",
    })
    assert created.status_code == 201, created.text
    assert created.json()["current_installment"] == 3

    at(time_machine, 2027, 1, 1)
    assert client.get("/api/installments").json()[0]["current_installment"] == 4

    at(time_machine, 2027, 3, 1)
    assert client.get("/api/installments").json()[0]["current_installment"] == 6
    assert client.get("/api/installments/summary").json()["active_count"] == 0
