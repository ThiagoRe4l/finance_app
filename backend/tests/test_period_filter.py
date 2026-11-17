"""Filtro de período — Dashboard e Relatórios (`docs/periodos.md`, PER-1 a PER-7).

Escrito **antes** da implementação (13/11/2026). Hoje os testes novos ficam vermelhos
porque `?period=` é ignorado e `/periods/range` não existe. Os rotulados com ✅
descrevem o que não pode mudar e já passam.

Relógio travado em 13/11/2026 (como `test_dashboard_subscriptions.py`), para os meses
serem literais sem virar bomba-relógio.
"""

import datetime
from decimal import Decimal

import pytest

from tests.conftest import create_category, create_transaction, installment_payload, money

UTC = datetime.timezone.utc


@pytest.fixture(autouse=True)
def _today(time_machine):
    time_machine.move_to(datetime.datetime(2026, 11, 13, 12, tzinfo=UTC), tick=False)


def _dash(client, period=None):
    params = {} if period is None else {"period": period}
    response = client.get("/api/dashboard/summary", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _report(client, period=None):
    params = {} if period is None else {"period": period}
    response = client.get("/api/reports/overview", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _tx(client, account_id, category_id, tx_type, amount, date, title="Lançamento"):
    response = create_transaction(client, account_id, category_id, tx_type, amount, date, title)
    assert response.status_code == 201, response.text


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


# ---------------------------------------------------------------------------
# GET /periods/range (PER-6)
# ---------------------------------------------------------------------------

def test_range_without_data_is_the_current_month_to_twelve_months_ahead(client):
    response = client.get("/api/periods/range")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "min_month": "2026-11",
        "max_month": "2027-11",
        "current_month": "2026-11",
    }


def test_range_min_is_the_month_of_the_oldest_transaction(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "SAÍDA", 10.0, "2026-03-10")
    _tx(client, default_account, default_category["id"], "SAÍDA", 10.0, "2026-09-10")

    assert client.get("/api/periods/range").json()["min_month"] == "2026-03"


def test_range_max_reaches_the_last_installment_when_it_is_beyond_twelve_months(
    client, default_account, default_category
):
    # parcela 2 de 36 vencendo hoje (13/11/2026): a 36ª cai 34 meses depois, 09/2029.
    response = client.post(
        "/api/installments",
        json=installment_payload(default_account, default_category["id"], total_installments=36),
    )
    assert response.status_code == 201, response.text

    assert client.get("/api/periods/range").json()["max_month"] == "2029-09"


def test_range_max_stays_at_twelve_months_when_the_installment_ends_sooner(
    client, default_account, default_category
):
    # 2 de 12: a última parcela é 09/2027, dentro dos 12 meses à frente (11/2027).
    client.post("/api/installments", json=installment_payload(default_account, default_category["id"]))

    assert client.get("/api/periods/range").json()["max_month"] == "2027-11"


def test_range_requires_login(anon_client):
    assert anon_client.get("/api/periods/range").status_code == 401


# ---------------------------------------------------------------------------
# Dashboard — contrato do parâmetro
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad", ["2026-13", "banana", "26-11", "2026-1", "", "2026-11-01", "5m", "13m", "0m", "6M"])
def test_an_invalid_period_is_422(client, bad):
    assert client.get("/api/dashboard/summary", params={"period": bad}).status_code == 422
    assert client.get("/api/reports/overview", params={"period": bad}).status_code == 422


def test_the_default_period_is_the_current_month(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "ENTRADA", 700.0, "2026-11-05")

    default = _dash(client)
    explicit = _dash(client, "2026-11")

    assert default["period"] == {"key": "2026-11", "start": "2026-11-01", "end": "2026-12-01"}
    assert default["period"] == explicit["period"]
    assert money(default["total_revenues"]) == money(explicit["total_revenues"]) == Decimal("700.00")
    assert default["is_projection"] is False


def test_a_past_month_shows_only_that_month(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "ENTRADA", 1000.0, "2026-09-10")
    _tx(client, default_account, cat, "SAÍDA", 250.0, "2026-09-20")
    _tx(client, default_account, cat, "SAÍDA", 300.0, "2026-10-05")

    september = _dash(client, "2026-09")

    assert money(september["total_revenues"]) == Decimal("1000.00")
    assert money(september["total_expenses"]) == Decimal("250.00")
    assert money(september["total_savings"]) == Decimal("750.00")
    assert september["is_projection"] is False
    # o padrão não enxerga setembro
    assert money(_dash(client)["total_revenues"]) == Decimal("0.00")


def test_balance_of_a_past_period_is_the_balance_at_its_end(client, default_account, default_category):
    cat = default_category["id"]  # conta com R$ 10.000 iniciais
    _tx(client, default_account, cat, "ENTRADA", 1000.0, "2026-09-10")
    _tx(client, default_account, cat, "SAÍDA", 300.0, "2026-10-05")

    assert money(_dash(client, "2026-09")["total_balance"]) == Decimal("11000.00")
    assert money(_dash(client)["total_balance"]) == Decimal("10700.00")


def test_recent_transactions_and_category_spending_follow_the_period(
    client, default_account, default_category
):
    cat = default_category["id"]
    _tx(client, default_account, cat, "SAÍDA", 80.0, "2026-09-10", title="De setembro")
    _tx(client, default_account, cat, "SAÍDA", 20.0, "2026-11-10", title="De novembro")

    september = _dash(client, "2026-09")

    assert [t["title"] for t in september["recent_transactions"]] == ["De setembro"]
    spent = {c["id"]: money(c["spent"]) for c in september["category_distribution"]}
    assert spent[cat] == Decimal("80.00")
    assert [t["title"] for t in _dash(client)["recent_transactions"]] == ["De novembro"]


# ---------------------------------------------------------------------------
# Dashboard — projeção (PER-4, PER-5)
# ---------------------------------------------------------------------------

def test_a_subscription_is_projected_into_a_future_month(client, default_account, default_category):
    _subscription(client, default_account, default_category["id"])

    december = _dash(client, "2026-12")

    assert money(december["total_expenses"]) == Decimal("49.90")
    assert money(december["projected_expenses"]) == Decimal("49.90")
    assert december["is_projection"] is True
    # não acaba: continua a aparecer meses depois
    assert money(_dash(client, "2027-08")["total_expenses"]) == Decimal("49.90")


def test_an_ended_subscription_is_not_projected_after_it_ends(client, default_account, default_category):
    created = _subscription(client, default_account, default_category["id"])
    # `ended_on` só entra por PATCH (R-4): o POST o recusa com 422.
    patched = client.patch(f"/api/subscriptions/{created['id']}", json={"ended_on": "2027-01-31"})
    assert patched.status_code == 200, patched.text

    assert money(_dash(client, "2027-01")["total_expenses"]) == Decimal("49.90")
    assert money(_dash(client, "2027-02")["total_expenses"]) == Decimal("0.00")


def test_the_pending_charge_of_the_current_month_counts_as_projected(
    client, default_account, default_category
):
    # cobra dia 15; hoje é dia 13, então ainda não virou linha (R-3).
    _subscription(client, default_account, default_category["id"])

    current = _dash(client)

    assert money(current["projected_expenses"]) == Decimal("49.90")
    assert money(current["total_expenses"]) == Decimal("49.90")
    assert current["is_projection"] is False  # o período contém hoje


def test_an_installment_parcel_shows_in_its_own_month(client, default_account, default_category):
    # 2 de 12 vencendo hoje: a parcela 3 é 13/12/2026, a 12 é 13/09/2027.
    client.post("/api/installments", json=installment_payload(default_account, default_category["id"]))

    assert money(_dash(client, "2026-12")["total_expenses"]) == Decimal("500.00")
    assert money(_dash(client, "2027-09")["total_expenses"]) == Decimal("500.00")
    assert money(_dash(client, "2027-10")["total_expenses"]) == Decimal("0.00")
    # a parcela já é linha, então não é "projetada" no sentido calculado
    assert money(_dash(client, "2026-12")["projected_expenses"]) == Decimal("0.00")


def test_future_balance_subtracts_the_projected_subscription_charges(
    client, default_account, default_category
):
    _subscription(client, default_account, default_category["id"])  # 15/11 e 15/12

    # 10.000 − 49,90 (15/11) − 49,90 (15/12)
    assert money(_dash(client, "2026-12")["total_balance"]) == Decimal("9900.20")


# ---------------------------------------------------------------------------
# Dashboard — ano, 6m, all e o gráfico (PER-2, PER-3, PER-7)
# ---------------------------------------------------------------------------

def test_monthly_flow_ends_at_the_selected_month_and_carries_month_keys(
    client, default_account, default_category
):
    _subscription(client, default_account, default_category["id"])

    flow = _dash(client, "2026-12")["monthly_flow"]

    assert [m["month_key"] for m in flow] == [
        "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]
    assert money(flow[-1]["outcome"]) == Decimal("49.90")  # dezembro entra projetado
    assert [m["month"] for m in flow][-1] == "Dez"  # ✅ o rótulo curto não muda


def test_the_default_flow_still_ends_in_the_current_month(client):
    flow = _dash(client)["monthly_flow"]

    assert len(flow) == 6
    assert flow[-1]["month_key"] == "2026-11"


def test_a_year_sums_the_whole_year_and_charts_twelve_months(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "ENTRADA", 100.0, "2026-02-10")
    _tx(client, default_account, cat, "ENTRADA", 200.0, "2026-09-10")
    _tx(client, default_account, cat, "ENTRADA", 999.0, "2025-12-31")

    year = _dash(client, "2026")

    assert money(year["total_revenues"]) == Decimal("300.00")
    assert year["period"] == {"key": "2026", "start": "2026-01-01", "end": "2027-01-01"}
    assert [m["month_key"] for m in year["monthly_flow"]] == [f"2026-{m:02d}" for m in range(1, 13)]


def test_all_runs_from_the_first_transaction_to_the_end_of_the_current_month(
    client, default_account, default_category
):
    cat = default_category["id"]
    _tx(client, default_account, cat, "ENTRADA", 500.0, "2026-03-10")
    _tx(client, default_account, cat, "ENTRADA", 200.0, "2026-11-10")

    everything = _dash(client, "all")

    assert money(everything["total_revenues"]) == Decimal("700.00")
    keys = [m["month_key"] for m in everything["monthly_flow"]]
    assert keys[0] == "2026-03" and keys[-1] == "2026-11" and len(keys) == 9


def test_6m_is_the_trailing_window(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "SAÍDA", 40.0, "2026-06-10")  # dentro: 06/2026 é o 1º mês da janela
    _tx(client, default_account, cat, "SAÍDA", 60.0, "2026-05-10")  # fora da janela

    window = _dash(client, "6m")

    assert money(window["total_expenses"]) == Decimal("40.00")  # 06/2026 a 11/2026


# ---------------------------------------------------------------------------
# Relatórios
# ---------------------------------------------------------------------------

def test_reports_default_is_now_the_current_month(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "SAÍDA", 30.0, "2026-11-02")
    _tx(client, default_account, cat, "SAÍDA", 70.0, "2026-08-02")

    report = _report(client)

    assert money(report["total_expenses"]) == Decimal("30.00")
    assert money(report["top_categories"][0]["value"]) == Decimal("30.00")
    assert report["period"]["key"] == "2026-11"


def test_reports_6m_keeps_the_old_six_month_window(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "SAÍDA", 30.0, "2026-11-02")
    _tx(client, default_account, cat, "SAÍDA", 70.0, "2026-08-02")
    _tx(client, default_account, cat, "SAÍDA", 900.0, "2026-04-02")  # fora

    report = _report(client, "6m")

    assert money(report["total_expenses"]) == Decimal("100.00")
    assert money(report["top_categories"][0]["value"]) == Decimal("100.00")
    assert len(report["monthly_comparative"]) == 6


def test_reports_for_a_past_month_use_that_month_everywhere(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "ENTRADA", 1000.0, "2026-09-10")
    _tx(client, default_account, cat, "SAÍDA", 400.0, "2026-09-20")
    _tx(client, default_account, cat, "SAÍDA", 55.0, "2026-10-20")

    report = _report(client, "2026-09")

    assert money(report["total_revenues"]) == Decimal("1000.00")
    assert money(report["total_expenses"]) == Decimal("400.00")
    assert money(report["top_categories"][0]["value"]) == Decimal("400.00")
    assert report["average_savings"] == pytest.approx(600.0)  # 1 mês
    assert report["monthly_comparative"][-1]["month_key"] == "2026-09"


def test_reports_average_savings_divides_by_the_months_of_the_period(
    client, default_account, default_category
):
    cat = default_category["id"]
    _tx(client, default_account, cat, "ENTRADA", 1200.0, "2026-03-10")

    assert _report(client, "2026")["average_savings"] == pytest.approx(100.0)  # 1.200 / 12


def test_reports_project_a_subscription_into_a_future_month(client, default_account, default_category):
    _subscription(client, default_account, default_category["id"])

    report = _report(client, "2026-12")

    assert money(report["total_expenses"]) == Decimal("49.90")
    assert money(report["projected_expenses"]) == Decimal("49.90")
    assert report["is_projection"] is True
    assert money(report["top_categories"][0]["value"]) == Decimal("49.90")


# ---------------------------------------------------------------------------
# 3m e 12m (atalhos 3M / 6M / 1A do seletor) — `docs/periodos.md`, PER-2
# ---------------------------------------------------------------------------

def test_3m_is_the_trailing_three_months(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "SAÍDA", 10.0, "2026-09-10")  # dentro: 09 é o 1º mês
    _tx(client, default_account, cat, "SAÍDA", 90.0, "2026-08-10")  # fora

    window = _dash(client, "3m")

    assert money(window["total_expenses"]) == Decimal("10.00")
    assert [m["month_key"] for m in window["monthly_flow"]] == ["2026-09", "2026-10", "2026-11"]
    assert window["period"]["key"] == "3m"
    assert window["period"]["start"] == "2026-09-01"
    assert window["period"]["end"] == "2026-12-01"


def test_12m_is_the_trailing_twelve_months(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "SAÍDA", 5.0, "2025-12-10")  # dentro: 12/2025 é o 1º mês
    _tx(client, default_account, cat, "SAÍDA", 70.0, "2025-11-10")  # fora

    window = _dash(client, "12m")

    assert money(window["total_expenses"]) == Decimal("5.00")
    assert len(window["monthly_flow"]) == 12
    assert window["monthly_flow"][0]["month_key"] == "2025-12"
    assert _report(client, "12m")["average_savings"] == pytest.approx(-5.0 / 12)


# ---------------------------------------------------------------------------
# Intervalo entre meses (`AAAA-MM..AAAA-MM`, docs/periodos.md, PER-9)
# ---------------------------------------------------------------------------

def test_a_month_range_sums_both_ends_inclusive(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "ENTRADA", 100.0, "2026-02-28")  # fora (antes)
    _tx(client, default_account, cat, "ENTRADA", 200.0, "2026-03-01")  # 1º dia do 1º mês
    _tx(client, default_account, cat, "ENTRADA", 300.0, "2026-05-31")  # último dia do último mês
    _tx(client, default_account, cat, "ENTRADA", 999.0, "2026-06-01")  # fora (depois)

    data = _dash(client, "2026-03..2026-05")

    assert money(data["total_revenues"]) == Decimal("500.00")
    assert data["period"] == {"key": "2026-03..2026-05", "start": "2026-03-01", "end": "2026-06-01"}
    assert [m["month_key"] for m in data["monthly_flow"]] == ["2026-03", "2026-04", "2026-05"]


def test_a_range_of_a_single_month_is_valid(client):
    data = _dash(client, "2026-03..2026-03")
    assert data["period"]["start"] == "2026-03-01"
    assert data["period"]["end"] == "2026-04-01"


def test_a_range_across_years_charts_every_month(client):
    data = _dash(client, "2025-11..2026-02")
    assert [m["month_key"] for m in data["monthly_flow"]] == ["2025-11", "2025-12", "2026-01", "2026-02"]


def test_a_range_has_no_month_over_month_variation(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "SAÍDA", 50.0, "2026-04-10")
    data = _dash(client, "2026-03..2026-05")
    assert data["expenses_change_pct"] is None
    assert data["balance_change_pct"] is None


def test_reports_accept_a_range_and_average_by_its_months(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "ENTRADA", 600.0, "2026-03-10")
    response = client.get("/api/reports/overview", params={"period": "2026-03..2026-05"})
    assert response.status_code == 200


def test_transactions_list_accepts_a_range(client, default_account, default_category):
    cat = default_category["id"]
    _tx(client, default_account, cat, "SAÍDA", 10.0, "2026-03-05")
    _tx(client, default_account, cat, "SAÍDA", 20.0, "2026-07-05")
    rows = client.get("/api/transactions", params={"period": "2026-03..2026-04"}).json()
    assert [money(r["amount"]) for r in rows] == [Decimal("10.00")]


@pytest.mark.parametrize(
    "bad",
    ["2026-05..2026-03", "2026-03..", "..2026-03", "2026-03..2026-13", "2026..2027", "2026-03...2026-05",
     "1800-01..1800-02", "2000-01..2026-11"],
)
def test_an_invalid_range_is_422(client, bad):
    assert client.get("/api/dashboard/summary", params={"period": bad}).status_code == 422
