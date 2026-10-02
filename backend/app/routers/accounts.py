from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app import models, schemas, account_balance

router = APIRouter(
    prefix="/accounts",
    tags=["Accounts"]
)


def _to_response(row) -> schemas.AccountResponse:
    """Monta a resposta com o saldo derivado do ledger.

    **Exceção declarada ao padrão de serialização direta do ORM.** O router
    normalmente retorna a entidade e deixa o Pydantic serializar; aqui
    `current_balance` não existe no model — vem de uma agregação —, mesmo caso
    de `spent`/`txs_count` em `categories.py`.
    """
    account, ledger = row
    return schemas.AccountResponse(
        id=account.id,
        name=account.name,
        initial_balance=account.initial_balance,
        current_balance=account.initial_balance + ledger,
    )


@router.post("", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(account: schemas.AccountCreate, db: Session = Depends(get_db)):
    # Evita duplicidade de contas com o mesmo nome
    db_account = db.query(models.Account).filter(models.Account.name == account.name).first()
    if db_account:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe uma conta cadastrada com este nome."
        )

    new_account = models.Account(
        name=account.name,
        initial_balance=account.initial_balance,
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)

    # Conta recém-criada não tem transação, então o saldo é o inicial — mas a
    # resposta passa pela mesma agregação da listagem de propósito. Repetir a
    # fórmula aqui é como os dois endpoints começariam a divergir.
    return _to_response(
        account_balance.accounts_with_balance(db, account_id=new_account.id)[0]
    )


@router.get("", response_model=List[schemas.AccountResponse])
def list_accounts(db: Session = Depends(get_db)):
    """Contas com o saldo calculado na leitura.

    Custo: `LEFT JOIN` + `GROUP BY` em vez de um `SELECT` de coluna. A agregação
    cresce com o total histórico de transações, não com o número de contas —
    irrelevante na ordem de grandeza de finanças pessoais, e o índice de
    `account_id` que a FK já cria cobre o join.
    """
    return [_to_response(row) for row in account_balance.accounts_with_balance(db)]
