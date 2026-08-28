"""Configuração por variável de ambiente — contrato do deploy no Railway.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
Cobre as decisões D-Deploy-2 (`DATABASE_URL`), D-Deploy-5 (`requirements`) e
D-Deploy-6 (CORS).

Por que função pura, e não leitura direta de `os.environ`
---------------------------------------------------------
`app/database.py` cria o engine **no import**. Config lida no meio do módulo
só seria testável com `importlib.reload`, que é frágil e contamina o resto da
suíte. `resolve_*` recebe o ambiente por parâmetro pelo mesmo motivo que
`enable_sqlite_foreign_keys` recebe o engine: para que o teste exercite
exatamente a função que a aplicação usa, sem uma segunda implementação.
"""



def _settings():
    """Import **tardio**, de propósito.

    Na etapa vermelha `app/settings.py` ainda não existe. Um import no topo do
    arquivo derrubaria a **coleção da suíte inteira** — os 256 testes verdes
    parariam de rodar junto, e `pytest` deixaria de dar qualquer sinal sobre o
    resto do projeto. Assim cada teste daqui falha sozinho, com
    `ModuleNotFoundError` na própria mensagem, e o resto continua verde.

    Some quando a implementação existir; até lá é o que mantém a suíte legível.
    """
    from app import settings

    return settings


# ---------------------------------------------------------------------------
# DATABASE_URL
# ---------------------------------------------------------------------------

def test_database_url_defaults_to_todays_hardcoded_path():
    """Sem a variável, o comportamento é **idêntico** ao de hoje.

    O default não é conveniência: sem ele, `pytest` e `docker compose up`
    passariam a exigir `.env`, e "suíte verde é obrigatória" viraria refém de
    configuração de ambiente.
    """
    assert _settings().resolve_database_url({}) == "sqlite:////workspace/backend/database.db"


def test_database_url_comes_from_the_environment():
    assert _settings().resolve_database_url(
        {"DATABASE_URL": "sqlite:////data/database.db"}
    ) == "sqlite:////data/database.db"


def test_absolute_sqlite_url_keeps_four_slashes():
    """🔴 Três barras é caminho **relativo** para o SQLAlchemy.

    Com `sqlite:///data/database.db` o banco nasce no diretório de trabalho do
    processo, fora do volume — e o erro só aparece no primeiro redeploy, quando
    o dado some. É o modo de falha mais caro desta fatia.
    """
    assert _settings().resolve_database_url({}).startswith("sqlite:////")


def test_blank_database_url_falls_back_to_the_default():
    """Campo definido em branco no painel do Railway é indistinguível de
    esquecido — os dois têm que cair no default, não gerar URL inválida."""
    assert _settings().resolve_database_url({"DATABASE_URL": "   "}) == _settings().resolve_database_url({})


# ---------------------------------------------------------------------------
# Diretório do volume
# ---------------------------------------------------------------------------

def test_sqlite_path_is_extracted_for_makedirs():
    """`database.py` precisa criar o diretório antes de abrir o banco.

    Num volume recém-criado o caminho pode não existir ainda.
    """
    assert _settings().sqlite_path_from_url("sqlite:////data/database.db") == "/data/database.db"


def test_non_sqlite_url_has_no_path_to_create():
    """Devolve `None` para Postgres em vez de levantar.

    É o que mantém a troca da D-Deploy-2 como mudança de config e não de
    código: `database.py` só chama `makedirs` quando há caminho.
    """
    assert _settings().sqlite_path_from_url("postgresql://user:pw@host:5432/finance") is None


# ---------------------------------------------------------------------------
# CORS (D-Deploy-6)
# ---------------------------------------------------------------------------

def test_cors_defaults_to_wildcard():
    """Desenvolvimento continua liberado, sem `.env`."""
    assert _settings().resolve_cors_origins({}) == ["*"]


def test_cors_reads_a_single_origin():
    assert _settings().resolve_cors_origins(
        {"CORS_ALLOW_ORIGINS": "https://front.up.railway.app"}
    ) == ["https://front.up.railway.app"]


def test_cors_splits_on_comma_and_trims_whitespace():
    """Painel do Railway é campo de texto: espaço depois da vírgula é o normal,
    e uma origem com espaço à esquerda nunca casa com o `Origin` do browser."""
    assert _settings().resolve_cors_origins(
        {"CORS_ALLOW_ORIGINS": "https://a.up.railway.app, https://b.up.railway.app"}
    ) == ["https://a.up.railway.app", "https://b.up.railway.app"]


def test_cors_blank_falls_back_to_wildcard():
    assert _settings().resolve_cors_origins({"CORS_ALLOW_ORIGINS": ""}) == ["*"]


# ---------------------------------------------------------------------------
# Opções do engine por dialeto (D-Vercel-1, D-Vercel-2 e o pool serverless)
# ---------------------------------------------------------------------------

def test_sqlite_keeps_check_same_thread():
    """🔴 `check_same_thread` é exclusivo do SQLite e quebra no psycopg.

    Hoje ele está fixo em `database.py`. Com dois dialetos, precisa ser
    decidido por URL.
    """
    options = _settings().engine_options_for("sqlite:////workspace/backend/database.db")

    assert options["connect_args"]["check_same_thread"] is False


def test_postgres_does_not_receive_sqlite_connect_args():
    options = _settings().engine_options_for("postgresql+psycopg://u:p@h/d")

    assert "check_same_thread" not in options["connect_args"]


def test_postgres_disables_prepared_statements():
    """🔴 A armadilha do pooler em transaction mode.

    O psycopg3 promove queries a prepared statements depois de algumas
    execuções. O pooler não garante a mesma sessão entre elas, e a query falha
    com `prepared statement "_pg3_0" does not exist` — intermitente, só sob
    concorrência, e invisível em conexão direta. Nenhum teste de integração
    pegaria isso; por isso o contrato é travado aqui.
    """
    options = _settings().engine_options_for("postgresql+psycopg://u:p@h/d")

    assert options["connect_args"]["prepare_threshold"] is None


def test_postgres_uses_null_pool():
    """Serverless: cada instância importa o módulo e criaria o próprio pool.

    Com o pooler externo do Neon, um pool do SQLAlchemy por instância empilha
    dois níveis de pooling e estoura o limite de conexões do free tier.
    """
    from sqlalchemy.pool import NullPool

    assert _settings().engine_options_for("postgresql+psycopg://u:p@h/d")["poolclass"] is NullPool


def test_sqlite_does_not_use_null_pool():
    """O SQLite local não tem pooler externo — `NullPool` aqui seria perda de
    desempenho sem contrapartida."""
    options = _settings().engine_options_for("sqlite:////tmp/x.db")

    assert "poolclass" not in options
