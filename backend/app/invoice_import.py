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
# `(?![/\d])` depois de DD/MM: "20/11/2026" (data com ano) não é lançamento.
#
# O sinal de crédito aparece de quatro jeitos nas faturas: antes do "R$"
# ("- R$ 50,00", "-R$ 50,00"), colado no número ("-50,00", "R$ -50,00") ou
# depois dele ("50,00-"); o menos pode ser o hífen ou o "−" Unicode. Um " - "
# **solto antes do número** ("UBER - 25,00") é separador da descrição, não
# sinal — lido como sinal, virava crédito (revisão de 12/11/2026).
_MINUS = "[-\u2212]"
_LINE = re.compile(
    r"^\s*(?:(?P<d1>\d{1,2})/(?P<m1>\d{1,2})(?![/\d])|(?P<d2>\d{1,2})\s+(?P<m2>[A-Za-z]{3})\b)"
    r"\s+(?P<title>.+?)\s+"
    rf"(?:(?P<s1>{_MINUS})\s*(?=R\$))?(?:R\$\s*)?(?:(?P<s2>{_MINUS})(?=\d))?"
    r"(?P<value>\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})"
    rf"(?P<s3>{_MINUS})?\s*$"
)
# Separador solto que sobra no fim da descrição ("UBER -").
_TRAILING_SEPARATOR = re.compile(r"\s*[-\u2212–—:]+\s*$")
# "PARC 03/10", "PARCELA 3/10" ou "3/10" no fim da descrição.
_INSTALLMENT = re.compile(r"(?:\bparc(?:ela)?\.?\s*)?\b(\d{1,2})\s*/\s*(\d{1,2})\s*$", re.IGNORECASE)
_PAYMENT = re.compile(r"\b(pagamento|pgto)\b", re.IGNORECASE)


# Limites de trabalho (revisão de segurança, 12/11/2026). Uma fatura de cartão
# tem poucas páginas e linhas curtas; o resto é PDF forjado ou quebrado.
MAX_PAGES = 50
MAX_TEXT_CHARS = 500_000
#: Linha de lançamento real cabe folgado. Sem o teto, a regex de `_LINE` fica
#: ~cúbica numa linha longa sem valor no fim (10 mil espaços não terminava).
MAX_LINE_CHARS = 300


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
        if len(reader.pages) > MAX_PAGES:
            raise InvoiceUnreadable(
                f"O PDF tem mais de {MAX_PAGES} páginas — não parece uma fatura."
            )
        parts: list[str] = []
        size = 0
        for page in reader.pages:
            chunk = page.extract_text() or ""
            size += len(chunk)
            if size > MAX_TEXT_CHARS:
                raise InvoiceUnreadable("O PDF tem texto demais para ser uma fatura.")
            parts.append(chunk)
        text = "\n".join(parts)
    except InvoiceUnreadable:
        raise
    except Exception as exc:  # noqa: BLE001 — PDF malformado quebra de mil jeitos no pypdf
        # (RecursionError, IndexError, zlib.error...): todos viram 422, nunca 500.
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
    for raw in text.splitlines():
        # Espaços colapsados antes da regex: o pypdf preenche posições de glyph
        # com espaços, e é corrida de espaço que faz a regex explodir.
        line = " ".join(raw.split())
        if not line or len(line) > MAX_LINE_CHARS:
            continue
        match = _LINE.match(line)
        if not match:
            continue

        title = _TRAILING_SEPARATOR.sub("", " ".join(match.group("title").split()))
        amount = _parse_amount(match.group("value"))
        if not title or amount <= 0:
            continue

        hint = None
        installment = _INSTALLMENT.search(title)
        if installment:
            current, total = int(installment.group(1)), int(installment.group(2))
            if 1 <= current <= total:
                hint = (current, total)

        if hint is not None:
            # D-Import-5: a parcela é cobrada nesta fatura. A data da compra
            # nem é validada — 29/02 num ano comum derrubava a linha.
            date = due_date
        else:
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

        entries.append(ParsedEntry(
            date=date,
            title=title,
            amount=amount,
            type="ENTRADA" if (match.group("s1") or match.group("s2") or match.group("s3")) else "SAÍDA",
            installment_hint=hint,
            is_payment=bool(_PAYMENT.search(title)),
        ))
    return entries
