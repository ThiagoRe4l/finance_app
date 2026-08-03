from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import accounts, transactions, investments, categories, installments, dashboard, reports

app = FastAPI(
    title="Finance App API",
    description="API para gestão de fluxo de caixa, contas bancárias e investimentos.",
    version="1.0.0"
)

# Configurações do CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permite todas as origens para facilidade em desenvolvimento e Docker
    allow_credentials=True,
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
