from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List

from app.database import get_db
from app import models, schemas

router = APIRouter(
    prefix="/transactions",
    tags=["Transactions"]
)

@router.post("/", response_model=schemas.TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(transaction: schemas.TransactionCreate, db: Session = Depends(get_db)):
    # 1. Busca a conta correspondente
    account = db.query(models.Account).filter(models.Account.id == transaction.account_id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conta não encontrada."
        )

    # 2. Valida a categoria
    category = db.query(models.Category).filter(
        models.Category.id == transaction.category_id
    ).first()
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria não encontrada."
        )

    # 3. Valida o parcelamento de origem, quando informado
    if transaction.installment_id is not None:
        installment = db.query(models.Installment).filter(
            models.Installment.id == transaction.installment_id
        ).first()
        if not installment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parcelamento não encontrado."
            )

    # 4. Verifica o tipo da transação e atualiza o saldo
    # Todas as FKs já foram validadas acima — mutar saldo antes disso deixaria
    # `current_balance` corrompido quando um ID inválido derrubasse a requisição.
    if transaction.type == "SAÍDA":
        account.current_balance -= transaction.amount
    elif transaction.type == "ENTRADA":
        account.current_balance += transaction.amount
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de transação inválido. Deve ser 'ENTRADA' ou 'SAÍDA'."
        )

    # 5. Instancia a transação
    db_transaction = models.Transaction(
        title=transaction.title,
        type=transaction.type,
        amount=transaction.amount,
        date=transaction.date,
        category_id=transaction.category_id,
        is_fixed=transaction.is_fixed,
        account_id=transaction.account_id,
        installment_id=transaction.installment_id
    )

    # 6. Salva no banco de dados
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)

    return db_transaction

@router.get("/", response_model=List[schemas.TransactionResponse])
def list_transactions(db: Session = Depends(get_db)):
    return db.query(models.Transaction).options(
        joinedload(models.Transaction.installment),
        joinedload(models.Transaction.category)
    ).order_by(models.Transaction.date.desc(), models.Transaction.id.desc()).all()


def _apply_to_balance(account: models.Account, tx_type: str, amount: float, sign: int):
    """Aplica (`sign=1`) ou estorna (`sign=-1`) o efeito de uma transação.

    Centralizar isso é o que garante que estorno e reaplicação sejam exatamente
    simétricos. Duplicar os dois sinais à mão é como o saldo passa a derrapar:
    basta um dos lados esquecer o caso ENTRADA.
    """
    delta = amount if tx_type == "ENTRADA" else -amount
    account.current_balance += sign * delta


@router.patch("/{transaction_id}", response_model=schemas.TransactionResponse)
def update_transaction(
    transaction_id: int,
    payload: schemas.TransactionUpdate,
    db: Session = Depends(get_db)
):
    """Edição parcial. Estorna o efeito antigo no saldo e aplica o novo.

    A ordem aqui não é estética: **toda** validação acontece antes de encostar
    em `current_balance`, mesma regra do `create_transaction`. Um 400 ou 404
    depois do estorno deixaria o saldo corrompido sem nenhum registro de que
    algo mudou.
    """
    transaction = db.query(models.Transaction).filter(
        models.Transaction.id == transaction_id
    ).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transação não encontrada."
        )

    # `exclude_unset` separa "não enviado" de "enviado como null" — é o que
    # torna `installment_id: null` um desvínculo explícito em vez de ruído.
    data = payload.model_dump(exclude_unset=True)

    # --- 1. Validações. Nada de saldo antes daqui. ---
    if "category_id" in data:
        category = db.query(models.Category).filter(
            models.Category.id == data["category_id"]
        ).first()
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Categoria não encontrada."
            )

    # Decisão B6: o vínculo com parcelamento só pode ser desfeito, nunca criado
    # ou movido depois da criação.
    if "installment_id" in data and data["installment_id"] is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "O vínculo com um parcelamento só pode ser removido (installment_id: null). "
                "Para vincular a outro parcelamento, exclua a transação e crie novamente."
            )
        )

    new_type = data.get("type", transaction.type)
    if new_type not in ("ENTRADA", "SAÍDA"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de transação inválido. Deve ser 'ENTRADA' ou 'SAÍDA'."
        )

    # Decisão B8: a regra exclusiva vale sobre o estado **mesclado** (payload +
    # linha do banco), não sobre o payload isolado — por isso vive aqui e não no
    # schema, e por isso é 400 e não o 422 do POST.
    merged_installment_id = (
        data["installment_id"] if "installment_id" in data else transaction.installment_id
    )
    merged_is_fixed = data.get("is_fixed", transaction.is_fixed)
    if merged_installment_id is not None and merged_is_fixed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uma transação não pode ser fixa e parcelada ao mesmo tempo."
        )

    # --- 2. Saldo: estorna o efeito antigo, aplica os campos, refaz o efeito ---
    account = transaction.account
    _apply_to_balance(account, transaction.type, transaction.amount, sign=-1)

    for field, value in data.items():
        setattr(transaction, field, value)

    _apply_to_balance(account, transaction.type, transaction.amount, sign=1)

    db.commit()
    db.refresh(transaction)

    return transaction


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    """Exclui a transação e estorna seu efeito no saldo da conta."""
    transaction = db.query(models.Transaction).filter(
        models.Transaction.id == transaction_id
    ).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transação não encontrada."
        )

    _apply_to_balance(
        transaction.account, transaction.type, transaction.amount, sign=-1
    )

    db.delete(transaction)
    db.commit()
