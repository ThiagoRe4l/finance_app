"""Rotas protegidas e endpoints de autenticação — D-Auth-6 e o raio de impacto.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Por que a enumeração é o teste mais importante desta fatia
----------------------------------------------------------
Para não reescrever 251 chamadas em 19 arquivos, o `client` do `conftest.py`
passa a vir **autenticado por default**. Isso cria um risco preciso: override
largo demais deixa a suíte **verde com a aplicação real desprotegida** — o
mesmo falso positivo que as fixtures `fk_session`/`fk_client` existem para
evitar.

Os três testes de enumeração são o contrapeso, e rodam **sem** o override:

1. estrutural — toda rota de `/api` declara a dependency de autenticação;
2. comportamental — cliente anônimo leva 401 de verdade;
3. de contrato — a lista de rotas públicas é exatamente a declarada.

O terceiro é o que impede a lista pública de crescer em silêncio: sem ele,
alguém "conserta" um 401 inconveniente adicionando a rota às públicas, e a
proteção vaza sem nenhum teste vermelho.

É o análogo de `test_every_foreign_key_declares_ondelete`.

⚠️ Na etapa vermelha, os testes que usam `anon_client` falham por **fixture
inexistente**. É esperado: a fixture faz parte da implementação pendente, junto
do `client` autenticado.
"""

import pytest

# Rotas que podem ser alcançadas sem sessão. Qualquer adição aqui é uma decisão
# de segurança e tem que ser deliberada — é isso que o teste de contrato trava.
#
# `/api/auth/me` **não** está na lista: ele exige sessão e devolve 401 sem ela,
# que é justamente como o gate do front descobre que não há login.
PUBLIC_PATHS = frozenset({
    "/",
    "/health",
    "/api/auth/google",
    "/api/auth/logout",
})


def _auth():
    from app import auth

    return auth


def _effective_routes():
    """Rotas efetivas do app, achatadas.

    ⚠️ **`app.routes` NÃO é uma lista plana de rotas** no FastAPI 0.139:
    `include_router` insere um `_IncludedRouter` que guarda o router original e
    o contexto de inclusão, e as rotas de verdade saem de
    `effective_route_contexts()`.

    Isso foi descoberto **por este arquivo**: a primeira versão supunha a lista
    plana, varreu zero rotas e os testes de proteção ficaram verdes por
    vacuidade. Quem pegou foi
    `test_the_behavioural_sweep_actually_covered_something`, que existe
    exatamente para isso.

    O suporte aos dois formatos não é indecisão — é o que faz esta varredura
    sobreviver a uma mudança de versão do FastAPI em qualquer direção, em vez
    de voltar a ficar verde sem examinar nada.
    """
    from app.main import app

    routes = []
    for entry in app.routes:
        if hasattr(entry, "effective_route_contexts"):
            routes.extend(entry.effective_route_contexts())
        elif hasattr(entry, "path"):
            routes.append(entry)

    return routes


def _api_routes():
    return [
        route
        for route in _effective_routes()
        if getattr(route, "path", "").startswith("/api/")
    ]


# ---------------------------------------------------------------------------
# 1. Estrutural
# ---------------------------------------------------------------------------

def test_every_api_route_declares_the_auth_dependency():
    """🔴 Impede que um router novo nasça desprotegido em silêncio.

    Cobre também POST/PATCH/DELETE, que o teste comportamental não alcança sem
    inventar payload para cada um.
    """
    from fastapi.dependencies.utils import get_flat_dependant

    current_user = _auth().current_user
    unprotected = []

    for route in _api_routes():
        if route.path in PUBLIC_PATHS:
            continue
        flat = get_flat_dependant(route.dependant)
        if current_user not in [dep.call for dep in flat.dependencies]:
            unprotected.append(f"{sorted(route.methods)} {route.path}")

    assert not unprotected, (
        "rotas de /api sem a dependency de autenticação: " + ", ".join(unprotected)
    )


# ---------------------------------------------------------------------------
# 2. Comportamental — a prova que introspecção não dá
# ---------------------------------------------------------------------------

