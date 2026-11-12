"""Leitores por banco — `docs/importacao-fatura.md` → D-Import-7.

Escrito **antes** da implementação (12/11/2026). ⚠️ As linhas imitam o formato
**público** de cada banco; nenhuma veio de fatura real. Ajuste em produção =
um teste novo aqui com a linha que falhou, anonimizada.
"""

import datetime
from decimal import Decimal

import pytest

from app.invoice_import import detect_bank, parse_invoice_text

DUE = datetime.date(2026, 11, 20)


@pytest.mark.parametrize(
    "text,bank",
    [
        ("Olá, Fulano\nNu Pagamentos S.A.\nFATURA", "nubank"),
        ("nubank - resumo da fatura", "nubank"),
        ("Itaú Unibanco\nCartão Itaucard Platinum", "itau"),
        ("ITAU UNIBANCO HOLDING", "itau"),
        ("Mercado Pago\nResumo da sua fatura", "mercado_pago"),
        ("Fatura do cartão", "generic"),
    ],
)
def test_bank_is_detected_from_the_text(text, bank):
    assert detect_bank(text) == bank


def test_installment_written_as_parcela_x_de_y():
    items = parse_invoice_text("05/11 LOJA X Parcela 3 de 10 120,00", DUE)
    assert items[0].installment_hint == (3, 10)


# --- Itaú: duas colunas na mesma linha --------------------------------------


def test_itau_splits_two_entries_joined_by_the_two_column_layout():
    items = parse_invoice_text("10/11 PADARIA 12,50 11/11 POSTO SHELL 100,00", DUE, bank="itau")
    assert [(i.title, i.amount) for i in items] == [
        ("PADARIA", Decimal("12.50")),
        ("POSTO SHELL", Decimal("100.00")),
    ]


def test_itau_keeps_the_line_whole_when_a_piece_is_not_an_entry():
    """O "11/11" do meio não começa um lançamento completo: não corta."""
    items = parse_invoice_text("10/11 LOJA 11/11 FILIAL 12,50", DUE, bank="itau")
    assert [i.title for i in items] == ["LOJA 11/11 FILIAL"]


def test_itau_installment_in_the_right_column():
    items = parse_invoice_text("10/11 PADARIA 12,50 15/03 MAGAZINE LUIZA 03/10 150,00", DUE, bank="itau")
    assert items[1].installment_hint == (3, 10)
    assert items[1].date == DUE


# --- Mercado Pago: data com ano ----------------------------------------------


def test_mercado_pago_accepts_the_full_date_and_uses_its_year():
    items = parse_invoice_text("28/12/2025 Mercado Livre 89,90", DUE, bank="mercado_pago")
    assert items[0].date == datetime.date(2025, 12, 28)
    assert items[0].title == "Mercado Livre"


def test_generic_still_ignores_a_line_that_starts_with_a_full_date():
    assert parse_invoice_text("20/11/2026 Vencimento 1.000,00", DUE) == []


# --- Nubank ------------------------------------------------------------------


def test_nubank_sample_block():
    text = "\n".join([
        "Nu Pagamentos S.A.",
        "TRANSAÇÕES DE 10 OUT A 09 NOV",
        "12 OUT Ifood *Restaurante R$ 54,90",
        "15 OUT Magazine Luiza - Parcela 2/6 R$ 199,90",
        "20 OUT Estorno Ifood −R$ 54,90",
        "05 NOV Pagamento recebido −R$ 1.200,00",
    ])
    items = parse_invoice_text(text, DUE, bank=detect_bank(text))
    assert [(i.title, i.type) for i in items] == [
        ("Ifood *Restaurante", "SAÍDA"),
        ("Magazine Luiza - Parcela 2/6", "SAÍDA"),
        ("Estorno Ifood", "ENTRADA"),
        ("Pagamento recebido", "ENTRADA"),
    ]
    assert items[1].installment_hint == (2, 6)
    assert items[3].is_payment is True


# --- Revisão de 12/11/2026 (escritos antes da correção) ----------------------


def test_bank_comes_from_the_header_not_from_a_merchant_line():
    header = ["Itaú Unibanco", "Cartão Itaucard", "Fatura de novembro"] + [f"linha {i}" for i in range(30)]
    assert detect_bank("\n".join(header + ["12/11 MERCADO PAGO*LOJA 10,00"])) == "itau"


def test_other_issuers_that_mention_itau_in_a_merchant_stay_generic():
    text = "Banco Santander\nFatura\n" + "\n".join(f"linha {i}" for i in range(30)) + "\n05/11 ITAU SEGUROS 80,00"
    assert detect_bank(text) == "generic"
    assert detect_bank("Fatura do cartão\n05/11 ITAUNA POSTO 80,00") == "generic"


def test_de_form_needs_the_word_parcela():
    assert parse_invoice_text("05/11 TERMINAL 1 de 2 45,00", DUE)[0].installment_hint is None
    assert parse_invoice_text("05/11 VOO 2 de 3 450,00", DUE)[0].installment_hint is None
    assert parse_invoice_text("05/11 LOJA Parcela 2 de 3 45,00", DUE)[0].installment_hint == (2, 3)
    assert parse_invoice_text("05/11 LOJA PARC 02/03 45,00", DUE)[0].installment_hint == (2, 3)
    assert parse_invoice_text("05/11 LOJA 2/3 45,00", DUE)[0].installment_hint == (2, 3)
