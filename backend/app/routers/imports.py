"""Importação de fatura em PDF — `docs/importacao-fatura.md`.

Duas etapas (D-Import-1): `preview` lê e devolve as linhas, sem gravar;
`confirm` grava as escolhidas, tudo ou nada. O PDF fica só em memória
(D-Import-2).
"""

import datetime
from decimal import Decimal
from typing import Iterable, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.invoice_import import (
    InvoiceUnreadable,
    extract_text,
    normalize_title,
    parse_invoice_text,
)
from app.tenancy import owned_db, owner_id

router = APIRouter(prefix="/imports", tags=["Imports"])

#: Abaixo do limite de corpo da função serverless da Vercel (4,5 MB).
MAX_PDF_BYTES = 4 * 1024 * 1024

DedupKey = tuple[datetime.date, str, Decimal, str]


def _key(date: datetime.date, tx_type: str, amount: Decimal, title: str) -> DedupKey:
    """D-Import-4: mesma data, tipo, valor e descrição normalizada."""
    return (date, tx_type, Decimal(amount).quantize(Decimal("0.01")), normalize_title(title))


def _account_or_404(db: Session, account_id: int) -> models.Account:
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conta não encontrada.")
    return account


def _existing_keys(db: Session, account_id: int, dates: Iterable[datetime.date]) -> set[DedupKey]:
    """Chaves das transações da conta no intervalo de datas da fatura. Pela
    sessão escopada: só o que é do dono (D-Import-6)."""
    dates = list(dates)
    if not dates:
        return set()
    rows = db.query(
        models.Transaction.date,
        models.Transaction.type,
        models.Transaction.amount,
        models.Transaction.title,
    ).filter(
        models.Transaction.account_id == account_id,
        models.Transaction.date >= min(dates),
        models.Transaction.date <= max(dates),
    ).all()
    return {_key(*row) for row in rows}


def _category_by_title(db: Session) -> dict[str, int]:
    """Descrição normalizada → categoria da transação **mais recente** com ela
    (D-Import-5). Só colunas, só do dono."""
    rows = db.query(models.Transaction.title, models.Transaction.category_id).order_by(
        models.Transaction.date.desc(), models.Transaction.id.desc()
    ).all()
    suggestions: dict[str, int] = {}
    for title, category_id in rows:
        suggestions.setdefault(normalize_title(title), category_id)
    return suggestions


@router.post("/invoice/preview", response_model=schemas.InvoicePreview)
def preview_invoice(
    due_date: datetime.date = Query(..., description="Vencimento da fatura: dá o ano das linhas"),
    account_id: int = Query(..., description="Conta (cartão) onde as linhas serão lançadas"),
    pdf: bytes = Body(..., media_type="application/pdf"),
    content_type: Optional[str] = Header(None),
    db: Session = Depends(owned_db),
):
    """Lê a fatura e devolve as linhas reconhecidas, **sem gravar nada**."""
    if (content_type or "").split(";")[0].strip().lower() != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Envie a fatura em PDF (Content-Type: application/pdf).",
        )
    if len(pdf) > MAX_PDF_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="O PDF passa de 4 MB.",
        )

    _account_or_404(db, account_id)

    try:
        text = extract_text(pdf)
    except InvoiceUnreadable as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    entries = parse_invoice_text(text, due_date)
    existing = _existing_keys(db, account_id, (e.date for e in entries))
    suggestions = _category_by_title(db) if entries else {}

    items = []
    for entry in entries:
        duplicate = _key(entry.date, entry.type, entry.amount, entry.title) in existing
        items.append(schemas.InvoicePreviewItem(
            date=entry.date,
            title=entry.title,
            amount=entry.amount,
            type=entry.type,
            installment_hint=(
                schemas.InstallmentHint(current=entry.installment_hint[0], total=entry.installment_hint[1])
                if entry.installment_hint else None
            ),
            is_payment=entry.is_payment,
            duplicate=duplicate,
            selected=not (duplicate or entry.is_payment),
            suggested_category_id=suggestions.get(normalize_title(entry.title)),
        ))

    return schemas.InvoicePreview(
        lines_read=len([line for line in text.splitlines() if line.strip()]),
        items=items,
    )


@router.post(
    "/invoice/confirm",
    response_model=schemas.InvoiceConfirmResult,
    status_code=status.HTTP_201_CREATED,
)
def confirm_invoice(payload: schemas.InvoiceConfirm, db: Session = Depends(owned_db)):
    """Grava as linhas escolhidas, numa transação de banco só. Confere a
    duplicidade de novo no servidor e pula a repetida (D-Import-4)."""
    _account_or_404(db, payload.account_id)

    category_ids = {item.category_id for item in payload.items}
    found = {
        row.id for row in db.query(models.Category.id).filter(models.Category.id.in_(category_ids)).all()
    }
    if found != category_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoria não encontrada.")

    existing = _existing_keys(db, payload.account_id, (item.date for item in payload.items))
    owner = owner_id(db)
    created = skipped = 0
    for item in payload.items:
        key = _key(item.date, item.type, item.amount, item.title)
        if key in existing:
            skipped += 1
            continue
        db.add(models.Transaction(
            owner_id=owner,
            title=item.title,
            type=item.type,
            amount=item.amount,
            date=item.date,
            category_id=item.category_id,
            is_fixed=False,
            account_id=payload.account_id,
        ))
        created += 1

    db.commit()
    return schemas.InvoiceConfirmResult(created=created, skipped_duplicates=skipped)
