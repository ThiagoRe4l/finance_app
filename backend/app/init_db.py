from app.database import engine, Base
# Importamos todos os modelos para garantir que são registrados na Base.metadata
from app.models import Account, Transaction, Investment, InvestmentHistory

def init_database():
    print("Criando tabelas no banco de dados SQLite...")
    Base.metadata.create_all(bind=engine)
    print("Banco de dados inicializado com sucesso!")

if __name__ == "__main__":
    init_database()
