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
from itertools import combinations
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
    r"^\s*(?:(?P<d1>\d{1,2})/(?P<m1>\d{1,2})(?:/(?P<y1>\d{4}))?(?![/\d])|(?P<d2>\d{1,2})\s+(?P<m2>[A-Za-z]{3})\b)"
    r"\s+(?P<title>.+?)\s+"
    rf"(?:(?P<s1>{_MINUS})\s*(?=R\$))?(?:R\$\s*)?(?:(?P<s2>{_MINUS})(?=\d))?"
    r"(?P<value>\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})"
    rf"(?P<s3>{_MINUS})?\s*$"
)
# Separador solto que sobra no fim da descrição ("UBER -").
_TRAILING_SEPARATOR = re.compile(r"\s*[-\u2212–—:]+\s*$")
# "PARC 03/10", "PARCELA 3/10" ou "3/10" no fim da descrição.
# "PARC 03/10", "Parcela 3/10", "3/10" ou "Parcela 3 de 10" no fim da descrição.
_INSTALLMENT = re.compile(
    r"(?:\bparc(?:ela)?\.?\s*)?\b(\d{1,2})(?:\s*/\s*|\s+de\s+)(\d{1,2})\s*$", re.IGNORECASE
)
# Onde uma segunda coluna do Itaú pode começar: " DD/MM " no meio da linha.
_COLUMN_START = re.compile(r"(?<=\s)\d{2}/\d{2}(?=\s)")

BANKS = ("itau", "nubank", "mercado_pago")


def detect_bank(text: str) -> str:
    """D-Import-7: o banco pelo texto da fatura. `generic` se nenhum."""
    plain = normalize_title(text)
    if "nubank" in plain or "nu pagamentos" in plain:
        return "nubank"
    if "mercado pago" in plain:
        return "mercado_pago"
    if "itau" in plain:  # "itaú", "itau unibanco", "itaucard"
        return "itau"
    return "generic"


def installment_base_title(title: str) -> str:
    """O título sem o sufixo da parcela ("MAGAZINE LUIZA PARC 03/10" →
    "MAGAZINE LUIZA"), para casar a linha com o parcelamento (D-Import-8)."""
    base = _INSTALLMENT.sub("", title)
    return _TRAILING_SEPARATOR.sub("", base).strip()
_PAYMENT = re.compile(r"\b(pagamento|pgto)\b", re.IGNORECASE)


# Limites de trabalho (revisão de segurança, 12/11/2026). Uma fatura de cartão
# tem poucas páginas e linhas curtas; o resto é PDF forjado ou quebrado.
MAX_PAGES = 50
MAX_TEXT_CHARS = 500_000
#: Linha de lançamento real cabe folgado. Sem o teto, a regex de `_LINE` fica
#: ~cúbica numa linha longa sem valor no fim (10 mil espaços não terminava).
MAX_LINE_CHARS = 300
#: Cortes de coluna testados por linha (2^n combinações). Linha real tem 1 ou 2.
MAX_COLUMN_CUTS = 6


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


def _parse_line(line: str, due_date: datetime.date, bank: str) -> Optional[ParsedEntry]:
    """Um lançamento, ou `None` se a linha não é lançamento."""
    match = _LINE.match(line)
    if not match:
        return None
    # Data com ano: só o Mercado Pago a usa em lançamento (D-Import-7). Nos
    # outros costuma ser cabeçalho ("Vencimento 20/11/2026").
    if match.group("y1") and bank != "mercado_pago":
        return None

    title = _TRAILING_SEPARATOR.sub("", " ".join(match.group("title").split()))
    amount = _parse_amount(match.group("value"))
    if not title or amount <= 0:
        return None

    hint = None
    installment = _INSTALLMENT.search(title)
    if installment:
        current, total = int(installment.group(1)), int(installment.group(2))
        if 1 <= current <= total:
            hint = (current, total)

    if hint is not None:
        # D-Import-5: a parcela é cobrada nesta fatura. A data da compra nem é
        # validada — 29/02 num ano comum derrubava a linha.
        date = due_date
    else:
        if match.group("d1"):
            day, month = int(match.group("d1")), int(match.group("m1"))
        else:
            day = int(match.group("d2"))
            month = MONTHS.get(match.group("m2").casefold(), 0)
        if not 1 <= month <= 12:
            return None
        year = int(match.group("y1")) if match.group("y1") else _year_for(month, due_date)
        try:
            date = datetime.date(year, month, day)
        except ValueError:
            return None

    return ParsedEntry(
        date=date,
        title=title,
        amount=amount,
        type="ENTRADA" if (match.group("s1") or match.group("s2") or match.group("s3")) else "SAÍDA",
        installment_hint=hint,
        is_payment=bool(_PAYMENT.search(title)),
    )


def _split_columns(line: str, due_date: datetime.date, bank: str) -> Optional[List[ParsedEntry]]:
    """Itaú (D-Import-7): dois lançamentos na mesma linha, um de cada coluna.
    Corta antes de cada " DD/MM " **só se todo pedaço for um lançamento**."""
    cuts = [m.start() for m in _COLUMN_START.finditer(line)]
    if not cuts or len(cuts) > MAX_COLUMN_CUTS:
        return None
    # Nem todo " DD/MM " começa coluna: "MAGAZINE LUIZA 03/10" é a parcela. Vale
    # a combinação de cortes com mais pedaços em que todos são lançamentos.
    best: Optional[List[ParsedEntry]] = None
    for size in range(len(cuts), 0, -1):
        for chosen in combinations(cuts, size):
            bounds = [0, *chosen, len(line)]
            parsed = [_parse_line(line[a:b].strip(), due_date, bank) for a, b in zip(bounds, bounds[1:])]
            if all(entry is not None for entry in parsed):
                best = parsed  # type: ignore[assignment]
                break
        if best is not None:
            break
    return best


def parse_invoice_text(
    text: str, due_date: datetime.date, bank: str = "generic"
) -> List[ParsedEntry]:
    """Lançamentos reconhecidos, na ordem da fatura. Linha que não casa é
    ignorada — inclusive data impossível (31/02). `bank` liga as regras da
    D-Import-7 (`detect_bank`)."""
    entries: List[ParsedEntry] = []
    for raw in text.splitlines():
        # Espaços colapsados antes da regex: o pypdf preenche posições de glyph
        # com espaços, e é corrida de espaço que faz a regex explodir.
        line = " ".join(raw.split())
        if not line or len(line) > MAX_LINE_CHARS:
            continue
        if bank == "itau":
            columns = _split_columns(line, due_date, bank)
            if columns is not None:
                entries.extend(columns)
                continue
        entry = _parse_line(line, due_date, bank)
        if entry is not None:
            entries.append(entry)
    return entries
