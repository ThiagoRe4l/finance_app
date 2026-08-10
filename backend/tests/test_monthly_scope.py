"""Recorte mensal das agregações — `spent`, `txs_count` e os totais do dashboard.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Duas correções na mesma fatia, porque uma sem a outra deixa o dado meio certo:

1. **`_aggregated_rows` passa a filtrar pelo mês corrente.** Hoje não filtra nada:
   `spent` e `txs_count` são acumulados de todos os tempos, enquanto `budget` é
   orçamento **mensal**. `categorias.tsx` desenha `spent / budget`, então a barra
   só cresce e toda categoria fica permanentemente estourada. É bug de produção
   numa feature entregue, não inconsistência nova.

2. **`total_revenues`/`total_expenses` ganham o teto que faltava.** Usavam
   `date >= first_day` sem limite superior e contavam lançamento datado no
   futuro; o laço do `monthly_flow` sempre usou `>= m_start AND < m_end`. Os dois
   números divergiam na mesma tela.

O recorte é o intervalo **semiaberto** `[primeiro_dia_do_mês, primeiro_dia_do_mês_seguinte)`,
copiado do laço do `monthly_flow`, que já estava certo.

Datas relativas, nunca literais
-------------------------------
Todo teste aqui deriva as datas de `date.today()`. Data literal num teste de
recorte mensal é bomba-relógio: passaria no mês em que foi escrita e ficaria
vermelha no seguinte, sem ninguém tocar em código. Era exatamente o estado do
`conftest.create_transaction`, com `date="2026-08-07"` fixo — 15 usos em 7
arquivos. Desarmar isso faz parte da implementação desta fatia.
"""

import datetime

import pytest

from tests.conftest import create_category, money
from decimal import Decimal


# ---------------------------------------------------------------------------
# Datas relativas ao mês corrente
# ---------------------------------------------------------------------------

def _first_day_of_this_month() -> datetime.date:
    return datetime.date.today().replace(day=1)


def _first_day_of_next_month() -> datetime.date:
    first = _first_day_of_this_month()
    if first.month == 12:
        return datetime.date(first.year + 1, 1, 1)
    return datetime.date(first.year, first.month + 1, 1)


def _last_day_of_this_month() -> datetime.date:
    return _first_day_of_next_month() - datetime.timedelta(days=1)


def _day_in_previous_month() -> datetime.date:
    return _first_day_of_this_month() - datetime.timedelta(days=1)


def _tx(client, account_id, category_id, tx_type="SAÍDA", amount="100.00",
        date=None, title="Lançamento"):
    payload = {
        "title": title,
        "type": tx_type,
        "amount": amount,
        "date": (date or datetime.date.today()).isoformat(),
        "category_id": category_id,
        "account_id": account_id,
    }
    response = client.post("/api/transactions/", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _only_category(client):
    return client.get("/api/categories/").json()[0]


def _summary(client):
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# 1. `spent` passa a ser do mês corrente
# ---------------------------------------------------------------------------

def test_spent_ignores_previous_month(client, default_account, default_category):
    """O caso que quebra `categorias.tsx` hoje.

    Gasto de mês passado somando no `spent` de hoje faz a barra
    `spent / budget` crescer para sempre.
    """
    _tx(client, default_account, default_category["id"], amount="900.00",
        date=_day_in_previous_month())

    assert money(_only_category(client)["spent"]) == Decimal("0.00")


def test_spent_counts_only_the_current_month_portion(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], amount="900.00",
        date=_day_in_previous_month(), title="mês passado")
    _tx(client, default_account, default_category["id"], amount="100.00", title="este mês")

    assert money(_only_category(client)["spent"]) == Decimal("100.00")


def test_spent_ignores_future_dated_transactions(client, default_account, default_category):
    """O teto. Parcela agendada e boleto a vencer são casos reais."""
    _tx(client, default_account, default_category["id"], amount="500.00",
        date=_first_day_of_next_month())

    assert money(_only_category(client)["spent"]) == Decimal("0.00")


