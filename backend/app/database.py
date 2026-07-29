import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Define o caminho do banco de dados SQLite no workspace do backend
DATABASE_DIR = "/workspace/backend"
DATABASE_PATH = os.path.join(DATABASE_DIR, "database.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Garante que o diretório de persistência existe
os.makedirs(DATABASE_DIR, exist_ok=True)

# Cria o engine do SQLAlchemy (necessário para SQLite habilitar multithreading em desenvolvimento)
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# Cria a classe SessionLocal para sessões de banco de dados
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Classe Base moderna do SQLAlchemy 2.0 para modelos declarativos
class Base(DeclarativeBase):
    pass

# Dependency para obter a sessão do banco de dados nas rotas do FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
