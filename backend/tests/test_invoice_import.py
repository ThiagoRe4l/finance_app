"""Rotas de importação de fatura — `docs/importacao-fatura.md`.

Escrito **antes** da implementação (11/11/2026); aprovação delegada pelo
usuário nesta data. As rotas não existem hoje: os 404 assertam o `detail`, senão
o 404 "Not Found" do FastAPI passaria pelo motivo errado.

PDFs sintéticos (`tests/pdf_fixture.py`): nenhuma fatura real no repositório.
"""

import datetime
from decimal import Decimal

from tests.conftest import create_account, create_category, money
from tests.pdf_fixture import make_pdf

PREVIEW = "/api/imports/invoice/preview"
CONFIRM = "/api/imports/invoice/confirm"
DUE = "2026-11-20"

INVOICE = [
    "Fatura Cartao - vencimento 20/11/2026",
    "10/11 PADARIA SÃO JOÃO 12,50",
    "05 OUT Uber *Trip R$ 23,90",
    "03/11 ESTORNO LOJA -15,00",
    "05/11 PAGAMENTO RECEBIDO -1.234,56",
    "15/03 MAGAZINE LUIZA PARC 03/10 150,00",
    "Total R$ 171,40",
]


def preview(client, account_id, lines=INVOICE, due=DUE, content_type="application/pdf", body=None):
    return client.post(
        PREVIEW,
        params={"due_date": due, "account_id": account_id},
        content=make_pdf(lines) if body is None else body,
        headers={"Content-Type": content_type},
    )


# --- preview ---------------------------------------------------------------


def test_preview_extracts_entries_without_persisting(client, default_account):
    response = preview(client, default_account)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["lines_read"] == len(INVOICE)
    items = body["items"]
    assert [i["title"] for i in items] == [
        "PADARIA SÃO JOÃO",
        "Uber *Trip",
        "ESTORNO LOJA",
        "PAGAMENTO RECEBIDO",
        "MAGAZINE LUIZA PARC 03/10",
    ]
    padaria = items[0]
    assert padaria["date"] == "2026-11-10"
    assert money(padaria["amount"]) == Decimal("12.50")
    assert padaria["type"] == "SAÍDA"
    assert padaria["selected"] is True
    assert padaria["duplicate"] is False

    assert items[2]["type"] == "ENTRADA"
    assert items[3]["is_payment"] is True
    assert items[3]["selected"] is False
    assert items[4]["installment_hint"] == {"current": 3, "total": 10}
    assert items[4]["date"] == DUE

    assert client.get("/api/transactions").json() == []


def test_preview_flags_duplicates_already_in_the_account(client, default_account, default_category):
    client.post("/api/transactions", json={
        "title": "padaria  sao joao", "type": "SAÍDA", "amount": "12.50",
        "date": "2026-11-10", "category_id": default_category["id"],
        "account_id": default_account,
    })
    items = preview(client, default_account).json()["items"]
    assert items[0]["duplicate"] is True
    assert items[0]["selected"] is False
    assert items[1]["duplicate"] is False


def test_duplicate_in_another_account_is_not_a_duplicate(client, default_account, default_category):
    other = create_account(client, name="Outra")
    client.post("/api/transactions", json={
        "title": "PADARIA SÃO JOÃO", "type": "SAÍDA", "amount": "12.50",
        "date": "2026-11-10", "category_id": default_category["id"], "account_id": other,
    })
    assert preview(client, default_account).json()["items"][0]["duplicate"] is False


def test_preview_suggests_the_category_of_the_latest_matching_transaction(client, default_account):
    old = create_category(client, name="Antiga")
    new = create_category(client, name="Padaria")
    for category, date in ((old, "2026-01-05"), (new, "2026-06-05")):
        client.post("/api/transactions", json={
            "title": "Padaria São João", "type": "SAÍDA", "amount": "9.00",
            "date": date, "category_id": category["id"], "account_id": default_account,
        })
    items = preview(client, default_account).json()["items"]
    assert items[0]["suggested_category_id"] == new["id"]
    assert items[1]["suggested_category_id"] is None


def test_preview_with_no_recognized_entry_is_not_an_error(client, default_account):
    response = preview(client, default_account, lines=["Extrato sem lançamentos", "Obrigado"])
    assert response.status_code == 200
    assert response.json() == {"lines_read": 2, "items": []}


def test_preview_requires_pdf_content_type(client, default_account):
    response = preview(client, default_account, content_type="text/plain")
    assert response.status_code == 415


def test_preview_rejects_files_over_4_mb(client, default_account):
    response = preview(client, default_account, body=b"%PDF-" + b"0" * (4 * 1024 * 1024))
    assert response.status_code == 413


def test_preview_rejects_unreadable_pdf(client, default_account):
    response = preview(client, default_account, body=b"isto nao e um pdf")
    assert response.status_code == 422
    assert "PDF" in response.json()["detail"]


