"""Fixtures compartilhadas da suíte.

Até aqui cada arquivo de teste carregava a própria cópia do setup de SQLite em
memória. Com `category_id` virando FK obrigatória, todo teste que cria uma
transação passa a precisar de uma categoria existente antes — replicar isso em
6 arquivos seria copy-paste garantido. As fixtures ficam aqui.

Os arquivos que ainda definem `session`/`client` localmente continuam usando a
versão local (fixture de módulo tem precedência sobre a do conftest); a
migração deles acontece junto da implementação.
"""

import datetime
import os
import pathlib
from decimal import Decimal

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_user
from app.tenancy import current_owner, resolve_user
from app.database import Base, get_db
from app.main import app

# E-mail da sessão usada pela fixture `client`. Qualquer valor serve — o que
# importa é ele ser diferente do `intruso@` dos testes de allowlist.
TEST_USER_EMAIL = "pessoa@example.com"

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent

# SQLite em memória por default; o job de Postgres do CI aponta para o serviço
# real (D-Vercel-1). Uma variável separada de `DATABASE_URL` de propósito: rodar
# a suíte não pode, por acidente de ambiente, apagar o banco de trabalho.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite://")
IS_SQLITE = TEST_DATABASE_URL.startswith("sqlite")


def _build_engine():
    if IS_SQLITE:
        # StaticPool + memória: uma conexão só, compartilhada — é o que faz o
        # banco sobreviver entre a fixture e o TestClient.
        return create_engine(
            TEST_DATABASE_URL,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

    from app.settings import engine_options_for

    return create_engine(TEST_DATABASE_URL, **engine_options_for(TEST_DATABASE_URL))


def _create_schema(target_engine):
    """Constrói o schema **pela migration do Alembic**, não por `create_all()`.

    Esta é a diferença que dá valor à verificação: com `create_all()` a suíte
    validaria os *models*, e a migration poderia divergir deles sem nada
    denunciar — que é exatamente o risco do `--autogenerate` registrado na
    D-Vercel-6. Rodando a migration, qualquer divergência vira teste vermelho.

    A conexão é injetada em `config.attributes` porque o SQLite em memória
    morre se o Alembic abrir a própria conexão.
    """
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))

    with target_engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def _truncate_all(target_engine):
    """Esvazia as tabelas entre testes, preservando o schema da migration."""
    with target_engine.begin() as connection:
        if IS_SQLITE:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())
        else:
            tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
            # RESTART IDENTITY: os testes assumem ids começando em 1.
            connection.execute(
                text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
            )


