"""`GET /api/reports/overview` — o arquivo de teste que `reports.py` nunca teve.

Escrito **antes** da implementação da correção do recorte de `top_categories`.

Até aqui a única rota de `reports.py` era coberta de raspão por dois testes que
moram em outros arquivos (`test_reports_overview_smoke` em `test_dashboard.py` e
`test_reports_top_categories_grouped_by_foreign_key` em `test_category_fk.py`).
Foi essa lacuna que deixou o bug abaixo passar.

O bug
-----
`total_revenues`/`total_expenses` somam os 6 meses de `monthly_flow`, mas
`top_cats_query` filtra só `type == "SAÍDA"` — **sem recorte de data**. As duas
metades do mesmo relatório falam de períodos diferentes.

Verificado no mapeamento: R$ 9.000 gastos há 13 meses e R$ 850 nos últimos 6
davam `total_expenses: "850.00"` contra `top_categories[0]: "9050.00"` — a maior
categoria valendo 10× o total do período, lado a lado na tela.

É o mesmo defeito de `_aggregated_rows` corrigido em 10/08.

Datas relativas, nunca literais
-------------------------------
Todas derivadas de `date.today()`. Data literal em teste de recorte é
bomba-relógio — ver "Itens futuros → 0.1" no CLAUDE.md.
"""

import datetime
from decimal import Decimal

import pytest

from tests.conftest import create_category, money

REPORT_MONTHS = 6


# ---------------------------------------------------------------------------
# Datas relativas à janela do relatório
# ---------------------------------------------------------------------------

def _first_of_month(offset_months: int) -> datetime.date:
    """Primeiro dia do mês `offset_months` meses atrás (0 = mês corrente)."""
    today = datetime.date.today()
    month = today.month - offset_months
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return datetime.date(year, month, 1)


def _inside_window() -> datetime.date:
    """Primeiro dia do mês mais antigo ainda dentro da janela de 6 meses."""
    return _first_of_month(REPORT_MONTHS - 1)


def _just_outside_window() -> datetime.date:
    """Último dia do mês imediatamente anterior à janela."""
    return _inside_window() - datetime.timedelta(days=1)


def _first_of_next_month() -> datetime.date:
    first = _first_of_month(0)
    if first.month == 12:
        return datetime.date(first.year + 1, 1, 1)
    return datetime.date(first.year, first.month + 1, 1)


