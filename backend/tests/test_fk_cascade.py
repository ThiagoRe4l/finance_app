"""Comportamento de `ondelete` que passou a valer com o PRAGMA ligado.

`ON DELETE CASCADE` em `Transaction.account_id`/`Installment.account_id` e
`ON DELETE SET NULL` em `Transaction.installment_id` estão declarados nos models
desde o início, mas nunca foram exercitados: enquanto o SQLite abria conexão com
`foreign_keys = 0`, eram decoração. Ligar o PRAGMA (07/08/2026) fez o schema
passar a valer de fato — e um comportamento que nunca teve teste é um
comportamento que ninguém confirmou.

**Não há endpoint de DELETE em nenhum router.** A garantia aqui é de banco e é
prospectiva, no mesmo espírito de `test_category_in_use_cannot_be_deleted`:
quando o endpoint existir, ele não vai poder furar isso.

Por que boa parte dos deletes é em SQL cru
------------------------------------------
`Account.transactions` tem `cascade="all, delete-orphan"` no ORM. Num
`session.delete(account)`, o SQLAlchemy carrega as transações e as apaga ele
mesmo, uma a uma — o banco nem chega a ser consultado sobre a FK. Um teste
escrito por esse caminho ficaria verde com o PRAGMA desligado, testando o ORM e
não o schema. `DELETE FROM accounts` direto tira o ORM do circuito e deixa só o
banco respondendo, que é o que estes testes existem para verificar.

Os dois casos em que o caminho do ORM é usado (`..._via_orm`) são justamente
aqueles em que o ORM *não* tem regra própria: não existe `Account.installments`
nem `Installment.transactions`, então lá o ORM emite um DELETE simples e o
resultado é 100% do banco.
"""

import datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import models
from tests.conftest import (
    create_account,
    create_category,
    create_transaction,
    installment_payload,
)


def _raw_delete(session, table, row_id):
    """DELETE direto, sem passar pela unit of work do ORM."""
    session.execute(text(f"DELETE FROM {table} WHERE id = :id"), {"id": row_id})
    session.commit()