engine = _build_engine()
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Schema criado uma vez por sessão, pela migration."""
    _create_schema(engine)
    yield


@pytest.fixture(name="session")
def session_fixture(_schema):
    """Banco limpo, **sem** enforcement de FK (no SQLite).

    Reproduz o SQLite como o app o usa (PRAGMA foreign_keys desligado por
    default). Os testes de 404 rodam aqui de propósito: a validação do router
    tem que funcionar por si, sem depender do banco para segurar a barra.

    ⚠️ **No Postgres não existe esse "sem enforcement"** — a FK é sempre
    aplicada, e esta fixture passa a ser indistinguível de `fk_session`.

    Os testes de 404 continuam válidos nos dois bancos: o router recusa antes de
    chegar ao banco. O que **não** foi possível verificar daqui é se algum teste
    depende de conseguir inserir linha órfã — isso exigiria um Postgres em
    execução, que este ambiente não tem (sem Docker, ver Common Hurdles). Se o
    job de Postgres do CI acusar falha nesse ponto, a correção é marcar o teste
    como específico de SQLite; não presuma que já está tratado.
    """
    _truncate_all(engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _auth_environment(monkeypatch):
    """Ambiente de autenticação determinístico para toda a suíte.

    Sem isto, `AUTH_ALLOWED_EMAILS` viria do `.env.local` da máquina (ou de
    lugar nenhum, e a allowlist *fail closed* recusaria tudo) — e a suíte
    passaria ou falharia conforme a configuração local, que é exatamente o tipo
    de dependência de ambiente que a seção 0.1 do CLAUDE.md registra como
    problema.

    `autouse` porque vale para os 300+ testes que não falam de autenticação:
    eles só precisam que o ambiente seja previsível.
    """
    monkeypatch.setenv("AUTH_ALLOWED_EMAILS", f"{TEST_USER_EMAIL},outra@example.com")
    monkeypatch.setenv("SESSION_SECRET", "segredo-de-teste-deterministico")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com")

    # 🔴 `DATABASE_URL` precisa estar fixada aqui, e o motivo não é o banco.
    #
    # `settings.load_env_file()` carrega `backend/.env.local` no import — e lá
    # mora a URL do **Neon de produção**. Com ela, `is_local_environment()`
    # devolve False, o cookie de sessão sai com `Secure`, e o `TestClient`
    # (que fala `http://testserver`) **descarta** cookie Secure sobre http.
    #
    # O efeito era a suíte passar no CI (onde não há `.env.local`) e falhar na
    # máquina de quem tem o arquivo — exatamente a classe de problema que a
    # seção 0.1 do CLAUDE.md registra. O banco de teste em si nunca vem daqui:
    # vem de `TEST_DATABASE_URL`.
    monkeypatch.setenv("DATABASE_URL", "sqlite://")


def _unprovisioned_owner(
    email: str = Depends(current_user),
    db=Depends(get_db),
):
    """`current_owner` **sem** provisionamento, para `client` e `fk_client`.

    Com as 10 categorias padrão e a "Conta Principal", cada
    `create_category(client, "Alimentação")` e `create_account(client)` dos
    testes antigos colidiria com o que o provisionamento já criou, e as
    contagens deixariam de bater (D-Tenant-8).

    Só o provisionamento sai: a linha de `users` continua sendo criada, e o
    filtro por dono continua valendo. O provisionamento de verdade é exercitado
    por `client_as` e `anon_client`, em `test_provisioning.py`.
    """
    return resolve_user(db, email, provision=False)


@pytest.fixture(name="client")
def client_fixture(session):
    """Cliente **autenticado**. É o default porque 251 das 300+ chamadas da
    suíte não são sobre autenticação.

    ⚠️ **O override é o risco desta fatia.** Ele deixa a suíte verde sem
    exercitar `current_user`, então uma rota desprotegida passaria batido — o
    mesmo falso positivo que `fk_session`/`fk_client` existem para evitar. O
    contrapeso são os quatro testes de enumeração em `test_auth_routes.py`, que
    rodam com `anon_client` e com introspecção, **sem** este override.
    """
    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user] = lambda: TEST_USER_EMAIL
    app.dependency_overrides[current_owner] = _unprovisioned_owner
    yield TestClient(app)
    del app.dependency_overrides[get_db]
    del app.dependency_overrides[current_user]
    del app.dependency_overrides[current_owner]


@pytest.fixture(name="anon_client")
def anon_client_fixture(session):
    """Cliente **sem sessão**, com `current_user` real.

    É o cliente dos testes de 401 e do fluxo de login. Só o banco é
    substituído; a autenticação roda de verdade.
    """
    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    del app.dependency_overrides[get_db]


@pytest.fixture(name="client_as")
def client_as_fixture(session, monkeypatch):
    """Fábrica de clientes autenticados **de verdade**, um por e-mail (D-Tenant-8).

    É o cliente da varredura de isolamento e do provisionamento. Três escolhas,
    cada uma fechando um falso verde possível:

    * **Cookie real** (`issue_session`), sem override de `current_user`. O
      override global de `dependency_overrides` é um só por app — dois usuários
      ao mesmo tempo seriam impossíveis com ele, e o caminho de resolução do
      dono ficaria fora do teste.
    * **Uma sessão de banco por requisição**, como em produção. Com a sessão
      compartilhada da fixture `session`, o mapa de identidade do SQLAlchemy
      guardaria objetos de A entre requisições — a ressalva 2 da D-Tenant-3.
    * **A allowlist é montada aqui**, por e-mail pedido. `revoke(email)` tira
      um e-mail depois, para os cenários de quem saiu do app.

    Depende de `session` só para herdar o banco limpo (`_truncate_all`).
    """
    from app.auth import issue_session

    allowed = {TEST_USER_EMAIL, "outra@example.com"}

    def _sync_allowlist():
        monkeypatch.setenv("AUTH_ALLOWED_EMAILS", ",".join(sorted(allowed)))

    def per_request_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = per_request_db

    def _make(email):
        allowed.add(email.lower())
        _sync_allowlist()
        token = issue_session(email, "segredo-de-teste-deterministico")
        return TestClient(app, cookies={"session": token})

    def _revoke(email):
        allowed.discard(email.lower())
        _sync_allowlist()

    _make.revoke = _revoke

    yield _make

    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(name="fake_google")
def fake_google_fixture(monkeypatch):
    """Substitui a verificação do ID token do Google.

    Nenhum teste fala com o Google: seria lento, instável e exigiria
    credencial. A injeção acontece no ponto mais estreito possível —
    `verify_google_id_token` —, então tudo o que vem depois (allowlist, emissão
    de cookie, status codes) é exercitado de verdade.

    Chame com um e-mail para simular token válido, ou com `None` para simular
    token recusado.
    """
    from app import auth as auth_module

    def _install(email):
        def fake(token, client_id, signing_key_resolver=None):
            if email is None:
                raise auth_module.InvalidGoogleToken("token de teste inválido")
            return email

        monkeypatch.setattr(auth_module, "verify_google_id_token", fake)
        # O router importa o módulo, não a função, mas a troca acima já cobre
        # os dois caminhos — fica explícito para quem vier depois.

    return _install


@pytest.fixture(name="fk_session")
def fk_session_fixture(_schema):
    """Banco limpo **com** enforcement de FK ligado.

    O listener vem de `app.database` de propósito — não é um workaround do
    teste. Se o PRAGMA for ligado só aqui, a suíte fica verde enquanto a
    aplicação real continua sem enforcement, que é exatamente o falso positivo
    que estes testes existem para impedir.
    """
    from app.database import enable_sqlite_foreign_keys

    if not IS_SQLITE:
        # Postgres aplica FK nativamente e sempre. A fixture continua existindo
        # para que os mesmos testes rodem nos dois bancos — no Postgres ela é
        # equivalente a `session`, e é justamente aí que `test_fk_cascade.py`
        # exercita CASCADE/RESTRICT/SET NULL contra o motor de produção.
        _truncate_all(engine)
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()
        return

    fk_engine = _build_engine()
    enable_sqlite_foreign_keys(fk_engine)
    FkSession = sessionmaker(autocommit=False, autoflush=False, bind=fk_engine)

    _create_schema(fk_engine)
    db = FkSession()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=fk_engine)


@pytest.fixture(name="fk_client")
def fk_client_fixture(fk_session):
    """Como `client`, mas com enforcement de FK — e **também autenticado**.

    A autenticação não é detalhe: sem ela os 11 testes de `test_fk_cascade.py`
    e `test_category_fk.py` passariam a medir 401 em vez de CASCADE/RESTRICT, e
    o arquivo que protege as cláusulas `ondelete` deixaria de proteger nada.
    """
    def override_get_db():
        try:
            yield fk_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[current_user] = lambda: TEST_USER_EMAIL
    app.dependency_overrides[current_owner] = _unprovisioned_owner
    yield TestClient(app)
    del app.dependency_overrides[get_db]
    del app.dependency_overrides[current_user]
    del app.dependency_overrides[current_owner]


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

def owner_id_of(db, email=TEST_USER_EMAIL):
    """Id do dono de um e-mail — para os testes que escrevem direto no banco.

    A linha em `users` nasce na primeira requisição do cliente (D-Tenant-5),
    então chame depois de pelo menos uma chamada à API.

    ⚠️ Não é detalhe nos testes que **esperam** `IntegrityError`: sem o dono
    certo, o insert falharia pelo `owner_id NOT NULL` e o teste ficaria verde
    pelo motivo errado.
    """
    from app import models

    return db.query(models.User).filter(models.User.email == email).one().id


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
                       amount=100.0, date=None, title="Lançamento"):
    """Cria uma transação. `date` omitido = **hoje**.

    O default era `"2026-08-07"` fixo. Depois que as agregações passaram a
    recortar o mês corrente (ver "Agregação de categoria é do mês corrente" no
    CLAUDE.md), data literal virou bomba-relógio: os ~20 asserts de `spent`
    pendurados neste helper passariam em agosto/2026 e ficariam vermelhos em
    setembro, sem ninguém tocar em código.

    Teste que precise de data específica deve derivá-la de
    `datetime.date.today()`, não escrever um literal.
    """
    if date is None:
        date = datetime.date.today().isoformat()
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
