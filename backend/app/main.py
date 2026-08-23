from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.settings import resolve_cors_origins
from app.routers import accounts, transactions, investments, categories, installments, dashboard, reports

app = FastAPI(
    title="Finance App API",
    description="API para gestão de fluxo de caixa, contas bancárias e investimentos.",
    version="1.0.0"
)

# Configurações do CORS
#
# `allow_credentials=False` é decisão, não descuido (D-Deploy-6). A combinação
# anterior — `allow_origins=["*"]` **com** credenciais — é inválida pela
# especificação de CORS: o Starlette a contorna refletindo a origem da
# requisição em vez de mandar `*`, o que na prática significa "aceita qualquer
# origem, com credenciais". O `apiFetch` do front não manda `credentials` em
# chamada nenhuma, então fechar não custa nada funcionalmente.
app.add_middleware(
    CORSMiddleware,
    allow_origins=resolve_cors_origins(),  # `*` em dev; domínio do front em produção
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registra os roteadores
app.include_router(accounts.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(investments.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(installments.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(reports.router, prefix="/api")

@app.get("/")
def read_root():
    return {"message": "Bem-vindo à API do Finance App!"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}
