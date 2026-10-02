import os
from typing import Optional

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.settings import engine_options_for, resolve_database_url, sqlite_path_from_url

# Vem de `DATABASE_URL`; sem a variável, o mesmo caminho que era hardcoded aqui.
# A resolução mora em `app/settings.py` porque o engine é criado no import deste
# módulo — ver a explicação lá.
SQLALCHEMY_DATABASE_URL = resolve_database_url()

def prepare_sqlite_directory(url: str, makedirs=os.makedirs) -> Optional[str]:
    """Cria o diretório do arquivo SQLite, se houver arquivo. Devolve o que criou.

    Existe para o caso do volume ou da pasta nova: o SQLite **não** cria
    diretório, e sem isto o primeiro boot falharia com "unable to open database
    file".

    ⚠️ **Só age quando o banco em uso é SQLite com caminho absoluto.** Postgres,
    SQLite em memória e caminho relativo devolvem `None` sem tocar o disco — o
    último porque depende do diretório de trabalho do processo, e criar
    diretório a partir dele é imprevisível.

    `makedirs` é injetável para que o teste possa verificar **a ausência de
    chamada**, que é o comportamento que importa no caminho Postgres. Com
    `monkeypatch` global não haveria como distinguir "não chamou" de "chamou
    outra coisa".
    """
    path = sqlite_path_from_url(url)
    if path is None:
        return None

    directory = os.path.dirname(path)
    if not directory:
        return None

    makedirs(directory, exist_ok=True)

    return directory


prepare_sqlite_directory(SQLALCHEMY_DATABASE_URL)

# As opções dependem do dialeto — ver `engine_options_for`. SQLite e Postgres
# precisam de argumentos que quebram um no outro.
engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_options_for(SQLALCHEMY_DATABASE_URL))


def should_enable_sqlite_foreign_keys(url: str) -> bool:
    """O listener de PRAGMA só faz sentido no SQLite.

    O Postgres aplica FK nativamente e sempre; `PRAGMA foreign_keys` nem é
    sintaxe válida lá. Mas o listener **não pode simplesmente sair** (D-Vercel-4):
    o desenvolvimento local continua em SQLite, e sem ele o banco local volta a
    aceitar linha órfã em silêncio — o que transformaria `test_fk_cascade.py`
    inteiro em teste de nada.
    """
    return url.startswith("sqlite")


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


if should_enable_sqlite_foreign_keys(SQLALCHEMY_DATABASE_URL):
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