def _link_transaction_to_installment(client, account_id, category_id, installment_id,
                                     amount=500.0, title="Parcela do notebook"):
    response = client.post("/api/transactions", json={
        "title": title,
        "type": "SAÍDA",
        "amount": amount,
        "date": "2026-08-07",
        "category_id": category_id,
        "account_id": account_id,
        "installment_id": installment_id,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ---------------------------------------------------------------------------
# ON DELETE CASCADE — accounts → transactions
# ---------------------------------------------------------------------------

def test_deleting_account_cascades_to_its_transactions(fk_session, fk_client):
    """Apagar a conta apaga as transações dela, sem passo extra no código."""
    account_id = create_account(fk_client)
    category = create_category(fk_client)
    create_transaction(fk_client, account_id, category["id"], "SAÍDA", 100.0)
    create_transaction(fk_client, account_id, category["id"], "ENTRADA", 900.0)

    assert fk_session.query(models.Transaction).count() == 2

    _raw_delete(fk_session, "accounts", account_id)

    assert fk_session.query(models.Account).filter_by(id=account_id).first() is None
    assert fk_session.query(models.Transaction).count() == 0


def test_cascade_is_scoped_to_the_deleted_account(fk_session, fk_client):
    """O CASCADE não pode levar junto transação de outra conta.

    Modo de falha real caso a FK seja redeclarada errado (ou o delete vire um
    `DELETE FROM transactions` manual sem WHERE): a limpeza vaza para o resto
    da base e ninguém percebe até faltar dado.
    """
    doomed = create_account(fk_client, name="Conta Encerrada")
    survivor = create_account(fk_client, name="Conta Ativa")
    category = create_category(fk_client)

    create_transaction(fk_client, doomed, category["id"], "SAÍDA", 100.0)
    kept = create_transaction(fk_client, survivor, category["id"], "SAÍDA", 250.0).json()["id"]

    _raw_delete(fk_session, "accounts", doomed)

    remaining = fk_session.query(models.Transaction).all()
    assert [t.id for t in remaining] == [kept]
    assert remaining[0].account_id == survivor


def test_deleting_account_cascades_to_its_installments_via_orm(fk_session, fk_client):
    """Mesmo CASCADE, pelo caminho que o ORM não cobre.

    `Account` não declara relação com `Installment` — o SQLAlchemy não sabe que
    existem parcelamentos pendurados e emite só o DELETE da conta. Se o
    enforcement estiver desligado, sobra parcelamento órfão apontando para uma
    conta que não existe mais. É o teste que mais depende do PRAGMA.
    """
    account_id = create_account(fk_client)
    category = create_category(fk_client)
    response = fk_client.post(
        "/api/installments/",
        json=installment_payload(account_id, category["id"]),
    )
    assert response.status_code == 201, response.text

    account = fk_session.query(models.Account).filter_by(id=account_id).one()
    fk_session.delete(account)
    fk_session.commit()

    assert fk_session.query(models.Installment).count() == 0


# ---------------------------------------------------------------------------
# ON DELETE SET NULL — installments → transactions.installment_id
# ---------------------------------------------------------------------------

def test_deleting_installment_nulls_the_fk_without_deleting_transactions(fk_session, fk_client):
    """A parcela some, o lançamento fica.

    A transação já aconteceu e já mexeu no saldo — apagá-la junto do
    parcelamento seria reescrever histórico financeiro. `SET NULL` é a diferença
    entre "esse gasto não pertence mais a um parcelamento" e "esse gasto nunca
    existiu".
    """
    account_id = create_account(fk_client)
    category = create_category(fk_client)
    installment = fk_client.post(
        "/api/installments/",
        json=installment_payload(account_id, category["id"]),
    ).json()
    tx_id = _link_transaction_to_installment(
        fk_client, account_id, category["id"], installment["id"]
    )

    installment_row = fk_session.query(models.Installment).filter_by(id=installment["id"]).one()
    # Sem `Installment.transactions`, o ORM não tem dependente carregado para
    # nular em Python: quem responde é o banco.
    fk_session.expunge_all()
    fk_session.delete(installment_row)
    fk_session.commit()

    tx = fk_session.query(models.Transaction).filter_by(id=tx_id).one()
    assert tx.installment_id is None
    assert tx.amount == pytest.approx(500.0)
    assert tx.account_id == account_id


def test_set_null_is_scoped_to_the_deleted_installment(fk_session, fk_client):
    """Transação de outro parcelamento mantém o vínculo."""
    account_id = create_account(fk_client)
    category = create_category(fk_client)

    doomed = fk_client.post(
        "/api/installments/",
        json=installment_payload(account_id, category["id"], title="Notebook Dell"),
    ).json()
    survivor = fk_client.post(
        "/api/installments/",
        json=installment_payload(account_id, category["id"], title="Cadeira"),
    ).json()

    tx_doomed = _link_transaction_to_installment(fk_client, account_id, category["id"], doomed["id"])
    tx_survivor = _link_transaction_to_installment(fk_client, account_id, category["id"], survivor["id"])

    _raw_delete(fk_session, "installments", doomed["id"])

    by_id = {t.id: t for t in fk_session.query(models.Transaction).all()}
    assert by_id[tx_doomed].installment_id is None
    assert by_id[tx_survivor].installment_id == survivor["id"]


def test_transaction_without_installment_survives_the_set_null(fk_session, fk_client):
    """Transação avulsa (installment_id já NULL) não é afetada.

    ⚠️ Único teste deste arquivo que passa **também** com o PRAGMA desligado —
    `NULL` continua `NULL` nos dois mundos. Vale como caso de controle (o
    CASCADE do account_id não arrasta a transação junto quando o parcelamento
    sai), não como cobertura do SET NULL.
    """
    account_id = create_account(fk_client)
    category = create_category(fk_client)
    installment = fk_client.post(
        "/api/installments/",
        json=installment_payload(account_id, category["id"]),
    ).json()
    avulsa = create_transaction(fk_client, account_id, category["id"], "SAÍDA", 42.0).json()["id"]

    _raw_delete(fk_session, "installments", installment["id"])

    tx = fk_session.query(models.Transaction).filter_by(id=avulsa).one()
    assert tx.installment_id is None
    assert tx.amount == pytest.approx(42.0)


def test_orphan_installment_id_rejected_at_database_level(fk_session, fk_client):
    """Contrapeso do SET NULL: nular é o caminho legítimo para perder o
    vínculo. Apontar para um parcelamento que nunca existiu continua sendo
    erro de banco, mesmo por escrita direta (seed, script, shell)."""
    account_id = create_account(fk_client)
    category = create_category(fk_client)

    fk_session.add(models.Transaction(
        title="Escrita direta",
        type="SAÍDA",
        amount=10.0,
        date=datetime.date(2026, 8, 7),
        category_id=category["id"],
        account_id=account_id,
        installment_id=9999,
    ))

    with pytest.raises(IntegrityError):
        fk_session.commit()
