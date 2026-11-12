"""Leitura de fatura em PDF — funções puras, sem banco.

Decisões em `docs/importacao-fatura.md` (D-Import-2, -3 e -5). O parser é
**genérico** (v1): reconhece a linha `DATA DESCRIÇÃO VALOR` comum às faturas de
cartão brasileiras. Parser por banco espera uma fatura de exemplo.

O PDF e o texto extraído vivem só em memória: nada aqui grava ou registra o
conteúdo (D-Import-2).
"""

import datetime
import io
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import List, Optional, Tuple

MONTHS = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}

# DATA (DD/MM ou DD MMM) + espaço + DESCRIÇÃO + espaço + VALOR no fim da linha.
# `(?!\d)` depois de DD/MM: "20/11/2026" (data com ano) não é lançamento.
_LINE = re.compile(
    r"^\s*(?:(?P<d1>\d{1,2})/(?P<m1>\d{1,2})(?![/\d])|(?P<d2>\d{1,2})\s+(?P<m2>[A-Za-z]{3})\b)"
    r"\s+(?P<title>.+?)\s+"
    r"(?P<sign>-\s*)?(?:R\$\s*)?(?P<value>\d{1,3}(?:\.\d{3})*,\d{2})\s*$"
)
# "PARC 03/10", "PARCELA 3/10" ou "3/10" no fim da descrição.
_INSTALLMENT = re.compile(r"(?:\bparc(?:ela)?\.?\s*)?\b(\d{1,2})\s*/\s*(\d{1,2})\s*$", re.IGNORECASE)
_PAYMENT = re.compile(r"\b(pagamento|pgto)\b", re.IGNORECASE)


class InvoiceUnreadable(ValueError):
    """O PDF não pôde ser lido, ou não tem texto (fatura escaneada)."""


@dataclass(frozen=True)
class ParsedEntry:
    date: datetime.date
    title: str
    amount: Decimal
    type: str  # "SAÍDA" ou "ENTRADA"
    installment_hint: Optional[Tuple[int, int]]
    is_payment: bool


def normalize_title(title: str) -> str:
    """Descrição para comparar: sem acento, minúscula, espaços colapsados
    (D-Import-4). "Padaria  São João" e "PADARIA SAO JOAO" são a mesma."""
    decomposed = unicodedata.normalize("NFKD", title)
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(ascii_only.casefold().split())


def extract_text(pdf: bytes) -> str:
    """Texto de todas as páginas. Levanta `InvoiceUnreadable` se não der."""
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(pdf))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except (PyPdfError, ValueError, KeyError, TypeError) as exc:
        raise InvoiceUnreadable(
            "Não foi possível ler o PDF. Confira se o arquivo é a fatura em PDF."
        ) from exc

    if not text.strip():
        raise InvoiceUnreadable(
            "O PDF não tem texto para ler — pode ser uma fatura escaneada, que não é suportada."
        )
    return text


def _year_for(month: int, due: datetime.date) -> int:
    """Mês depois do vencimento é do ano anterior (fatura de janeiro com
    compra de dezembro)."""
    return due.year - 1 if month > due.month else due.year


def _parse_amount(raw: str) -> Decimal:
    return Decimal(raw.replace(".", "").replace(",", "."))


def parse_invoice_text(text: str, due_date: datetime.date) -> List[ParsedEntry]:
    """Lançamentos reconhecidos, na ordem da fatura. Linha que não casa é
    ignorada — inclusive data impossível (31/02)."""
    entries: List[ParsedEntry] = []
    for line in text.splitlines():
        match = _LINE.match(line)
        if not match:
            continue

        if match.group("d1"):
            day, month = int(match.group("d1")), int(match.group("m1"))
        else:
            day = int(match.group("d2"))
            month = MONTHS.get(match.group("m2").casefold(), 0)
        if not 1 <= month <= 12:
            continue
        try:
            date = datetime.date(_year_for(month, due_date), month, day)
        except ValueError:
            continue

        title = " ".join(match.group("title").split())
        amount = _parse_amount(match.group("value"))
        if amount <= 0:
            continue

        hint = None
        installment = _INSTALLMENT.search(title)
        if installment:
            current, total = int(installment.group(1)), int(installment.group(2))
            if 1 <= current <= total:
                hint = (current, total)
                # D-Import-5: a parcela é cobrada nesta fatura.
                date = due_date

        entries.append(ParsedEntry(
            date=date,
            title=title,
            amount=amount,
            type="ENTRADA" if match.group("sign") else "SAÍDA",
            installment_hint=hint,
            is_payment=bool(_PAYMENT.search(title)),
        ))
    return entries
