"""`remaining_amount` e `GET /api/installments/summary`.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

A tela de parcelamentos precisa de três números no topo — ativos,
comprometido/mês e saldo a pagar. Os dois primeiros já existiam em
`DashboardSummary`; o terceiro não existia e o mock somava no cliente.

A fatia entrega:

* **`remaining_amount`** em `InstallmentResponse`, campo derivado (exceção
  declarada ao padrão de serialização direta, como `spent`/`txs_count`):
  `installment_amount × (total_installments - current_installment + 1)`, com a
  contagem de parcelas limitada a `[0, total_installments]`.
* **`GET /installments/summary`** com os três totais, numa requisição só.
* **`app/installment_metrics.py`** compartilhando a definição de "ativo" entre
  `dashboard.py` e o router novo — duplicá-la é como o `<=` frágil do 4.3
  viraria `<` de um lado só.

O `+1` vem da D13: `current` é a parcela **ainda a pagar**, então 2/12 tem 11
pela frente. Para quitado (13/12) a conta dá zero sem caso especial.
"""

from decimal import Decimal

import pytest

from tests.conftest import money


def _installment(client, account_id, category_id, *, current, total,
                 amount="450.00", total_amount="5400.00", title="Notebook Pro"):
    response = client.post("/api/installments/", json={
        "title": title,
        "category_id": category_id,
        "total_amount": total_amount,
        "installment_amount": amount,
        "current_installment": current,
        "total_installments": total,
        "end_date": "Ago/2026",
        "account_id": account_id,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _summary(client):
    response = client.get("/api/installments/summary")
    assert response.status_code == 200, response.text
    return response.json()


def _only(client):
    return client.get("/api/installments/").json()[0]


# ---------------------------------------------------------------------------
# remaining_amount por item
# ---------------------------------------------------------------------------

def test_remaining_amount_counts_the_current_installment_as_unpaid(client, default_account, default_category):
    """2/12 de R$ 450 → 11 parcelas × 450 = R$ 4.950.

    O `+1` é a parte que se erra: sem ele daria 10 parcelas (4.500), porque a
    parcela corrente seria contada como já paga — o que contradiz a D13.
    """
    _installment(client, default_account, default_category["id"], current=2, total=12)

    assert money(_only(client)["remaining_amount"]) == Decimal("4950.00")


def test_first_installment_owes_the_whole_thing(client, default_account, default_category):
    """1/12 → as 12 parcelas ainda a pagar."""
    _installment(client, default_account, default_category["id"], current=1, total=12)

    assert money(_only(client)["remaining_amount"]) == Decimal("5400.00")


def test_last_installment_still_owes_one(client, default_account, default_category):
    """12/12 é a última parcela, ainda a pagar — mesma fronteira do 4.3."""
    _installment(client, default_account, default_category["id"], current=12, total=12)

    assert money(_only(client)["remaining_amount"]) == Decimal("450.00")


def test_paid_off_owes_nothing(client, default_account, default_category):
    """13/12 → `12 - 13 + 1 = 0`. Zero sem caso especial."""
    _installment(client, default_account, default_category["id"], current=13, total=12)

    assert money(_only(client)["remaining_amount"]) == Decimal("0.00")


def test_far_past_the_end_does_not_go_negative(client, default_account, default_category):
    """20/12 daria `-7` parcelas. O piso em zero evita saldo a pagar negativo."""
    _installment(client, default_account, default_category["id"], current=20, total=12)

    assert money(_only(client)["remaining_amount"]) == Decimal("0.00")


def test_current_below_one_is_capped_at_the_total(client, default_account, default_category):
    """0/12 daria 13 parcelas — mais do que o parcelamento tem.

    Estado que não deveria existir (o schema não impede), mas o teto em
    `total_installments` mantém o número dentro do que é possível dever.
    """
    _installment(client, default_account, default_category["id"], current=0, total=12)

    assert money(_only(client)["remaining_amount"]) == Decimal("5400.00")


def test_remaining_amount_is_money_typed(client, default_account, default_category):
    """Campo derivado também é `Decimal` — string JSON com duas casas."""
    _installment(client, default_account, default_category["id"],
                 current=3, total=6, amount="120.00", total_amount="720.00")

    assert _only(client)["remaining_amount"] == "480.00"


def test_remaining_amount_is_exact_with_awkward_cents(client, default_account, default_category):
    """R$ 33,33 × 11 = R$ 366,63 exatos — não 366.62999999999994."""
    _installment(client, default_account, default_category["id"],
                 current=2, total=12, amount="33.33", total_amount="399.96")

    assert money(_only(client)["remaining_amount"]) == Decimal("366.63")


# ---------------------------------------------------------------------------
# GET /installments/summary
# ---------------------------------------------------------------------------

def test_summary_returns_the_three_numbers(client, default_account, default_category):
    """O cenário do mapeamento: três ativos e um quitado.

    Comprometido = 450 + 120 + 55 = 625 (o quitado de 300 fica fora).
    Saldo a pagar = 450×11 + 120×4 + 55×8 + 0 = 4950 + 480 + 440 = 5870.
    """
    cat = default_category["id"]
    _installment(client, default_account, cat, current=2, total=12, amount="450.00",
                 total_amount="5400.00", title="Notebook Pro")
    _installment(client, default_account, cat, current=3, total=6, amount="120.00",
                 total_amount="720.00", title="Curso Online")
    _installment(client, default_account, cat, current=5, total=12, amount="55.00",
                 total_amount="660.00", title="Sofá Retrátil")
    _installment(client, default_account, cat, current=13, total=12, amount="300.00",
                 total_amount="3600.00", title="Geladeira")

    summary = _summary(client)

    assert summary["active_count"] == 3
    assert money(summary["monthly_committed_amount"]) == Decimal("625.00")
    assert money(summary["remaining_total_amount"]) == Decimal("5870.00")


def test_summary_route_is_not_shadowed_by_an_id_route(client):
    """⚠️ Guarda de ordem de rotas.

    `@router.get("/summary")` tem que vir antes de qualquer
    `GET /{installment_id}` que venha a existir — senão o FastAPI tenta
    converter `"summary"` em `int` e devolve 422. Hoje não há `GET` por id;
    este assert é o que denuncia quando houver.
    """
    response = client.get("/api/installments/summary")

    assert response.status_code == 200, response.text


def test_summary_on_an_empty_database(client):
    """Zeros com a escala do contrato, não `0` nem ausência de campo."""
    summary = _summary(client)

    assert summary["active_count"] == 0
    assert money(summary["monthly_committed_amount"]) == Decimal("0.00")
    assert money(summary["remaining_total_amount"]) == Decimal("0.00")


def test_summary_with_only_paid_off_installments(client, default_account, default_category):
    """Quitado não conta em nenhum dos três, mas continua existindo."""
    cat = default_category["id"]
    _installment(client, default_account, cat, current=13, total=12, amount="300.00", title="A")
    _installment(client, default_account, cat, current=7, total=6, amount="120.00", title="B")

    summary = _summary(client)

    assert summary["active_count"] == 0
    assert money(summary["monthly_committed_amount"]) == Decimal("0.00")
    assert money(summary["remaining_total_amount"]) == Decimal("0.00")
    assert len(client.get("/api/installments/").json()) == 2


def test_summary_totals_are_exact_with_awkward_cents(client, default_account, default_category):
    """Três parcelas de 33,33 somam 99,99 — não 99.98999999999998."""
    cat = default_category["id"]
    for i in range(3):
        _installment(client, default_account, cat, current=12, total=12,
                     amount="33.33", total_amount="399.96", title=f"P{i}")

    summary = _summary(client)

    assert money(summary["monthly_committed_amount"]) == Decimal("99.99")
    # Cada um deve 1 parcela (12/12), então o saldo a pagar é o mesmo total.
    assert money(summary["remaining_total_amount"]) == Decimal("99.99")


# ---------------------------------------------------------------------------
# A regra de "ativo" é compartilhada, não duplicada
# ---------------------------------------------------------------------------

def test_summary_agrees_with_the_dashboard(client, default_account, default_category):
    """Os dois endpoints têm que devolver os mesmos dois números.

    É o teste que dá sentido a `installment_metrics.py`: se a definição de
    "ativo" for duplicada, um `<=` vira `<` de um lado só e a mesma métrica
    passa a ter dois valores no mesmo app.
    """
    cat = default_category["id"]
    _installment(client, default_account, cat, current=2, total=12, amount="450.00", title="A")
    _installment(client, default_account, cat, current=12, total=12, amount="500.00", title="B")
    _installment(client, default_account, cat, current=13, total=12, amount="300.00", title="C")

    summary = _summary(client)
    dashboard = client.get("/api/dashboard/summary").json()

    assert summary["active_count"] == dashboard["active_installments_count"]
    assert money(summary["monthly_committed_amount"]) == money(
        dashboard["monthly_committed_amount"]
    )


def test_last_installment_counts_as_active_in_both(client, default_account, default_category):
    """A fronteira do 4.3, agora nos dois endpoints.

    12/12 é a última parcela, ainda a pagar. Trocar `<=` por `<` derrubaria o
    mês final de todo parcelamento — e agora em dois lugares.
    """
    _installment(client, default_account, default_category["id"],
                 current=12, total=12, amount="450.00")

    summary = _summary(client)
    dashboard = client.get("/api/dashboard/summary").json()

    assert summary["active_count"] == 1
    assert dashboard["active_installments_count"] == 1
    assert money(summary["remaining_total_amount"]) == Decimal("450.00")


# ---------------------------------------------------------------------------
# Regressões do contrato existente
# ---------------------------------------------------------------------------

def test_listing_still_returns_paid_off_installments(client, default_account, default_category):
    """✅ **Já passa hoje.** O filtro é da métrica, não do recurso (4.2/4.3).

    A tela mostra o quitado com marcador, então ele não pode sumir da listagem.
    """
    _installment(client, default_account, default_category["id"], current=13, total=12)

    listing = client.get("/api/installments/").json()

    assert len(listing) == 1
    assert listing[0]["current_installment"] == 13


def test_patch_updates_the_derived_remaining_amount(client, default_account, default_category):
    """Avançar a parcela reduz o saldo a pagar — o campo é derivado, não gravado.

    O `PATCH` do 4.2 responde pelo mesmo schema, então tem que trazer o valor
    já recalculado, sem esperar o próximo GET.
    """
    created = _installment(client, default_account, default_category["id"], current=2, total=12)
    assert money(created["remaining_amount"]) == Decimal("4950.00")

    response = client.patch(
        f"/api/installments/{created['id']}", json={"current_installment": 3}
    )

    assert response.status_code == 200, response.text
    assert money(response.json()["remaining_amount"]) == Decimal("4500.00")
