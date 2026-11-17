"""`GET /transactions?period=` — filtro de período na listagem (`docs/periodos.md`, PER-8).

Escrito **antes** da implementação. A tela de Transações listava o histórico
inteiro, sem recorte. O parâmetro usa a mesma gramática do Dashboard (PER-2):
`YYYY-MM`, `YYYY`, `3m`, `6m`, `12m` e `all`. Sem `period` a rota continua
devolvendo tudo — aditivo, para não quebrar quem já a chama.

A ordem é sempre da mais nova para a mais antiga (`date` desc, depois `id` desc),
com ou sem filtro.
"""

import datetime

import pytest

from tests.conftest import create_account, create_category, create_transaction


def _seed(client, dates, tx_type="SAÍDA"):
    account_id = create_account(client)
    category_id = create_category(client)["id"]
    ids = {}
    for date in dates:
        response = create_transaction(
            client, account_id, category_id, tx_type=tx_type, date=date, title=f"t {date}"
        )
        assert response.status_code == 201, response.text
        ids[date] = response.json()["id"]
    return ids


def _dates(response):
    assert response.status_code == 200, response.text
    return [row["date"] for row in response.json()]


def test_without_period_everything_comes_back_newest_first(client):
    """✅ Regressão: já passa hoje — rotulado para não contar como cobertura nova."""
    _seed(client, ["2026-08-10", "2026-10-05", "2026-09-20"])
    assert _dates(client.get("/api/transactions")) == [
        "2026-10-05",
        "2026-09-20",
        "2026-08-10",
    ]


def test_a_month_returns_only_that_month(client):
    _seed(client, ["2026-09-15", "2026-10-03", "2026-10-28", "2026-11-02"])
    assert _dates(client.get("/api/transactions", params={"period": "2026-10"})) == [
        "2026-10-28",
        "2026-10-03",
    ]


def test_month_edges_start_inclusive_end_exclusive(client):
    _seed(client, ["2026-09-30", "2026-10-01", "2026-10-31", "2026-11-01"])
    assert _dates(client.get("/api/transactions", params={"period": "2026-10"})) == [
        "2026-10-31",
        "2026-10-01",
    ]


def test_a_year_returns_only_that_year(client):
    _seed(client, ["2025-12-31", "2026-01-01", "2026-12-31", "2027-01-01"])
    assert _dates(client.get("/api/transactions", params={"period": "2026"})) == [
        "2026-12-31",
        "2026-01-01",
    ]


def test_all_returns_the_whole_history(client):
    _seed(client, ["2024-01-10", "2026-10-05", "2025-06-30"])
    assert _dates(client.get("/api/transactions", params={"period": "all"})) == [
        "2026-10-05",
        "2025-06-30",
        "2024-01-10",
    ]


def test_trailing_window_ends_at_the_current_month(client):
    today = datetime.date.today()
    long_ago = today - datetime.timedelta(days=200)
    _seed(client, [today.isoformat(), long_ago.isoformat()])
    assert _dates(client.get("/api/transactions", params={"period": "3m"})) == [
        today.isoformat()
    ]


def test_a_period_with_nothing_is_an_empty_list(client):
    _seed(client, ["2026-10-05"])
    response = client.get("/api/transactions", params={"period": "2020-01"})
    assert response.status_code == 200
    assert response.json() == []


def test_same_day_newest_id_comes_first(client):
    ids = _seed(client, ["2026-10-05"])
    account_id = create_account(client, name="Outra")
    category_id = create_category(client, name="Outra")["id"]
    response = create_transaction(
        client, account_id, category_id, date="2026-10-05", title="segunda"
    )
    assert response.status_code == 201, response.text
    second = response.json()["id"]
    rows = client.get("/api/transactions", params={"period": "2026-10"}).json()
    assert [r["id"] for r in rows] == [second, ids["2026-10-05"]]


def test_filtered_rows_keep_their_nested_fields(client):
    _seed(client, ["2026-10-05"])
    row = client.get("/api/transactions", params={"period": "2026-10"}).json()[0]
    assert row["category"]["name"] == "Alimentação"
    assert isinstance(row["amount"], str)


@pytest.mark.parametrize("bad", ["2026-13", "abc", "5m", "2026-1", "99999", ""])
def test_an_invalid_period_is_422(client, bad):
    response = client.get("/api/transactions", params={"period": bad})
    assert response.status_code == 422
    assert "Período inválido" in str(response.json()["detail"])