def test_preview_rejects_pdf_without_text(client, default_account):
    response = preview(client, default_account, lines=[])
    assert response.status_code == 422
    assert "texto" in response.json()["detail"]


def test_preview_requires_due_date(client, default_account):
    response = client.post(
        PREVIEW, params={"account_id": default_account},
        content=make_pdf(INVOICE), headers={"Content-Type": "application/pdf"},
    )
    assert response.status_code == 422


def test_preview_unknown_account_is_404(client):
    response = preview(client, 9999)
    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."


# --- confirm ---------------------------------------------------------------


def confirm_body(account_id, category_id, **item_overrides):
    item = {
        "date": "2026-11-10", "title": "PADARIA SÃO JOÃO", "amount": "12.50",
        "type": "SAÍDA", "category_id": category_id,
    }
    item.update(item_overrides)
    return {"account_id": account_id, "items": [item]}


def test_confirm_creates_the_transactions(client, default_account, default_category):
    body = confirm_body(default_account, default_category["id"])
    body["items"].append({
        "date": "2026-11-03", "title": "ESTORNO LOJA", "amount": "15.00",
        "type": "ENTRADA", "category_id": default_category["id"],
    })
    response = client.post(CONFIRM, json=body)
    assert response.status_code == 201, response.text
    assert response.json() == {"created": 2, "skipped_duplicates": 0}

    rows = sorted(client.get("/api/transactions").json(), key=lambda t: t["date"])
    assert [(t["title"], t["type"], t["amount"]) for t in rows] == [
        ("ESTORNO LOJA", "ENTRADA", "15.00"),
        ("PADARIA SÃO JOÃO", "SAÍDA", "12.50"),
    ]


def test_confirm_skips_duplicates_again_on_the_server(client, default_account, default_category):
    body = confirm_body(default_account, default_category["id"])
    assert client.post(CONFIRM, json=body).json() == {"created": 1, "skipped_duplicates": 0}
    assert client.post(CONFIRM, json=body).json() == {"created": 0, "skipped_duplicates": 1}
    assert len(client.get("/api/transactions").json()) == 1


def test_confirm_is_all_or_nothing(client, default_account, default_category):
    body = confirm_body(default_account, default_category["id"])
    body["items"].append({
        "date": "2026-11-11", "title": "OUTRA", "amount": "1.00",
        "type": "SAÍDA", "category_id": 9999,
    })
    response = client.post(CONFIRM, json=body)
    assert response.status_code == 404
    assert response.json()["detail"] == "Categoria não encontrada."
    assert client.get("/api/transactions").json() == []


def test_confirm_unknown_account_is_404(client, default_category):
    response = client.post(CONFIRM, json=confirm_body(9999, default_category["id"]))
    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."


def test_confirm_validates_items(client, default_account, default_category):
    cat = default_category["id"]
    for bad in (
        {"account_id": default_account, "items": []},
        confirm_body(default_account, cat, amount="0"),
        confirm_body(default_account, cat, amount="1.001"),
        confirm_body(default_account, cat, type="OUTRO"),
        confirm_body(default_account, cat, title=""),
        confirm_body(default_account, cat, extra="x"),
    ):
        assert client.post(CONFIRM, json=bad).status_code == 422, bad
    assert client.get("/api/transactions").json() == []


def test_confirmed_entries_count_in_the_dashboard(client, default_account, default_category):
    today = datetime.date.today().isoformat()
    client.post(CONFIRM, json=confirm_body(default_account, default_category["id"], date=today))
    summary = client.get("/api/dashboard/summary").json()
    assert money(summary["total_expenses"]) == Decimal("12.50")


# --- dono (D-Import-6) -----------------------------------------------------


def test_another_users_account_is_404_in_both_routes(client_as):
    ana = client_as("ana@example.com")
    bia = client_as("bia@example.com")
    account = ana.post("/api/accounts", json={"name": "Ana", "initial_balance": "0"}).json()["id"]
    category = bia.get("/api/categories").json()[0]["id"]

    response = preview(bia, account)
    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."

    response = bia.post(CONFIRM, json=confirm_body(account, category))
    assert response.status_code == 404
    assert response.json()["detail"] == "Conta não encontrada."


def test_another_users_category_inside_items_is_404(client_as):
    """O `category_id` aninhado em `items` não é visto pela descoberta da
    varredura (`_body_id_fields` só olha o nível de cima): o caso fica aqui."""
    ana = client_as("ana@example.com")
    bia = client_as("bia@example.com")
    ana_category = ana.get("/api/categories").json()[0]["id"]
    bia_account = bia.post("/api/accounts", json={"name": "Bia", "initial_balance": "0"}).json()["id"]

    response = bia.post(CONFIRM, json=confirm_body(bia_account, ana_category))
    assert response.status_code == 404
    assert response.json()["detail"] == "Categoria não encontrada."
    assert bia.get("/api/transactions").json() == []
