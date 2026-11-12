"""Cadastro de parcelamento com as parcelas geradas — uma função só.

Usada pelo `POST /installments` e pela importação de fatura que cria o
parcelamento a partir de uma linha (D-Import-8): cronograma, âncora e parcelas
iguais nos dois caminhos. Não valida conta nem categoria (quem chama já buscou
pela sessão escopada) e não faz commit: o chamador decide a transação de banco.
"""

import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.installment_schedule import build_schedule


def create_with_parcels(
    db: Session,
    owner_id: int,
    *,
    title: str,
    category_id: int,
    account_id: int,
    total_installments: int,
    current_installment: int,
    current_due_date: datetime.date,
    total_amount: Optional[Decimal] = None,
    installment_amount: Optional[Decimal] = None,
) -> models.Installment:
    """Grava o parcelamento e uma SAÍDA por parcela de `current` a `total`
    (P-1, P-2), ancorado em `current_due_date` (S-3)."""
    schedule = build_schedule(
        total_installments=total_installments,
        current_installment=current_installment,
        current_due_date=current_due_date,
        total_amount=total_amount,
        installment_amount=installment_amount,
    )
    installment = models.Installment(
        owner_id=owner_id,
        title=title,
        category_id=category_id,
        total_amount=schedule.total_amount,
        installment_amount=schedule.installment_amount,
        current_installment=current_installment,
        total_installments=total_installments,
        end_date=schedule.end_date,
        first_due_date=schedule.first_due_date,
        anchor_due_date=current_due_date,
        account_id=account_id,
    )
    db.add(installment)
    # `flush` para ter o id antes de gerar as parcelas; o commit é do chamador.
    db.flush()

    for parcel in schedule.parcels:
        db.add(models.Transaction(
            owner_id=owner_id,
            title=title,
            type="SAÍDA",
            amount=parcel.amount,
            date=parcel.date,
            category_id=category_id,
            is_fixed=False,
            account_id=account_id,
            installment_id=installment.id,
            installment_number=parcel.number,
        ))
    return installment
