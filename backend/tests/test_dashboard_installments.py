"""Agregações de parcelamento no dashboard — dia 4.3.

Escrito **antes** da implementação. Fecha o bug latente que a D13 expôs: ao
tornar `current_installment > total_installments` um estado válido e alcançável
pela API, o dia 4.2 criou a possibilidade de um parcelamento quitado continuar
contado como ativo e como dinheiro comprometido no mês.

`get_dashboard_summary` (`routers/dashboard.py`) hoje agrega sem filtro nenhum:

    installments = db.query(models.Installment).all()
    committed = sum(it.installment_amount for it in installments)

O contrato que estes testes travam: **quitado é `current_installment >
total_installments`**, e parcelamento quitado sai das duas agregações.

Fronteira, que é a parte fácil de errar
---------------------------------------
`current == total` é a **última parcela**, ainda ativa — ela ainda vai ser paga.
Só `current > total` é quitado. Um `<` no lugar de `<=` derruba exatamente o mês
final de todo parcelamento do app, e é o tipo de off-by-one que passa
despercebido porque o número continua "parecendo certo".

⚠️ Estado desta suíte hoje
--------------------------
Diferente do 4.1/4.2, a rota `/api/dashboard/summary` **já existe** — os testes
falham com diff de valor real (`assert 2 == 1`), não com 404 de rota ausente.

Em compensação, **os testes de regressão já passam contra o código atual**, e
está certo que passem: eles descrevem o comportamento que *não* pode mudar.
Estão marcados com ✅ no docstring. Não conte como cobertura nova — conte como
rede de proteção para a mudança.
"""

from decimal import Decimal

import datetime

import pytest

from tests.conftest import money, create_transaction, installment_payload


def _create_installment(client, account_id, category_id, current, total,
                        installment_amount=500.0, title="Parcelamento"):
    response = client.post("/api/installments/", json=installment_payload(
        account_id, category_id,
        title=title,
        current_installment=current,
        total_installments=total,
        installment_amount=installment_amount,
    ))
    assert response.status_code == 201, response.text
    return response.json()


def _summary(client):
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Quitado sai das duas agregações
# ---------------------------------------------------------------------------

def test_paid_off_installment_is_not_counted_as_active(client, default_account, default_category):
    """13/12 é quitado — não é parcelamento ativo."""
    _create_installment(client, default_account, default_category["id"], current=13, total=12)

    assert _summary(client)["active_installments_count"] == 0


def test_paid_off_installment_does_not_add_to_the_committed_amount(client, default_account, default_category):
    """Dinheiro que já não sai do bolso não pode aparecer como comprometido."""
    _create_installment(
        client, default_account, default_category["id"],
        current=13, total=12, installment_amount=500.0,
    )

    assert money(_summary(client)["monthly_committed_amount"]) == Decimal("0.00")


