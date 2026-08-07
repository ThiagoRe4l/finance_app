import os
from sqlalchemy import create_engine, event
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


def enable_sqlite_foreign_keys(target_engine):
    """Liga o enforcement de foreign keys em cada conexão do engine.

    O SQLite abre toda conexão com `PRAGMA foreign_keys = 0`. Sem este listener,
    os `ondelete` declarados nos models são puramente decorativos: o banco aceita
    linha órfã e ignora CASCADE/SET NULL/RESTRICT em silêncio.

    Recebe o engine por parâmetro (em vez de fechar sobre o global) para que a
    suíte de testes possa aplicar exatamente o mesmo listener no engine em
    memória — se o PRAGMA fosse ligado só do lado do teste, a suíte ficaria
    verde com a aplicação real rodando sem enforcement nenhum.
    """
    @event.listens_for(target_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return target_engine


enable_sqlite_foreign_keys(engine)

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
