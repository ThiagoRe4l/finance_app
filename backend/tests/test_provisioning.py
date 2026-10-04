"""Fatia 3 — provisionamento no primeiro acesso (D-Tenant-5).

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Substitui `test_seed.py`: o seed global não tem dono a quem pertencer, e
`init_db.py` sai junto com ele. O que era "idempotência do seed" vira
"idempotência do provisionamento", por usuário.

O gatilho é **criar a linha em `users`**, não "o usuário não ter conta". É o
que separa os dois casos que não podem se confundir:

* e-mail novo da allowlist → ganha "Conta Principal" (R$ 0,00) e as 10
  categorias padrão;
* dono migrado (D-Tenant-6), que já tem linha e dados → não ganha nada.

Por que vermelho hoje
---------------------
Não há provisionamento: um e-mail novo não ganha nada, e a tabela `users` não
existe.
"""

import pytest
from sqlalchemy import text

from tests.conftest import money

NEW = "nova@example.com"

DEFAULT_CATEGORIES = {
    "Moradia", "Alimentação", "Transporte", "Lazer", "Saúde",
    "Educação", "Compras", "Receita", "Eletrônicos", "Móveis",
}


def _user_count(session, email):
    return session.execute(
        text("SELECT COUNT(*) FROM users WHERE email = :email"), {"email": email}
    ).scalar()


# ---------------------------------------------------------------------------
# O que um usuário novo recebe
# ---------------------------------------------------------------------------

def test_first_request_provisions_a_main_account_with_zero_balance(client_as):
    """R$ 0,00, não os R$ 10.000 do seed antigo (decidido em 03/10/2026).

    O seed antigo existia para a tela não abrir vazia num app de um usuário
    só; num usuário real, um saldo inventado é dado errado desde o primeiro
    minuto.
    """
    accounts = client_as(NEW).get("/api/accounts").json()

    assert len(accounts) == 1
    assert accounts[0]["name"] == "Conta Principal"
    assert money(accounts[0]["initial_balance"]) == 0
    assert money(accounts[0]["current_balance"]) == 0


def test_first_request_provisions_the_ten_default_categories(client_as):
    categories = client_as(NEW).get("/api/categories").json()

    assert {c["name"] for c in categories} == DEFAULT_CATEGORIES


def test_provisioning_happens_once(client_as):
    """🔴 O requisito que era do seed, agora por usuário.

    Toda requisição passa pela resolução do dono. Se a guarda falhar, cada
    clique duplica as 10 categorias — e o estrago só aparece com o dado sujo.
    """
    client = client_as(NEW)
    for _ in range(3):
        client.get("/api/accounts")

    assert len(client.get("/api/accounts").json()) == 1
    assert len(client.get("/api/categories").json()) == 10


def test_each_user_gets_their_own_defaults(client_as):
    """Depende da unicidade por dono (D-Tenant-2): com `UNIQUE(name)` global, o
    segundo usuário morreria no INSERT de "Moradia"."""
    ana, bia = client_as("ana@example.com"), client_as("bia@example.com")

    ana_ids = {c["id"] for c in ana.get("/api/categories").json()}
    bia_ids = {c["id"] for c in bia.get("/api/categories").json()}

    assert len(ana_ids) == len(bia_ids) == 10
    assert not ana_ids & bia_ids


def test_session_endpoint_provisions(client_as, session):
    """`GET /api/auth/me` é a primeira chamada do front, e passa a provisionar."""
    client_as(NEW).get("/api/auth/me")

    assert _user_count(session, NEW) == 1


def test_login_flow_ends_provisioned(anon_client, fake_google, session):
    """O caminho de verdade, do botão do Google até a primeira tela."""
    fake_google("outra@example.com")
    anon_client.post("/api/auth/google", json={"credential": "token-valido"})
    anon_client.get("/api/auth/me")

    assert _user_count(session, "outra@example.com") == 1
    assert len(anon_client.get("/api/categories").json()) == 10


# ---------------------------------------------------------------------------
# O que não pode ser provisionado
# ---------------------------------------------------------------------------