def test_installment_far_past_the_end_is_also_excluded(client, default_account, default_category):
    """Não é só o "um a mais": um parcelamento parado em 20/12 também sumiu."""
    _create_installment(client, default_account, default_category["id"], current=20, total=12)

    summary = _summary(client)
    assert summary["active_installments_count"] == 0
    assert money(summary["monthly_committed_amount"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Fronteira: última parcela ainda é ativa
# ---------------------------------------------------------------------------

def test_last_installment_still_counts_as_active(client, default_account, default_category):
    """✅ **Já passa hoje** — regressão da fronteira.

    12/12 é a última parcela e ela ainda vai ser paga. Quitado começa em 13/12.
    Trocar o `<=` por `<` na implementação derrubaria o mês final de todo
    parcelamento do app; este teste é o que impede.
    """
    _create_installment(
        client, default_account, default_category["id"],
        current=12, total=12, installment_amount=500.0,
    )

    summary = _summary(client)
    assert summary["active_installments_count"] == 1
    assert money(summary["monthly_committed_amount"]) == Decimal("500.00")


def test_first_installment_counts_as_active(client, default_account, default_category):
    """✅ **Já passa hoje** — a outra ponta do intervalo."""
    _create_installment(
        client, default_account, default_category["id"],
        current=1, total=12, installment_amount=500.0,
    )

    summary = _summary(client)
    assert summary["active_installments_count"] == 1
    assert money(summary["monthly_committed_amount"]) == Decimal("500.00")


def test_installment_in_progress_counts_normally(client, default_account, default_category):
    """✅ **Já passa hoje** — o caso comum, que é o que não pode quebrar."""
    _create_installment(
        client, default_account, default_category["id"],
        current=2, total=12, installment_amount=450.0,
    )

    summary = _summary(client)
    assert summary["active_installments_count"] == 1
    assert money(summary["monthly_committed_amount"]) == Decimal("450.00")


# ---------------------------------------------------------------------------
# Mistura — o teste que sozinho descreve a regra inteira
# ---------------------------------------------------------------------------

def test_only_active_installments_reach_the_aggregations(client, default_account, default_category):
    """Dois ativos, um na última parcela, dois quitados.

    Contagem esperada: 3 (2/12, 12/12 e 5/6). Comprometido: 450 + 500 + 120,
    sem os 300 e os 80 dos quitados. Os números são distintos de propósito —
    um filtro que erre a fronteira dá 4 e 1250, e um que não filtre nada dá 5
    e 1450.
    """
    _create_installment(client, default_account, default_category["id"],
                        current=2, total=12, installment_amount=450.0, title="Notebook")
    _create_installment(client, default_account, default_category["id"],
                        current=12, total=12, installment_amount=500.0, title="Sofá")
    _create_installment(client, default_account, default_category["id"],
                        current=5, total=6, installment_amount=120.0, title="Curso")
    _create_installment(client, default_account, default_category["id"],
                        current=13, total=12, installment_amount=300.0, title="Geladeira")
    _create_installment(client, default_account, default_category["id"],
                        current=7, total=6, installment_amount=80.0, title="Fone")

    summary = _summary(client)
    assert summary["active_installments_count"] == 3
    assert money(summary["monthly_committed_amount"]) == Decimal("1070.00")


def test_all_paid_off_zeroes_both_aggregations(client, default_account, default_category):
    _create_installment(client, default_account, default_category["id"],
                        current=13, total=12, installment_amount=500.0, title="Notebook")
    _create_installment(client, default_account, default_category["id"],
                        current=7, total=6, installment_amount=120.0, title="Curso")

    summary = _summary(client)
    assert summary["active_installments_count"] == 0
    assert money(summary["monthly_committed_amount"]) == Decimal("0.00")


def test_no_installments_at_all(client, default_account, default_category):
    """✅ **Já passa hoje** — o filtro não pode quebrar o caso vazio."""
    summary = _summary(client)
    assert summary["active_installments_count"] == 0
    assert money(summary["monthly_committed_amount"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Integração com o 4.2 e limites do filtro
# ---------------------------------------------------------------------------

def test_advancing_past_the_end_removes_it_from_the_aggregations(client, default_account, default_category):
    """Ponta a ponta com o 4.2 — o caminho pelo qual o estado vira alcançável.

    É exatamente este fluxo que a D13 abriu: antes do `PATCH` não havia como
    um parcelamento passar de `total_installments` pela API, e o bug ficava
    latente.
    """
    installment = _create_installment(
        client, default_account, default_category["id"],
        current=12, total=12, installment_amount=500.0,
    )

    assert _summary(client)["active_installments_count"] == 1

    assert client.patch(
        f"/api/installments/{installment['id']}", json={"current_installment": 13}
    ).status_code == 200

    summary = _summary(client)
    assert summary["active_installments_count"] == 0
    assert money(summary["monthly_committed_amount"]) == Decimal("0.00")


def test_the_filter_does_not_leak_into_the_installments_listing(client, default_account, default_category):
    """✅ **Já passa hoje** — fronteira entre os dois endpoints.

    Quitado sai da *agregação do dashboard*, não da listagem: `GET
    /installments` continua devolvendo o histórico completo (decidido no 4.2).
    Implementar o filtro no lugar errado — em `list_installments` — faria o
    parcelamento sumir da tela em vez de sair da métrica.
    """
    _create_installment(client, default_account, default_category["id"], current=13, total=12)

    listing = client.get("/api/installments/").json()
    assert len(listing) == 1
    assert listing[0]["current_installment"] == 13


def test_the_filter_does_not_touch_the_transactions_of_a_paid_off_installment(client, default_account, default_category):
    """As parcelas lançadas continuam no extrato.

    Sair da métrica de "comprometido" não apaga o histórico: o dinheiro saiu da
    conta e as transações seguem contando em `total_expenses` e na agregação de
    categoria. Vermelho pela contagem (que é comportamento novo), mas o valor
    dele está nas outras duas asserções — um filtro implementado no lugar errado
    (removendo as transações do parcelamento quitado das agregações de
    transação) passaria na primeira e quebraria aqui.
    """
    installment = _create_installment(
        client, default_account, default_category["id"], current=13, total=12
    )
    client.post("/api/transactions", json={
        "title": "Parcela 12",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": datetime.date.today().isoformat(),
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": installment["id"],
    })

    summary = _summary(client)
    assert summary["active_installments_count"] == 0
    assert len(summary["recent_transactions"]) == 1
    assert money(summary["category_distribution"][0]["spent"]) == Decimal("500.00")


def test_paid_off_installment_still_blocks_its_category_deletion(client, default_account, default_category):
    """✅ **Já passa hoje** — o 409 do 4.1 não olha se o parcelamento acabou.

    A FK `Installment.category_id` continua sendo `RESTRICT` independentemente
    do progresso. "Quitado" é um conceito de agregação, não de integridade
    referencial, e misturar os dois faria o DELETE cair no 500 que o C10
    justamente removeu.
    """
    _create_installment(client, default_account, default_category["id"], current=13, total=12)

    assert client.delete(f"/api/categories/{default_category['id']}").status_code == 409
