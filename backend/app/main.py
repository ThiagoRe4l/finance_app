"""Aplicação FastAPI.

⚠️ **`create_app` é fábrica, não decoração.** Ela recebe `local` em vez de
consultar o ambiente por dentro porque a D-Auth-8 desliga `/docs` fora do
desenvolvimento, e isso precisa ser testável sem `importlib.reload` nem
variável de ambiente no teste — mesma razão de `resolve_*` receberem o
ambiente.
"""

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import current_user
from app.settings import (
    is_local_environment,
    resolve_cors_origins,
    resolve_database_url,
)
from app.routers import (
    accounts,
    auth,
    transactions,
    investments,
    categories,
    installments,
    dashboard,
    reports,
    shared_expenses,
)

class NormalizeTrailingSlash:
    """Resolve `/x` e `/x/` para a **mesma** rota, sem redirect.

    🔴 Existe por causa de um defeito de produção. O FastAPI responde **307**
    quando a barra final não bate com a rota declarada, e o `Location` desse
    307 é **absoluto, montado a partir do host que o próprio backend vê** — o
    domínio do backend. Atrás do rewrite `/api` (D-Vercel-3) isso joga o
    browser cross-origin, e o cookie de sessão é host-only no domínio do
    **frontend** (D-Auth-3, sem `Domain`): não é enviado, e a requisição volta
    `401 "Não autenticado."`.

    Provado hop a hop em 02/10/2026: três telas quebradas, 2 redirects, URL
    final no domínio do backend — contra 0 redirects nas que funcionavam.

    ⚠️ **A Vercel remove a barra final; o FastAPI adiciona.** Os dois
    normalizam em direções opostas, então o backend nunca recebia a forma que
    exigia. Alinhar o `trailingSlash` da plataforma seria depender de
    comportamento que já mudou sem aviso duas vezes nesta sessão (o rewrite por
    caminho e o diretório de saída do build). Sem redirect, não há para onde o
    cookie se perder.

    A forma canônica das rotas passou a ser **sem** barra, e este middleware
    normaliza a outra para ela — em vez de duplicar 18 decoradores, que é o
    tipo de repetição em que alguém esquece um e o defeito volta numa rota só.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            # `len(path) > 1` protege a raiz: `/` não pode virar string vazia.
            if len(path) > 1 and path.endswith("/"):
                normalized = path.rstrip("/") or "/"
                scope = {**scope, "path": normalized}
                if scope.get("raw_path"):
                    # `raw_path` é bytes e carrega a query string; só o caminho
                    # é reescrito, o resto passa intacto.
                    raw, _, query = scope["raw_path"].partition(b"?")
                    stripped = raw.rstrip(b"/") or b"/"
                    scope["raw_path"] = stripped + (b"?" + query if query else b"")

        await self.app(scope, receive, send)


# Os routers de dados. Todos recebem a dependency de autenticação pelo
# `include_router`, e é isso que o teste de enumeração verifica — rota de `/api`
# sem a dependency é rota aberta.
DATA_ROUTERS = (
    accounts.router,
    transactions.router,
    investments.router,
    categories.router,
    installments.router,
    dashboard.router,
    reports.router,
    shared_expenses.router,
)


def create_app(local: bool) -> FastAPI:
    # 🔴 Fora do desenvolvimento, `/docs`, `/redoc` e `/openapi.json` saem do ar
    # (D-Auth-8). Com a API fechada, o schema aberto descreve a superfície
    # inteira — não é vulnerabilidade, é exposição gratuita.
    #
    # O `openapi.json` **versionado** continua sendo gerado por `app.openapi()`,
    # que não depende destas rotas: o item 3 do Checklist segue funcionando.
    docs_kwargs = (
        {}
        if local
        else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    )

    app = FastAPI(
        title="Finance App API",
        description="API para gestão de fluxo de caixa, contas bancárias e investimentos.",
        version="1.0.0",
        # 🔴 Desligado de propósito — ver `NormalizeTrailingSlash`. O default
        # `True` é a origem do 307 que fazia o cookie de sessão se perder atrás
        # do rewrite. Há teste assertando esta linha.
        redirect_slashes=False,
        **docs_kwargs,
    )

    # Antes de tudo: normaliza a barra final para a forma canônica das rotas.
    app.add_middleware(NormalizeTrailingSlash)

    # Configurações do CORS
    #
    # `allow_credentials=False` é decisão, não descuido (D-Deploy-6). A
    # combinação anterior — `allow_origins=["*"]` **com** credenciais — é
    # inválida pela especificação de CORS: o Starlette a contorna refletindo a
    # origem da requisição, o que na prática significa "aceita qualquer origem,
    # com credenciais".
    #
    # ⚠️ Continua `False` **mesmo com cookie de sessão**, e isso é intencional:
    # em produção o rewrite `/api` faz tudo ser mesma origem, e em
    # desenvolvimento o proxy do Vite faz o mesmo (D-Auth-7). Ligar credenciais
    # aqui reabriria a D-Deploy-6 sem necessidade — e é o que torna o CSRF
    # irrelevante junto do `SameSite=Lax`.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolve_cors_origins(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Autenticação primeiro, sem a dependency global: quem não tem sessão
    # precisa conseguir criar uma.
    app.include_router(auth.router, prefix="/api")

    for router in DATA_ROUTERS:
        app.include_router(router, prefix="/api", dependencies=[Depends(current_user)])

    @app.get("/")
    def read_root():
        return {"message": "Bem-vindo à API do Finance App!"}

    @app.get("/health")
    def health_check():
        """Pública: o smoke pós-deploy e o monitoramento batem aqui."""
        return {"status": "healthy"}

    return app


app = create_app(local=is_local_environment(resolve_database_url()))
