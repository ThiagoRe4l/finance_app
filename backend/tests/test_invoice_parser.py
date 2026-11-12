"""Parser genérico de fatura — `docs/importacao-fatura.md` → D-Import-3 e D-Import-5.

Escrito **antes** da implementação (11/11/2026); aprovação delegada pelo
usuário nesta data. Função pura: texto + vencimento → lançamentos. Nenhuma
data aqui depende do dia em que a suíte roda.
"""

import datetime
from decimal import Decimal

import pytest

from app.invoice_import import normalize_title, parse_invoice_text

DUE = datetime.date(2026, 11, 20)


def one(line, due=DUE):
    items = parse_invoice_text(line, due)
    assert len(items) == 1, items
    return items[0]


def test_date_slash_description_and_amount():
    item = one("10/11 PADARIA SÃO JOÃO 12,50")
    assert item.date == datetime.date(2026, 11, 10)
    assert item.title == "PADARIA SÃO JOÃO"
    assert item.amount == Decimal("12.50")
    assert item.type == "SAÍDA"
    assert item.installment_hint is None
    assert item.is_payment is False


def test_day_and_month_abbreviation_with_currency_symbol():
    item = one("05 OUT Uber *Trip R$ 23,90")
    assert item.date == datetime.date(2026, 10, 5)
    assert item.title == "Uber *Trip"
    assert item.amount == Decimal("23.90")


@pytest.mark.parametrize("month", ["out", "Out", "OUT"])
def test_month_abbreviation_is_case_insensitive(month):
    assert one(f"05 {month} Loja 1,00").date == datetime.date(2026, 10, 5)


def test_year_comes_from_the_due_date_and_rolls_back_in_january():
    item = one("28/12 LOJA 10,00", due=datetime.date(2027, 1, 10))
    assert item.date == datetime.date(2026, 12, 28)


def test_thousands_separator():
    assert one("01/11 NOTEBOOK 4.599,00").amount == Decimal("4599.00")


@pytest.mark.parametrize("line", ["03/11 ESTORNO LOJA -15,00", "03/11 ESTORNO LOJA - R$ 15,00"])
def test_negative_amount_is_a_credit(line):
    item = one(line)
    assert item.type == "ENTRADA"
    assert item.amount == Decimal("15.00")


@pytest.mark.parametrize(
    "line",
    ["05/11 PAGAMENTO RECEBIDO -1.234,56", "05/11 Pgto fatura anterior 800,00"],
)
def test_invoice_payment_is_flagged(line):
    assert one(line).is_payment is True


@pytest.mark.parametrize(
    "line,hint",
    [
        ("15/03 MAGAZINE LUIZA PARC 03/10 150,00", (3, 10)),
        ("10/09 NETSHOES 2/4 89,90", (2, 4)),
    ],
)
def test_installment_line_gets_a_hint_and_the_due_date(line, hint):
    item = one(line)
    assert item.installment_hint == hint
    # D-Import-5: a parcela é cobrada nesta fatura, não no mês da compra.
    assert item.date == DUE


def test_lines_that_are_not_entries_are_ignored():
    text = "\n".join([
        "Fatura de novembro",
        "Vencimento 20/11/2026",
        "Total da fatura R$ 1.000,00",
        "20/11/2026 COM ANO NAO CASA 10,00",
        "31/02 DATA IMPOSSIVEL 10,00",
        "10/11 SEM VALOR",
        "",
        "10/11 PADARIA 12,50",
    ])
    items = parse_invoice_text(text, DUE)
    assert [i.title for i in items] == ["PADARIA"]


def test_order_is_preserved():
    text = "10/11 A 1,00\n09/11 B 2,00\n11/11 C 3,00"
    assert [i.title for i in parse_invoice_text(text, DUE)] == ["A", "B", "C"]


def test_normalize_title():
    assert normalize_title("  Padaria   São  João ") == "padaria sao joao"
    assert normalize_title("UBER *TRIP") == normalize_title("uber *trip")
