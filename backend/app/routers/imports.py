"""Importação de fatura em PDF — `docs/importacao-fatura.md`.

Duas etapas (D-Import-1): `preview` lê e devolve as linhas, sem gravar;
`confirm` grava as escolhidas, tudo ou nada. O PDF fica só em memória
(D-Import-2).
"""

import datetime
from collections import Counter
from decimal import Decimal
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app import models, schemas
from app import installment_service
from app.invoice_import import (
    InvoiceUnreadable,
    detect_bank,
    installment_base_title,
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


def _existing_keys(db: Session, account_id: int, dates: Iterable[datetime.date]) -> Counter:
    """Quantas transações da conta existem por chave, no intervalo de datas da
    fatura. Pela sessão escopada: só o que é do dono (D-Import-6).

    **Contagem, não conjunto** (revisão de 12/11/2026): com um CAFE já lançado
    e dois na fatura, só um é a duplicada — o segundo é outra compra."""
    dates = list(dates)
    if not dates:
        return Counter()
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
    return Counter(_key(*row) for row in rows)


def _installment_match(db: Session, scheduled, entry) -> "schemas.InstallmentMatch | None":
    """D-Import-8: o parcelamento com cronograma, nesta conta, com o mesmo total
    de parcelas e o título normalizado contido no da linha (ou o contrário)."""
    if entry.installment_hint is None:
        return None
    number, total = entry.installment_hint
    line_title = normalize_title(installment_base_title(entry.title))
    if not line_title:
        return None
    for installment in scheduled:
        title = normalize_title(installment_base_title(installment.title))
        if installment.total_installments != total or not title:
            continue
        if title in line_title or line_title in title:
            parcel = db.query(models.Transaction.id).filter(
                models.Transaction.installment_id == installment.id,
                models.Transaction.installment_number == number,
            ).first()
            return schemas.InstallmentMatch(
                installment_id=installment.id,
                installment_title=installment.title,
                transaction_id=parcel.id if parcel else None,
            )
    return None


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


async def _read_pdf_body(request: Request) -> bytes:
    """O corpo, lido em pedaços até o teto de 4 MB (revisão de segurança,
    12/11/2026). `Content-Length` declarado acima do teto é recusado sem ler
    nada; sem o cabeçalho (chunked), a leitura para no primeiro byte a mais."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_PDF_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="O PDF passa de 4 MB.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_PDF_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="O PDF passa de 4 MB.")
    return bytes(body)


@router.post(
    "/invoice/preview",
    response_model=schemas.InvoicePreview,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def preview_invoice(
    request: Request,
    due_date: datetime.date = Query(..., description="Vencimento da fatura: dá o ano das linhas"),
    account_id: int = Query(..., description="Conta (cartão) onde as linhas serão lançadas"),
    db: Session = Depends(owned_db),
):
    """Lê a fatura e devolve as linhas reconhecidas, **sem gravar nada**.

    `async` só para ler o corpo com teto; o trabalho de banco e de PDF é
    síncrono e vai para o threadpool, como nas rotas `def`."""
    content_type = request.headers.get("content-type") or ""
    if content_type.split(";")[0].strip().lower() != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Envie a fatura em PDF (Content-Type: application/pdf).",
        )
    pdf = await _read_pdf_body(request)
    return await run_in_threadpool(_preview, pdf, due_date, account_id, db)


def _preview(pdf: bytes, due_date: datetime.date, account_id: int, db: Session) -> schemas.InvoicePreview:
    _account_or_404(db, account_id)

    try:
        text = extract_text(pdf)
    except InvoiceUnreadable as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    bank = detect_bank(text)
    entries = parse_invoice_text(text, due_date, bank=bank)
    existing = _existing_keys(db, account_id, (e.date for e in entries))
    suggestions = _category_by_title(db) if entries else {}
    scheduled = (
        db.query(models.Installment).filter(
            models.Installment.account_id == account_id,
            models.Installment.first_due_date.isnot(None),
        ).order_by(models.Installment.id).all()
        if any(e.installment_hint for e in entries) else []
    )

    items = []
    for entry in entries:
        key = _key(entry.date, entry.type, entry.amount, entry.title)
        duplicate = existing[key] > 0
        if duplicate:
            existing[key] -= 1
        match = _installment_match(db, scheduled, entry)
        if match is not None and match.transaction_id is not None:
            # A parcela já está no extrato (gerada pelo parcelamento).
            duplicate = True
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
            installment_match=match,
        ))

    return schemas.InvoicePreview(
        bank=bank,
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

    # D-Import-8: parcelamento a vincular, buscado pela sessão escopada e na
    # mesma conta — de outro dono ou de outra conta é 404, antes de gravar.
    linked_ids = {item.installment_id for item in payload.items if item.installment_id is not None}
    linked = {
        row.id: row for row in db.query(models.Installment).filter(
            models.Installment.id.in_(linked_ids),
            models.Installment.account_id == payload.account_id,
        ).all()
    } if linked_ids else {}
    if set(linked) != linked_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parcelamento não encontrado.")
    for item in payload.items:
        if item.installment_id is not None and item.installment_number > linked[item.installment_id].total_installments:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="O número da parcela passa do total do parcelamento.",
            )

    existing = _existing_keys(db, payload.account_id, (item.date for item in payload.items))
    owner = owner_id(db)
    created = skipped = 0
    for item in payload.items:
        key = _key(item.date, item.type, item.amount, item.title)
        # Cada transação existente "consome" uma linha igual da fatura; a
        # escolha explícita do usuário (`allow_duplicate`) vence a checagem.
        if existing[key] > 0 and not item.allow_duplicate:
            existing[key] -= 1
            skipped += 1
            continue
        if item.create_installment:
            # A parcela atual é esta linha: o cadastro a gera junto com as
            # futuras, sem uma avulsa a mais (D-Import-8).
            installment_service.create_with_parcels(
                db,
                owner,
                title=installment_base_title(item.title) or item.title,
                category_id=item.category_id,
                account_id=payload.account_id,
                total_installments=item.installment_total,
                current_installment=item.installment_current,
                current_due_date=item.date,
                installment_amount=item.amount,
            )
        else:
            db.add(models.Transaction(
                owner_id=owner,
                title=item.title,
                type=item.type,
                amount=item.amount,
                date=item.date,
                category_id=item.category_id,
                is_fixed=False,
                account_id=payload.account_id,
                installment_id=item.installment_id,
                installment_number=item.installment_number,
            ))
        created += 1

    db.commit()
    return schemas.InvoiceConfirmResult(created=created, skipped_duplicates=skipped)
