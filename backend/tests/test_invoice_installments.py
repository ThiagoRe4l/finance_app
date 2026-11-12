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


# --- Revisão de segurança, 12/11/2026 (escritos antes da correção) ----------


def _confirm(client, account_id, category_id, **item):
    body = {"date": TODAY.isoformat(), "title": "LOJA PARC 01/10", "amount": "10.00",
            "type": "SAÍDA", "category_id": category_id}
    body.update(item)
    return client.post(CONFIRM, json={"account_id": account_id, "items": [body]})


def test_confirm_date_out_of_range_is_422_not_500(client, default_account, default_category):
    for date in ("9999-06-01", "9990-01-01", "0001-01-01"):
        response = _confirm(
            client, default_account, default_category["id"], date=date,
            create_installment=True, installment_current=1, installment_total=120,
        )
        assert response.status_code == 422, (date, response.text)
    assert client.get("/api/transactions").json() == []


def test_one_confirm_cannot_generate_more_than_500_rows(client, default_account, default_category):
    """500 itens × 120 parcelas eram 60 mil linhas numa requisição só."""
    item = {"date": TODAY.isoformat(), "title": "X", "amount": "10.00", "type": "SAÍDA",
            "category_id": default_category["id"], "create_installment": True,
            "installment_current": 1, "installment_total": 120}
    response = client.post(CONFIRM, json={"account_id": default_account, "items": [item] * 5})
    assert response.status_code == 422, response.text
    assert client.get("/api/transactions").json() == []


def test_linking_a_parcel_number_that_already_exists_is_409(client, default_account, default_category):
    inst = existing_installment(client, default_account, default_category["id"])
    response = _confirm(
        client, default_account, default_category["id"], title="OUTRO TITULO",
        allow_duplicate=True, installment_id=inst["id"], installment_number=3,
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "A parcela 3 deste parcelamento já está lançada."
    numbers = [t["installment_number"] for t in client.get("/api/transactions").json()]
    assert numbers.count(3) == 1


def test_installment_total_that_overflows_the_money_column_is_422(client, default_account, default_category):
    """Numeric(12,2) vai até 9.999.999.999,99; 120 × 99.999.999,99 passa."""
    response = _confirm(
        client, default_account, default_category["id"], amount="99999999.99",
        create_installment=True, installment_current=1, installment_total=120,
    )
    assert response.status_code == 422
    response = client.post("/api/installments", json={
        "title": "X", "category_id": default_category["id"], "account_id": default_account,
        "installment_amount": "99999999.99", "total_installments": 120,
        "current_installment": 1, "current_due_date": TODAY.isoformat(),
    })
    assert response.status_code == 422


# --- Revisão de 12/11/2026 (escritos antes da correção) ----------------------


def test_double_submit_of_create_installment_does_not_create_two(client, default_account, default_category):
    body = {"account_id": default_account, "items": [{
        "date": TODAY.isoformat(), "title": "LOJA X PARC 03/10", "amount": "150.00", "type": "SAÍDA",
        "category_id": default_category["id"], "create_installment": True,
        "installment_current": 3, "installment_total": 10,
    }]}
    assert client.post(CONFIRM, json=body).json() == {"created": 1, "skipped_duplicates": 0}
    assert client.post(CONFIRM, json=body).json() == {"created": 0, "skipped_duplicates": 1}
    assert len(client.get("/api/installments").json()) == 1


def test_linking_to_a_legacy_installment_is_rejected(client, session, default_account, default_category):
    from tests.conftest import create_legacy_installment

    legacy = create_legacy_installment(client, session, default_account, default_category["id"],
                                       current_installment=3, total_installments=10)
    response = _confirm(client, default_account, default_category["id"],
                        installment_id=legacy["id"], installment_number=3)
    assert response.status_code == 409
    assert "sem cronograma" in response.json()["detail"]
    assert client.get("/api/transactions").json() == []


def test_match_prefers_the_exact_title(client, default_account, default_category):
    existing_installment(client, default_account, default_category["id"], title="Loja")
    sofa = existing_installment(client, default_account, default_category["id"], title="Loja Sofa")
    item = preview(client, default_account, [line(3, "LOJA SOFA")])["items"][0]
    assert item["installment_match"]["installment_id"] == sofa["id"]


def test_match_does_not_use_a_tiny_or_partial_word_title(client, default_account, default_category):
    existing_installment(client, default_account, default_category["id"], title="TV")
    existing_installment(client, default_account, default_category["id"], title="Magazine")
    assert preview(client, default_account, [line(3, "TV BOX LOJA")])["items"][0]["installment_match"] is None
    assert preview(client, default_account, [line(3, "MAGAZINELUIZA")])["items"][0]["installment_match"] is None