def test_first_day_of_the_month_is_included(client, default_account, default_category):
    """Fronteira inferior é inclusiva."""
    _tx(client, default_account, default_category["id"], amount="70.00",
        date=_first_day_of_this_month())

    assert money(_only_category(client)["spent"]) == Decimal("70.00")


def test_last_day_of_the_month_is_included(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], amount="70.00",
        date=_last_day_of_this_month())

    assert money(_only_category(client)["spent"]) == Decimal("70.00")


def test_first_day_of_next_month_is_excluded(client, default_account, default_category):
    """Fronteira superior é exclusiva — é o que `>=`/`<` do `monthly_flow` faz.

    Junto do teste acima, fixa o intervalo semiaberto. Um `<=` no lugar do `<`
    faria o primeiro dia do mês seguinte contar duas vezes ao virar o mês.
    """
    _tx(client, default_account, default_category["id"], amount="70.00",
        date=_first_day_of_next_month())

    assert money(_only_category(client)["spent"]) == Decimal("0.00")


# ---------------------------------------------------------------------------
# 2. `txs_count` acompanha o mesmo recorte
# ---------------------------------------------------------------------------

def test_txs_count_ignores_previous_month(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], date=_day_in_previous_month())
    _tx(client, default_account, default_category["id"])

    assert _only_category(client)["txs_count"] == 1


def test_txs_count_keeps_counting_income_within_the_month(client, default_account, default_category):
    """A assimetria documentada continua valendo **dentro** do mês.

    `spent` filtra SAÍDA; `txs_count` conta a categoria inteira, ENTRADA
    incluída. O que muda é só a janela, não a assimetria.
    """
    _tx(client, default_account, default_category["id"], "SAÍDA", "100.00")
    _tx(client, default_account, default_category["id"], "ENTRADA", "900.00")

    category = _only_category(client)
    assert money(category["spent"]) == Decimal("100.00")
    assert category["txs_count"] == 2


def test_category_with_only_old_movement_still_appears_zeroed(client, default_account, default_category):
    """O OUTER JOIN não pode virar filtro que some com a categoria.

    Regressão do modo de falha clássico: implementar o recorte como `WHERE` em
    vez de condição do `ON` faz a categoria sem movimento **no mês** desaparecer
    da listagem inteira — e do `category_distribution` do dashboard, que reusa
    `list_categories`.
    """
    _tx(client, default_account, default_category["id"], amount="900.00",
        date=_day_in_previous_month())

    listing = client.get("/api/categories/").json()

    assert len(listing) == 1
    assert money(listing[0]["spent"]) == Decimal("0.00")
    assert listing[0]["txs_count"] == 0


def test_category_never_touched_still_appears(client):
    """Regressão direta do OUTER JOIN, sem transação nenhuma no banco."""
    create_category(client, name="Lazer", icon_name="Gamepad2", color="oklch(0.6 0.2 300)")

    listing = client.get("/api/categories/").json()

    assert len(listing) == 1
    assert money(listing[0]["spent"]) == Decimal("0.00")


def test_patch_response_uses_the_same_window(client, default_account, default_category):
    """O `PATCH` monta a resposta pelo mesmo `_aggregated_rows`.

    Se o recorte for aplicado só em `list_categories`, a tela mostra um número
    depois de editar o orçamento e outro no próximo GET.
    """
    _tx(client, default_account, default_category["id"], amount="900.00",
        date=_day_in_previous_month())
    _tx(client, default_account, default_category["id"], amount="100.00")

    response = client.patch(
        f"/api/categories/{default_category['id']}", json={"budget": 1500.0}
    )

    assert response.status_code == 200, response.text
    assert money(response.json()["spent"]) == Decimal("100.00")
    assert response.json()["txs_count"] == 1


# ---------------------------------------------------------------------------
# 3. O teto que faltava em total_revenues / total_expenses
# ---------------------------------------------------------------------------