def test_anonymous_client_is_rejected_on_every_parameterless_get(anon_client):
    """🔴 401 de verdade, não dependency declarada.

    Introspecção pode ser enganada por uma dependency que existe e não recusa
    nada. Isto exercita o comportamento no app montado.
    """
    allowed = []

    for route in _api_routes():
        if route.path in PUBLIC_PATHS or "{" in route.path:
            continue
        if "GET" not in getattr(route, "methods", set()):
            continue
        response = anon_client.get(route.path)
        if response.status_code != 401:
            allowed.append(f"{route.path} -> {response.status_code}")

    assert not allowed, "rotas acessíveis sem sessão: " + ", ".join(allowed)


def test_the_behavioural_sweep_actually_covered_something(anon_client):
    """Guarda do teste acima: um laço que não itera passa vazio.

    Se um refactor mudar os prefixos das rotas, o teste anterior ficaria verde
    por não examinar nada. Este fixa o piso.
    """
    swept = [
        route.path
        for route in _api_routes()
        if route.path not in PUBLIC_PATHS
        and "{" not in route.path
        and "GET" in getattr(route, "methods", set())
    ]

    assert len(swept) >= 7, f"a varredura examinou só {len(swept)} rotas: {swept}"


# ---------------------------------------------------------------------------
# 3. Contrato da lista pública
# ---------------------------------------------------------------------------

def test_public_routes_are_exactly_the_declared_ones():
    """🔴 Impede a lista pública de crescer sem decisão.

    Sem isto, a saída fácil para um 401 inconveniente é adicionar a rota às
    públicas — e a proteção vaza sem nenhum teste ficar vermelho.
    """
    declared_public = {
        route.path
        for route in _effective_routes()
        if getattr(route, "path", "") in PUBLIC_PATHS
    }

    assert declared_public == set(PUBLIC_PATHS)


def test_health_stays_reachable_without_a_session(anon_client):
    """O smoke pós-deploy e o monitoramento batem em `/health`. Fechá-lo
    quebraria os dois sem relação aparente com autenticação."""
    assert anon_client.get("/health").status_code == 200


# ---------------------------------------------------------------------------
# Os endpoints de autenticação
# ---------------------------------------------------------------------------

def test_login_with_an_allowlisted_email_sets_the_session_cookie(anon_client, fake_google):
    fake_google("pessoa@example.com")

    response = anon_client.post("/api/auth/google", json={"credential": "token-valido"})

    assert response.status_code == 200
    assert "session" in response.cookies


def test_the_session_cookie_is_httponly_and_host_only(anon_client, fake_google):
    """🔴 Dois atributos, duas falhas distintas.

    `HttpOnly` ausente põe a sessão ao alcance de qualquer XSS.

    `Domain` **presente** é a armadilha da D-Auth-3: o cookie precisa colar no
    host que o browser pediu — o domínio do frontend — para voltar pelo rewrite
    `/api`. Com `Domain` do backend, o browser descarta o cookie e o login
    falha sem erro legível em lugar nenhum.
    """
    fake_google("pessoa@example.com")

    response = anon_client.post("/api/auth/google", json={"credential": "token-valido"})
    set_cookie = response.headers["set-cookie"].lower()

    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "domain=" not in set_cookie


def test_login_from_outside_the_allowlist_is_forbidden(anon_client, fake_google):
    """403, não 401: o token é válido, a pessoa é que não tem acesso.

    E **nenhum cookie** pode ser emitido — se um 403 deixasse sessão para trás,
    a allowlist viraria decoração.
    """
    fake_google("intruso@example.com")

    response = anon_client.post("/api/auth/google", json={"credential": "token-valido"})

    assert response.status_code == 403
    assert "session" not in response.cookies


def test_login_with_an_invalid_token_is_unauthorized(anon_client, fake_google):
    fake_google(None)  # o verificador levanta InvalidGoogleToken

    response = anon_client.post("/api/auth/google", json={"credential": "lixo"})

    assert response.status_code == 401
    assert "session" not in response.cookies


def test_me_returns_the_authenticated_email(client):
    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert "@" in response.json()["email"]


