"""Parcela da fatura casando com o parcelamento — D-Import-8 (resposta 5c).

Escrito **antes** da implementação (12/11/2026). Datas relativas a hoje
(backlog 0.1); os PDFs são sintéticos (`tests/pdf_fixture.py`).
"""

import datetime

from app.installment_schedule import add_months
from tests.pdf_fixture import make_pdf

PREVIEW = "/api/imports/invoice/preview"
CONFIRM = "/api/imports/invoice/confirm"
TODAY = datetime.date.today()


def preview(client, account_id, lines, due=TODAY):
    response = client.post(
        PREVIEW, params={"due_date": due.isoformat(), "account_id": account_id},
        content=make_pdf(lines), headers={"Content-Type": "application/pdf"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def existing_installment(client, account_id, category_id, title="Magazine Luiza"):
    """10× de 150 com a parcela 3 vencendo hoje."""
    response = client.post("/api/installments", json={
        "title": title, "category_id": category_id, "account_id": account_id,
        "installment_amount": "150.00", "total_installments": 10,
        "current_installment": 3, "current_due_date": TODAY.isoformat(),
    })
    assert response.status_code == 201, response.text
    return response.json()


def line(k, title="MAGAZINE LUIZA"):
    return f"{TODAY:%d/%m} {title} PARC {k:02d}/10 150,00"


def test_preview_reports_the_bank(client, default_account):
    body = preview(client, default_account, ["Itaú Unibanco", line(3)])
    assert body["bank"] == "itau"


def test_line_of_an_already_generated_parcel_is_a_duplicate(client, default_account, default_category):
    inst = existing_installment(client, default_account, default_category["id"])
    item = preview(client, default_account, [line(3)])["items"][0]
    assert item["installment_match"]["installment_id"] == inst["id"]
    assert item["installment_match"]["transaction_id"] is not None
    assert item["duplicate"] is True
    assert item["selected"] is False


def test_title_match_ignores_case_accents_and_extra_words(client, default_account, default_category):
    inst = existing_installment(client, default_account, default_category["id"], title="Magazine Luíza")
    item = preview(client, default_account, [line(3, "MAGAZINE LUIZA SOFA")])["items"][0]
    assert item["installment_match"]["installment_id"] == inst["id"]


def test_no_match_with_a_different_installment_count(client, default_account, default_category):
    existing_installment(client, default_account, default_category["id"])
    text = f"{TODAY:%d/%m} MAGAZINE LUIZA PARC 03/12 150,00"
    assert preview(client, default_account, [text])["items"][0]["installment_match"] is None


def test_deleted_parcel_is_matched_and_confirm_links_it(client, default_account, default_category):
    inst = existing_installment(client, default_account, default_category["id"])
    parcel = next(t for t in client.get("/api/transactions").json() if t["installment_number"] == 3)
    assert client.delete(f"/api/transactions/{parcel['id']}").status_code == 204

    item = preview(client, default_account, [line(3)])["items"][0]
    assert item["installment_match"]["installment_id"] == inst["id"]
    assert item["installment_match"]["transaction_id"] is None
    assert item["selected"] is True

    response = client.post(CONFIRM, json={"account_id": default_account, "items": [{
        "date": item["date"], "title": item["title"], "amount": item["amount"],
        "type": item["type"], "category_id": default_category["id"],
        "installment_id": inst["id"], "installment_number": 3,
    }]})
    assert response.status_code == 201, response.text
    linked = [t for t in client.get("/api/transactions").json() if t["installment_number"] == 3]
    assert len(linked) == 1 and linked[0]["installment_id"] == inst["id"]


def test_confirm_can_create_the_installment_from_the_line(client, default_account, default_category):
    item = preview(client, default_account, [line(3)])["items"][0]
    assert item["installment_match"] is None

    response = client.post(CONFIRM, json={"account_id": default_account, "items": [{
        "date": item["date"], "title": item["title"], "amount": item["amount"],
        "type": item["type"], "category_id": default_category["id"],
        "create_installment": True, "installment_current": 3, "installment_total": 10,
    }]})
    assert response.status_code == 201, response.text
    assert response.json() == {"created": 1, "skipped_duplicates": 0}

    installments = client.get("/api/installments").json()
    assert len(installments) == 1
    assert installments[0]["title"] == "MAGAZINE LUIZA"
    assert installments[0]["anchor_due_date"] == TODAY.isoformat()
    # As parcelas 3 a 10: a 3 é a própria linha, sem avulsa a mais.
    numbers = sorted(t["installment_number"] for t in client.get("/api/transactions").json())
    assert numbers == list(range(3, 11))

    # A fatura do mês seguinte traz a parcela 4: já existe, vem desmarcada.
    next_due = add_months(TODAY, 1)
    following = f"{next_due:%d/%m} MAGAZINE LUIZA PARC 04/10 150,00"
    item4 = preview(client, default_account, [following], due=next_due)["items"][0]
    assert item4["installment_match"]["installment_id"] == installments[0]["id"]
    assert item4["duplicate"] is True


def test_create_installment_requires_the_parcel_numbers(client, default_account, default_category):
    response = client.post(CONFIRM, json={"account_id": default_account, "items": [{
        "date": TODAY.isoformat(), "title": "LOJA", "amount": "10.00", "type": "SAÍDA",
        "category_id": default_category["id"], "create_installment": True,
    }]})
    assert response.status_code == 422


def test_linking_to_another_users_installment_is_404(client_as):
    ana, bia = client_as("ana@example.com"), client_as("bia@example.com")
    a_cat = ana.get("/api/categories").json()[0]["id"]
    a_acc = ana.post("/api/accounts", json={"name": "A", "initial_balance": "0"}).json()["id"]
    inst = ana.post("/api/installments", json={
        "title": "X", "category_id": a_cat, "account_id": a_acc, "installment_amount": "10.00",
        "total_installments": 3, "current_installment": 1, "current_due_date": TODAY.isoformat(),
    }).json()
    b_cat = bia.get("/api/categories").json()[0]["id"]
    b_acc = bia.post("/api/accounts", json={"name": "B", "initial_balance": "0"}).json()["id"]
    response = bia.post(CONFIRM, json={"account_id": b_acc, "items": [{
        "date": TODAY.isoformat(), "title": "X", "amount": "10.00", "type": "SAÍDA",
        "category_id": b_cat, "installment_id": inst["id"], "installment_number": 1,
    }]})
    assert response.status_code == 404
    assert response.json()["detail"] == "Parcelamento não encontrado."