def _tx(client, account_id, category_id, tx_type="SAÍDA", amount="100.00", date=None):
    response = client.post("/api/transactions/", json={
        "title": "Lançamento",
        "type": tx_type,
        "amount": amount,
        "date": (date or datetime.date.today()).isoformat(),
        "category_id": category_id,
        "account_id": account_id,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _overview(client):
    response = client.get("/api/reports/overview")
    assert response.status_code == 200, response.text
    return response.json()


def _by_name(overview):
    return {c["name"]: money(c["value"]) for c in overview["top_categories"]}


# ---------------------------------------------------------------------------
# O bug: top_categories tem que respeitar a janela do relatório
# ---------------------------------------------------------------------------

def test_top_categories_ignores_spending_older_than_the_window(client, default_account, default_category):
    """O caso exato do mapeamento, em escala menor.

    Gasto de 13 meses atrás não pode aparecer num relatório de 6 meses.
    """
    old = _first_of_month(REPORT_MONTHS + 6)
    _tx(client, default_account, default_category["id"], amount="9000.00", date=old)
    _tx(client, default_account, default_category["id"], amount="50.00")

    assert _by_name(_overview(client))["Alimentação"] == Decimal("50.00")


def test_top_categories_ignores_future_dated_spending(client, default_account, default_category):
    """O teto da janela, mesmo caso da correção de 10/08 no dashboard."""
    _tx(client, default_account, default_category["id"], amount="500.00",
        date=_first_of_next_month())
    _tx(client, default_account, default_category["id"], amount="50.00")

    assert _by_name(_overview(client))["Alimentação"] == Decimal("50.00")


def test_the_oldest_month_of_the_window_is_included(client, default_account, default_category):
    """Fronteira inferior inclusiva: o 6º mês para trás ainda conta."""
    _tx(client, default_account, default_category["id"], amount="70.00",
        date=_inside_window())

    assert _by_name(_overview(client))["Alimentação"] == Decimal("70.00")


def test_the_day_before_the_window_is_excluded(client, default_account, default_category):
    """Fronteira exclusiva do outro lado — um dia antes já está fora.

    Junto do teste acima, fixa a janela exatamente. Um erro de um mês no
    cálculo do início passaria despercebido sem esse par.
    """
    _tx(client, default_account, default_category["id"], amount="70.00",
        date=_just_outside_window())

    assert _overview(client)["top_categories"] == []


def test_a_category_that_only_spent_outside_the_window_disappears(client, default_account):
    """Categoria sem gasto **na janela** sai do ranking.

    Diferente de `GET /categories/`, onde o OUTER JOIN a mantém zerada: aqui é
    um ranking dos maiores, e uma linha em zero não é informação.
    """
    antiga = create_category(client, name="Alimentação")
    atual = create_category(client, name="Transporte", icon_name="Car", color="oklch(0.65 0.18 50)")

    _tx(client, default_account, antiga["id"], amount="9000.00",
        date=_first_of_month(REPORT_MONTHS + 2))
    _tx(client, default_account, atual["id"], amount="30.00")

    assert list(_by_name(_overview(client))) == ["Transporte"]


# ---------------------------------------------------------------------------
# A invariante que o bug violava
# ---------------------------------------------------------------------------

def test_top_categories_never_exceeds_total_expenses(client, default_account):
    """Nenhuma categoria pode valer mais que o total de despesas do período.

    Era exatamente o que acontecia: 9.050,00 numa categoria contra 850,00 de
    total. É a asserção que teria pego o bug sozinha.
    """
    moradia = create_category(client, name="Moradia", icon_name="Home", color="oklch(0.45 0.04 235)")
    alimentacao = create_category(client, name="Alimentação")

    _tx(client, default_account, moradia["id"], amount="9000.00",
        date=_first_of_month(REPORT_MONTHS + 6))
    _tx(client, default_account, moradia["id"], amount="50.00")
    _tx(client, default_account, alimentacao["id"], amount="800.00")

    overview = _overview(client)
    ranking_total = sum(money(c["value"]) for c in overview["top_categories"])

    assert ranking_total <= money(overview["total_expenses"])


def test_with_four_or_fewer_categories_the_ranking_sums_to_total_expenses(client, default_account):
    """Com até 4 categorias o ranking cobre tudo, então é igualdade.

    Mais forte que o `<=` acima: pega tanto gasto sobrando de fora da janela
    quanto gasto faltando por recorte apertado demais.
    """
    a = create_category(client, name="Moradia", icon_name="Home", color="oklch(0.45 0.04 235)")
    b = create_category(client, name="Alimentação")

    _tx(client, default_account, a["id"], amount="342.50")
    _tx(client, default_account, b["id"], amount="28.90")
    _tx(client, default_account, a["id"], amount="86.40", date=_inside_window())
    # ruído que não pode entrar em nenhum dos dois lados
    _tx(client, default_account, b["id"], amount="900.00", date=_first_of_month(REPORT_MONTHS + 1))
    _tx(client, default_account, a["id"], amount="700.00", date=_first_of_next_month())
    _tx(client, default_account, b["id"], "ENTRADA", "5000.00")

    overview = _overview(client)
    ranking_total = sum(money(c["value"]) for c in overview["top_categories"])

    assert ranking_total == money(overview["total_expenses"])
    assert ranking_total == Decimal("457.80")


# ---------------------------------------------------------------------------
# Regressões: o contrato de reports.py, que nunca teve teste próprio
# ---------------------------------------------------------------------------

def test_totals_are_the_sum_of_the_monthly_comparative(client, default_account, default_category):
    """✅ **Já passa hoje.** Os totais saem do próprio `monthly_comparative`."""
    _tx(client, default_account, default_category["id"], "ENTRADA", "1000.00")
    _tx(client, default_account, default_category["id"], "SAÍDA", "400.00")
    _tx(client, default_account, default_category["id"], "SAÍDA", "100.00", date=_inside_window())

    overview = _overview(client)
    income = sum(money(m["income"]) for m in overview["monthly_comparative"])
    outcome = sum(money(m["outcome"]) for m in overview["monthly_comparative"])

    assert money(overview["total_revenues"]) == income
    assert money(overview["total_expenses"]) == outcome


def test_monthly_comparative_always_has_six_months(client):
    """✅ **Já passa hoje.** O gráfico da tela assume 6 barras."""
    assert len(_overview(client)["monthly_comparative"]) == REPORT_MONTHS


def test_ranking_is_limited_to_four_and_ordered_desc(client, default_account):
    """✅ **Já passa hoje.** Regressão do `limit(4)` e do `order_by desc`."""
    valores = ["500.00", "400.00", "300.00", "200.00", "100.00"]
    for i, valor in enumerate(valores):
        cat = create_category(client, name=f"Cat {i}", icon_name="Home", color="x")
        _tx(client, default_account, cat["id"], amount=valor)

    ranking = _overview(client)["top_categories"]

    assert len(ranking) == 4
    assert [c["name"] for c in ranking] == ["Cat 0", "Cat 1", "Cat 2", "Cat 3"]


def test_income_never_enters_the_ranking(client, default_account, default_category):
    """✅ **Já passa hoje.** É ranking de **despesas**."""
    _tx(client, default_account, default_category["id"], "ENTRADA", "9000.00")
    _tx(client, default_account, default_category["id"], "SAÍDA", "50.00")

    assert _by_name(_overview(client))["Alimentação"] == Decimal("50.00")


def test_overview_on_an_empty_database(client):
    """✅ **Já passa hoje.** Zeros com a escala do contrato, ranking vazio."""
    overview = _overview(client)

    assert money(overview["total_revenues"]) == Decimal("0.00")
    assert money(overview["total_expenses"]) == Decimal("0.00")
    assert overview["top_categories"] == []
    assert overview["average_savings"] == 0.0


def test_money_and_percentage_types(client, default_account, default_category):
    """✅ **Já passa hoje.** Dinheiro é string; média é número."""
    _tx(client, default_account, default_category["id"], "ENTRADA", "1200.00")

    overview = _overview(client)

    assert isinstance(overview["total_revenues"], str)
    assert isinstance(overview["top_categories"], list)
    assert isinstance(overview["average_savings"], float)


def test_average_savings_is_the_six_month_mean(client, default_account, default_category):
    """✅ **Já passa hoje.** `(entradas - saídas) / 6`, dízima incluída."""
    _tx(client, default_account, default_category["id"], "ENTRADA", "1000.00")

    assert _overview(client)["average_savings"] == pytest.approx(1000.0 / REPORT_MONTHS)


def test_overview_route_has_no_trailing_slash(client):
    """✅ **Já passa hoje.** Rota específica, como `/dashboard/summary`.

    Com barra o FastAPI responde 307 e cada chamada custa um round-trip a mais.
    O front consome sem barra.
    """
    assert client.get("/api/reports/overview", follow_redirects=False).status_code == 200
    assert client.get("/api/reports/overview/", follow_redirects=False).status_code == 307


# ---------------------------------------------------------------------------
# `insights` sai do contrato (13/08/2026)
# ---------------------------------------------------------------------------

def test_overview_no_longer_returns_insights(client, default_account, default_category):
    """Texto pronto em português é apresentação, e apresentação é do front.

    Mesmo padrão que tirou o rótulo Fixa/Variável/Parcelada do backend no dia 3.
    Dos 4 insights do mock só um tinha lastro (parcelamentos), e a tela passa a
    montá-lo a partir de `GET /installments/summary`.
    """
    _tx(client, default_account, default_category["id"], "ENTRADA", "1000.00")

    assert "insights" not in _overview(client)


def test_the_moradia_insight_is_gone(client, default_account):
    """O defeito que motivou a remoção, travado como regressão.

    A frase era condicionada à **presença** de "Moradia" no top 4, não a ela ser
    a maior. Com Moradia em último lugar com R$ 1,00, a API afirmava que ela era
    "a maior fatia do seu orçamento".
    """
    for nome, valor in [("Alimentação", "5000.00"), ("Moradia", "1.00")]:
        cat = create_category(client, name=nome, icon_name="Home", color="x")
        _tx(client, default_account, cat["id"], amount=valor)

    corpo = str(_overview(client))

    assert "maior fatia" not in corpo
    assert "Moradia representam" not in corpo


def test_no_preformatted_currency_text_in_the_payload(client, default_account, default_category):
    """`f"R$ {avg_saving:,.2f}"` produzia `R$ 1,915.94` — formato americano.

    Nenhum "R$" deve sobrar na resposta: dinheiro sai como string numérica
    (`"1915.94"`) e quem formata é o `formatBRL` do front.
    """
    _tx(client, default_account, default_category["id"], "ENTRADA", "11495.67")

    assert "R$" not in str(_overview(client))
