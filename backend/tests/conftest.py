"""Fixtures compartilhadas da suíte.

Até aqui cada arquivo de teste carregava a própria cópia do setup de SQLite em
memória. Com `category_id` virando FK obrigatória, todo teste que cria uma
transação passa a precisar de uma categoria existente antes — replicar isso em
6 arquivos seria copy-paste garantido. As fixtures ficam aqui.

Os arquivos que ainda definem `session`/`client` localmente continuam usando a
versão local (fixture de módulo tem precedência sobre a do conftest); a
migração deles acontece junto da implementação.
"""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

SQLALCHEMY_DATABASE_URL = "sqlite://"


def _build_engine():
    return create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


engine = _build_engine()
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(name="session")
def session_fixture():
    """Banco limpo, **sem** enforcement de FK.

    Reproduz o SQLite como o app o usa hoje (PRAGMA foreign_keys desligado por
    default). Os testes de 404 rodam aqui de propósito: a validação do router
    tem que funcionar por si, sem depender do banco para segurar a barra.
    """
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(name="client")
def client_fixture(session):
    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    del app.dependency_overrides[get_db]


@pytest.fixture(name="fk_session")
def fk_session_fixture():
    """Banco limpo **com** enforcement de FK ligado.

    O listener vem de `app.database` de propósito — não é um workaround do
    teste. Se o PRAGMA for ligado só aqui, a suíte fica verde enquanto a
    aplicação real continua sem enforcement, que é exatamente o falso positivo
    que estes testes existem para impedir.
    """
    from app.database import enable_sqlite_foreign_keys  # implementação pendente

    fk_engine = _build_engine()
    enable_sqlite_foreign_keys(fk_engine)
    FkSession = sessionmaker(autocommit=False, autoflush=False, bind=fk_engine)

    Base.metadata.create_all(bind=fk_engine)
    db = FkSession()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=fk_engine)


@pytest.fixture(name="fk_client")
def fk_client_fixture(fk_session):
    def override_get_db():
        try:
            yield fk_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    del app.dependency_overrides[get_db]


# ---------------------------------------------------------------------------
# Dinheiro
# ---------------------------------------------------------------------------

def money(raw) -> Decimal:
    """Valor monetário devolvido pela API, como `Decimal` exato.

    Assere que o campo veio como **string** JSON. Com `Numeric(12, 2)` no
    SQLAlchemy e `Decimal` no Pydantic, dinheiro é serializado como string —
    decisão registrada no CLAUDE.md, e a restrição que a integração do front
    vai ter que respeitar.

    A checagem de tipo é o que dá valor ao helper. Se um campo regredir para
    `float`, o teste falha **aqui**, com o tipo errado na mensagem, em vez de
    numa comparação numérica onde `Decimal("0.30") == 0.30` daria `False` por
    um motivo obscuro — ou pior, onde o epsilon passaria despercebido.
    """
    assert isinstance(raw, str), (
        f"campo monetário deveria ser string JSON (Decimal), veio "
        f"{type(raw).__name__}: {raw!r}"
    )
    return Decimal(raw)


# ---------------------------------------------------------------------------
# Helpers de domínio
# ---------------------------------------------------------------------------

def create_category(client, name="Alimentação", icon_name="UtensilsCrossed",
                    budget=800.0, color="oklch(0.6 0.15 155)"):
    response = client.post("/api/categories/", json={
        "name": name,
        "icon_name": icon_name,
        "budget": budget,
        "color": color,
    })
    assert response.status_code == 201, response.text
    return response.json()


def create_account(client, name="Conta Principal", initial_balance=10000.0):
    response = client.post("/api/accounts", json={
        "name": name,
        "initial_balance": initial_balance,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_transaction(client, account_id, category_id, tx_type="SAÍDA",
                       amount=100.0, date="2026-08-07", title="Lançamento"):
    return client.post("/api/transactions", json={
        "title": title,
        "type": tx_type,
        "amount": amount,
        "date": date,
        "category_id": category_id,
        "account_id": account_id,
    })


def installment_payload(account_id, category_id, **overrides):
    payload = {
        "title": "Notebook Dell",
        "category_id": category_id,
        "total_amount": 6000.0,
        "installment_amount": 500.0,
        "current_installment": 2,
        "total_installments": 12,
        "end_date": "Ago/2026",
        "account_id": account_id,
    }
    payload.update(overrides)
    return payload


@pytest.fixture(name="default_category")
def default_category_fixture(client):
    return create_category(client)


@pytest.fixture(name="default_account")
def default_account_fixture(client):
    return create_account(client)
