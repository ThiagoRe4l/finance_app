"""Barra final não pode gerar redirect — D-Vercel-3.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

O que aconteceu em produção
---------------------------
Dashboard e Relatórios carregavam; Transações, Categorias e Parcelamentos
davam `"Não autenticado."`. A correlação era exata: só as três que chamam rota
de **coleção com barra final** falhavam.

A cadeia, provada hop a hop contra produção:

    GET https://<front>/api/transactions/
      → 307  location: /api/transactions                      (Vercel, relativo, REMOVE a barra)
    GET https://<front>/api/transactions
      → 307  location: https://<backend>/api/transactions/    (FastAPI, absoluto, no domínio do BACKEND)
    GET https://<backend>/api/transactions/
      → 401  "Não autenticado."

O browser termina **cross-origin**, no domínio do backend — e o cookie de
sessão é host-only no domínio do **frontend** (D-Auth-3, sem `Domain`). Não é
enviado, e `current_user` recusa.

A rota que funciona faz **0 redirects** e termina no domínio do frontend.

⚠️ O risco estava registrado na D-Vercel-3: *"o 307 de barra final atravessando
o rewrite merece verificação própria"*. Materializou.

Por que a correção é eliminar o redirect, não controlar a Vercel
---------------------------------------------------------------
A Vercel **remove** a barra final; o FastAPI **adiciona**. Os dois normalizam
em direções opostas, então o backend nunca recebe a forma que ele exige. Tentar
alinhar o `trailingSlash` da plataforma é depender de comportamento que já
mudou sem aviso duas vezes nesta sessão (o rewrite por caminho e o output do
build). Sem redirect, não há para onde o cookie se perder.
"""

import pytest


def _effective_routes():
    """Rotas efetivas, achatadas — ver a explicação em `test_auth_routes.py`."""
    from app.main import app

    routes = []
    for entry in app.routes:
        if hasattr(entry, "effective_route_contexts"):
            routes.extend(entry.effective_route_contexts())
        elif hasattr(entry, "path"):
            routes.append(entry)

    return routes


def _parameterless_api_gets():
    return sorted(
        {
            route.path
            for route in _effective_routes()
            if route.path.startswith("/api/")
            and "{" not in route.path
            and "GET" in getattr(route, "methods", set())
        }
    )


def _flip(path: str) -> str:
    return path[:-1] if path.endswith("/") else path + "/"


# ---------------------------------------------------------------------------
# O invariante central: nenhum redirect, nunca
# ---------------------------------------------------------------------------

def test_the_app_does_not_redirect_slashes():
    """🔴 `redirect_slashes=True` (o default) é a origem do 307.

    E o 307 do FastAPI carrega `Location` **absoluto, montado a partir do host
    que ele próprio vê** — o domínio do backend. Atrás do rewrite isso joga o
    browser cross-origin e o cookie host-only fica atrás.
    """
    from app.main import app

    assert app.router.redirect_slashes is False


def test_no_api_route_answers_with_a_redirect(client):
    """🔴 O teste que prova a ausência do defeito, não só da configuração.

    Varre as duas formas de **toda** rota GET sem parâmetro. Qualquer 307/308
    aqui é o bug de volta.
    """
    redirecting = []

    for path in _parameterless_api_gets():
        for variant in (path, _flip(path)):
            response = client.get(variant, follow_redirects=False)
            if response.status_code in (307, 308):
                redirecting.append(f"{variant} -> {response.status_code}")

    assert not redirecting, "rotas redirecionando por barra final: " + ", ".join(redirecting)


def test_both_forms_return_the_same_status(client):
    """As duas formas têm que ser **a mesma rota**, não só ambas não-redirect.

    Sem isto, uma das formas poderia virar 404 — que também não é redirect e
    passaria o teste acima.
    """
    divergent = []

    for path in _parameterless_api_gets():
        a = client.get(path, follow_redirects=False).status_code
        b = client.get(_flip(path), follow_redirects=False).status_code
        if a != b:
            divergent.append(f"{path}={a} vs {_flip(path)}={b}")

    assert not divergent, "formas divergentes: " + ", ".join(divergent)


def test_the_sweep_actually_covered_the_collection_routes():
    """Guarda: laço que não itera passa vazio.

    Mesma lição de `test_auth_routes.py`, onde a varredura examinou zero rotas
    e os testes ficaram verdes por vacuidade.
    """
    paths = _parameterless_api_gets()

    assert len(paths) >= 8, f"a varredura examinou só {len(paths)}: {paths}"


# ---------------------------------------------------------------------------
# Uma rota de cada tipo, explicitamente
# ---------------------------------------------------------------------------

def test_collection_route_works_in_both_forms(client, default_account, default_category):
    """Rota de **coleção** — a que quebrou em produção."""
    create = client.post(
        "/api/transactions",
        json={
            "title": "Com barra",
            "type": "SAÍDA",
            "amount": 10.0,
            "date": "2026-10-02",
            "category_id": default_category["id"],
            "account_id": default_account,
        },
        follow_redirects=False,
    )
    assert create.status_code == 201, create.text

    with_slash = client.get("/api/transactions/", follow_redirects=False)
    without_slash = client.get("/api/transactions", follow_redirects=False)

    assert with_slash.status_code == 200
    assert without_slash.status_code == 200
    assert with_slash.json() == without_slash.json()


def test_specific_route_works_in_both_forms(client, default_category):
    """Rota **específica** (com parâmetro de caminho).

    Hoje a Vercel remove a barra, então esta forma nunca chegaria pelo rewrite —
    mas o invariante é "nenhum redirect em rota nenhuma", e depender de qual
    forma a plataforma entrega é justamente o que criou o defeito.
    """
    cid = default_category["id"]

    without_slash = client.patch(
        f"/api/categories/{cid}", json={"budget": 100.0}, follow_redirects=False
    )
    with_slash = client.patch(
        f"/api/categories/{cid}/", json={"budget": 200.0}, follow_redirects=False
    )

    assert without_slash.status_code == 200
    assert with_slash.status_code == 200
    assert with_slash.json()["budget"] == "200.00"


def test_non_api_routes_also_tolerate_the_slash(anon_client):
    """`/health` é o alvo do smoke pós-deploy e do monitoramento.

    Normalizar só `/api/` deixaria `/health/` em 404 — e quem escreve URL de
    monitoramento à mão acerta a barra por acidente, não por leitura da
    tabela.
    """
    assert anon_client.get("/health", follow_redirects=False).status_code == 200
    assert anon_client.get("/health/", follow_redirects=False).status_code == 200


def test_the_root_path_still_works(anon_client):
    """A raiz é `/` e **não** pode ser normalizada para string vazia."""
    assert anon_client.get("/", follow_redirects=False).status_code == 200
