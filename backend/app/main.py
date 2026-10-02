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
)

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
        **docs_kwargs,
    )

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