def test_total_expenses_ignores_future_dated_transactions(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "SAÍDA", "500.00",
        date=_first_day_of_next_month())

    assert money(_summary(client)["total_expenses"]) == Decimal("0.00")


def test_total_revenues_ignores_future_dated_transactions(client, default_account, default_category):
    _tx(client, default_account, default_category["id"], "ENTRADA", "500.00",
        date=_first_day_of_next_month())

    assert money(_summary(client)["total_revenues"]) == Decimal("0.00")


def test_totals_agree_with_the_current_month_bucket_of_monthly_flow(client, default_account, default_category):
    """A divergência que o teto ausente produzia, agora como invariante.

    Antes: uma transação datada no mês seguinte dava `total_expenses: "500.00"`
    e `monthly_flow[-1].outcome: "0.00"` — dois números diferentes para o mesmo
    mês, lado a lado na mesma tela.
    """
    _tx(client, default_account, default_category["id"], "SAÍDA", "500.00",
        date=_first_day_of_next_month(), title="futura")
    _tx(client, default_account, default_category["id"], "SAÍDA", "120.00", title="atual")
    _tx(client, default_account, default_category["id"], "ENTRADA", "800.00", title="salário")

    summary = _summary(client)
    current_bucket = summary["monthly_flow"][-1]

    assert money(summary["total_expenses"]) == money(current_bucket["outcome"])
    assert money(summary["total_revenues"]) == money(current_bucket["income"])


def test_totals_still_ignore_previous_month(client, default_account, default_category):
    """Regressão: o piso já funcionava e não pode se perder ao adicionar o teto."""
    _tx(client, default_account, default_category["id"], "SAÍDA", "900.00",
        date=_day_in_previous_month())
    _tx(client, default_account, default_category["id"], "SAÍDA", "100.00")

    assert money(_summary(client)["total_expenses"]) == Decimal("100.00")


# ---------------------------------------------------------------------------
# 4. A invariante que torna o gráfico do front possível
# ---------------------------------------------------------------------------

def test_category_distribution_sums_to_total_expenses(client, default_account):
    """É esta igualdade que o widget de distribuição do dashboard assume.

    Sem ela, `spent / total_expenses` não é participação — é razão entre bases
    diferentes, e foi o que produziu os 1000% no mapeamento do Dashboard.
    """
    alimentacao = create_category(client, name="Alimentação")
    transporte = create_category(client, name="Transporte", icon_name="Car",
                                 color="oklch(0.65 0.18 50)")

    _tx(client, default_account, alimentacao["id"], "SAÍDA", "342.50")
    _tx(client, default_account, transporte["id"], "SAÍDA", "28.90")
    # ruído que não pode entrar em nenhum dos dois lados
    _tx(client, default_account, alimentacao["id"], "SAÍDA", "900.00",
        date=_day_in_previous_month())
    _tx(client, default_account, transporte["id"], "SAÍDA", "500.00",
        date=_first_day_of_next_month())
    # ENTRADA não entra em `spent` nem em `total_expenses`
    _tx(client, default_account, alimentacao["id"], "ENTRADA", "8000.00")

    summary = _summary(client)
    distribution_total = sum(
        (money(c["spent"]) for c in summary["category_distribution"]), Decimal("0.00")
    )

    assert distribution_total == money(summary["total_expenses"])
    assert distribution_total == Decimal("371.40")


def test_distribution_and_totals_are_zero_on_a_fresh_month(client, default_account, default_category):
    """Mês sem movimento: tudo zerado com a escala do contrato, sem sumir nada."""
    _tx(client, default_account, default_category["id"], "SAÍDA", "900.00",
        date=_day_in_previous_month())

    summary = _summary(client)

    assert money(summary["total_expenses"]) == Decimal("0.00")
    assert len(summary["category_distribution"]) == 1
    assert money(summary["category_distribution"][0]["spent"]) == Decimal("0.00")