def test_revoked_email_is_not_provisioned(client_as, session):
    """🔴 O provisionamento vem **depois** da allowlist.

    Cookie assinado e válido, e-mail fora da lista. Se a ordem fosse a
    inversa, quem foi tirado do app ganharia linha e dados a cada tentativa —
    e passaria a aparecer como participante possível (D-Shared-4).
    """
    client = client_as("saiu@example.com")
    client_as.revoke("saiu@example.com")

    assert client.get("/api/accounts").status_code == 401
    assert _user_count(session, "saiu@example.com") == 0


def test_preexisting_user_is_never_provisioned(client_as, session):
    """🔴 O dono migrado não pode ganhar uma segunda "Conta Principal".

    Simula o estado pós-migration: linha em `users` e uma conta própria,
    **sem** categorias. Se o gatilho fosse "não ter categoria" ou "não ter
    conta", este usuário seria provisionado por cima do dado real.
    """
    session.execute(text("INSERT INTO users (id, email) VALUES (1, 'dono@example.com')"))
    session.execute(text(
        "INSERT INTO accounts (id, name, initial_balance, owner_id) "
        "VALUES (1, 'Conta Real', 1234.56, 1)"
    ))
    session.commit()

    client = client_as("dono@example.com")

    assert [a["name"] for a in client.get("/api/accounts").json()] == ["Conta Real"]
    assert client.get("/api/categories").json() == []


# ---------------------------------------------------------------------------
# Falha no meio do provisionamento
# ---------------------------------------------------------------------------

def test_a_provisioning_failure_is_raised_as_itself(session, monkeypatch):
    """🔴 O `except IntegrityError` existe para a corrida do `UNIQUE(email)`.

    Mas ele cobre também um `IntegrityError` vindo de `provision_user`. Nesse
    caso, depois do rollback, a releitura não acha usuário nenhum — e o erro
    que sobe tem que ser o **original**. A versão anterior relia com `.one()` e
    trocava a causa real por um `NoResultFound`, que aponta para o lugar errado.
    """
    from sqlalchemy.exc import IntegrityError

    from app import tenancy

    def broken(db, user):
        raise IntegrityError("INSERT INTO categories", {}, Exception("conflito simulado"))

    monkeypatch.setattr(tenancy, "provision_user", broken)

    with pytest.raises(IntegrityError, match="conflito simulado"):
        tenancy.resolve_user(session, "falha@example.com")


def test_a_provisioning_failure_leaves_no_half_created_user(session, monkeypatch):
    """✅ **Já passa** — regressão: o rollback já desfazia tudo. O par do de
    cima: usuário criado e provisionamento falhado não podem
    sobrar como linha sem conta — essa linha nunca mais seria provisionada."""
    from sqlalchemy.exc import IntegrityError

    from app import tenancy

    def broken(db, user):
        raise IntegrityError("INSERT INTO categories", {}, Exception("conflito simulado"))

    monkeypatch.setattr(tenancy, "provision_user", broken)

    with pytest.raises(Exception):
        tenancy.resolve_user(session, "falha@example.com")

    assert _user_count(session, "falha@example.com") == 0


# ---------------------------------------------------------------------------
# O caminho de produção provisiona
# ---------------------------------------------------------------------------

def test_the_provisioning_tests_run_the_production_path(client_as):
    """✅ **Já passa** — guarda das premissas deste arquivo.

    `provision=False` existe só no override de `client`/`fk_client`. Os testes
    acima só provam o caminho de produção se `client_as` **não** carregar esse
    override — senão passariam a medir o atalho da suíte.
    """
    from app.main import app
    from app.tenancy import current_owner

    client_as(NEW)

    assert current_owner not in app.dependency_overrides


# ---------------------------------------------------------------------------
# O que sai
# ---------------------------------------------------------------------------

def test_the_global_seed_script_is_gone():
    """`init_db.py` populava conta e categorias **sem dono**. Com `owner_id NOT
    NULL` ele não tem mais o que fazer — e um script que roda com `--yes`
    contra o Neon e falha no meio é pior que script nenhum.

    `test_seed.py` sai junto, substituído por este arquivo.
    """
    with pytest.raises(ModuleNotFoundError):
        import app.init_db  # noqa: F401