def test_me_without_a_session_is_unauthorized(anon_client):
    assert anon_client.get("/api/auth/me").status_code == 401


def test_logout_clears_the_cookie(anon_client, fake_google):
    fake_google("pessoa@example.com")
    anon_client.post("/api/auth/google", json={"credential": "token-valido"})

    response = anon_client.post("/api/auth/logout")

    assert response.status_code == 204
    assert anon_client.get("/api/auth/me").status_code == 401


def test_logout_without_a_session_is_not_an_error(anon_client):
    """Idempotente. Cookie expirado tem que poder ser limpo — senão o usuário
    fica preso num estado que só o devtools resolve."""
    assert anon_client.post("/api/auth/logout").status_code == 204


# ---------------------------------------------------------------------------
# Revogação pela allowlist (D-Auth-2)
# ---------------------------------------------------------------------------

def test_removing_the_email_from_the_allowlist_revokes_an_existing_session(
    anon_client, fake_google, monkeypatch
):
    """🔴 A propriedade que substituiu a tabela de sessão.

    O cookie continua válido e assinado — o que muda é a allowlist. Se a
    checagem acontecesse só no login, esta sessão sobreviveria até expirar, e
    "tirar alguém do app" deixaria de funcionar sem ninguém notar.
    """
    from app import settings

    fake_google("pessoa@example.com")
    anon_client.post("/api/auth/google", json={"credential": "token-valido"})
    assert anon_client.get("/api/auth/me").status_code == 200

    monkeypatch.setattr(settings, "resolve_allowed_emails", lambda env=None: frozenset())

    assert anon_client.get("/api/auth/me").status_code == 401


# ---------------------------------------------------------------------------
# D-Auth-8: /docs fora do ar em produção
# ---------------------------------------------------------------------------

def test_docs_are_disabled_outside_local_development():
    """O schema descreve a superfície inteira da API; com ela fechada, deixá-lo
    aberto é exposição gratuita.

    Verificado pela fábrica, não pelo app já montado: o `app` global é criado
    no import com a configuração local.
    """
    from app.main import create_app

    production = create_app(local=False)

    assert production.docs_url is None
    assert production.redoc_url is None
    assert production.openapi_url is None


def test_docs_stay_available_locally():
    from app.main import create_app

    assert create_app(local=True).docs_url == "/docs"


def test_the_versioned_openapi_schema_is_still_generatable():
    """O item 3 do Checklist Pós-Implementação roda `app.openapi()`.

    Ele não depende das rotas de documentação — este teste garante que
    desabilitar `/docs` não quebrou o checklist.
    """
    from app.main import create_app

    schema = create_app(local=False).openapi()

    assert schema["info"]["title"]
    assert "/api/accounts/" in schema["paths"]


# ---------------------------------------------------------------------------
# Guard: o ambiente de teste não pode depender da máquina
# ---------------------------------------------------------------------------

def test_the_test_environment_is_local_regardless_of_env_local():
    """🔴 Trava o defeito encontrado ao implementar esta fatia.

    `settings.load_env_file()` carrega `backend/.env.local` no import, e lá mora
    a URL do Neon de **produção**. Sem a fixture `_auth_environment` fixar
    `DATABASE_URL`, `is_local_environment()` devolvia False, o cookie saía com
    `Secure`, e o `TestClient` — que fala `http://testserver` — o descartava.

    O resultado era uma suíte que passava no CI e falhava na máquina de quem
    tinha o arquivo. Este teste existe para que isso não volte em silêncio.
    """
    from app.settings import is_local_environment, resolve_database_url

    assert is_local_environment(resolve_database_url()) is True


def test_the_session_cookie_is_not_secure_in_local_development(anon_client, fake_google):
    """O par do teste acima, pelo lado observável.

    Cookie `Secure` sobre `http://localhost` não é gravado pelo browser — o
    login local pararia de funcionar, e o sintoma não apontaria para o cookie.
    """
    fake_google("pessoa@example.com")

    response = anon_client.post("/api/auth/google", json={"credential": "token-valido"})

    assert "secure" not in response.headers["set-cookie"].lower()
