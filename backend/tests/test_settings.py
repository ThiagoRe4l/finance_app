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

import pytest


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


# ---------------------------------------------------------------------------
# Normalização do esquema (fecha a pendência de 28/08/2026)
# ---------------------------------------------------------------------------
#
# O console do Neon entrega `postgresql://` nu. O SQLAlchemy resolve o esquema
# sem driver para o dialeto do **psycopg2**, que não está instalado — e a falha
# é `ModuleNotFoundError: No module named 'psycopg2'`, que não diz nada sobre o
# que está errado de verdade.
#
# Até aqui a correção era manual, no arquivo. Isso resolvia uma URL, não o
# problema: a próxima colada do painel esbarrava igual.

def test_bare_postgresql_scheme_gets_the_psycopg_driver():
    """🔴 O formato que o painel do Neon entrega."""
    assert _settings().resolve_database_url(
        {"DATABASE_URL": "postgresql://u:p@h/d"}
    ) == "postgresql+psycopg://u:p@h/d"


def test_explicit_psycopg_scheme_is_left_alone():
    """Idempotente: quem já colou no formato certo não vê diferença."""
    assert _settings().resolve_database_url(
        {"DATABASE_URL": "postgresql+psycopg://u:p@h/d"}
    ) == "postgresql+psycopg://u:p@h/d"


def test_short_postgres_scheme_is_also_normalized():
    """`postgres://` é a forma curta que vários painéis ainda usam.

    O SQLAlchemy a **rejeita** desde a 1.4, com erro sobre plugin de dialeto
    que não ajuda ninguém. Mesma classe de problema, mesma correção.
    """
    assert _settings().resolve_database_url(
        {"DATABASE_URL": "postgres://u:p@h/d"}
    ) == "postgresql+psycopg://u:p@h/d"


def test_an_explicit_other_driver_is_respected():
    """🔴 Driver explícito é escolha de quem escreveu — não se reescreve.

    Normalizar `postgresql+asyncpg://` para psycopg seria trocar o driver do
    usuário em silêncio. A normalização só preenche o que está **ausente**.
    """
    for url in (
        "postgresql+asyncpg://u:p@h/d",
        "postgresql+psycopg2://u:p@h/d",
    ):
        assert _settings().resolve_database_url({"DATABASE_URL": url}) == url


def test_sqlite_urls_are_untouched():
    assert _settings().resolve_database_url(
        {"DATABASE_URL": "sqlite:////data/database.db"}
    ) == "sqlite:////data/database.db"


def test_the_rest_of_the_url_survives_normalization():
    """Credencial, porta, caminho e query precisam passar intactos.

    A string do Neon tem `?sslmode=require`; perdê-la na reescrita derrubaria a
    conexão com erro de TLS, não de esquema.
    """
    normalized = _settings().resolve_database_url({
        "DATABASE_URL": "postgresql://user:s3nh%40@ep-x-pooler.aws.neon.tech:5432/neondb?sslmode=require"
    })

    assert normalized == (
        "postgresql+psycopg://user:s3nh%40@ep-x-pooler.aws.neon.tech:5432/neondb?sslmode=require"
    )


def test_the_default_sqlite_url_is_not_affected():
    """O caminho sem variável nenhuma continua idêntico."""
    assert _settings().resolve_database_url({}).startswith("sqlite:////")


# ---------------------------------------------------------------------------
# Ambiente local — conceito único (D-Auth-5 e D-Auth-8)
# ---------------------------------------------------------------------------
#
# "Estamos em desenvolvimento?" é respondido em UM lugar e consumido por duas
# decisões: o default de `SESSION_SECRET` e o desligamento de `/docs`. Duas
# checagens ad-hoc é como as duas divergiriam depois — e uma delas divergindo
# para o lado errado abre a produção.
#
# A definição é a D-Vercel-1: **ambiente local é o que roda em SQLite.**

def test_sqlite_is_the_local_environment():
    assert _settings().is_local_environment("sqlite:////workspace/backend/database.db") is True


def test_postgres_is_not_the_local_environment():
    assert _settings().is_local_environment("postgresql+psycopg://u:p@h/d") is False


def test_the_bare_postgres_scheme_is_also_not_local():
    """A normalização roda antes, mas esta função não pode depender disso: um
    chamador futuro pode passar a URL crua, e errar para o lado de "é local"
    desligaria a exigência do segredo em produção."""
    assert _settings().is_local_environment("postgresql://u:p@h/d") is False


# ---------------------------------------------------------------------------
# SESSION_SECRET (D-Auth-5)
# ---------------------------------------------------------------------------

def test_session_secret_comes_from_the_environment():
    assert _settings().resolve_session_secret(
        {"SESSION_SECRET": "s3gr3d0-de-verdade-com-tamanho", "DATABASE_URL": "sqlite://"}
    ) == "s3gr3d0-de-verdade-com-tamanho"


def test_missing_session_secret_is_fatal_in_production():
    """🔴 A quebra consciente do padrão "toda variável tem default".

    Segredo com default é segredo conhecido: qualquer pessoa com acesso ao
    repositório forjaria sessão para qualquer e-mail. Em produção, ausência tem
    que ser **erro de inicialização** — barulhento, no boot, não um 500 obscuro
    na primeira requisição.
    """
    with pytest.raises(RuntimeError, match="SESSION_SECRET"):
        _settings().resolve_session_secret({"DATABASE_URL": "postgresql+psycopg://u:p@h/d"})


def test_blank_session_secret_is_also_fatal_in_production():
    """Campo definido vazio no painel é indistinguível de esquecido."""
    with pytest.raises(RuntimeError, match="SESSION_SECRET"):
        _settings().resolve_session_secret({
            "SESSION_SECRET": "   ",
            "DATABASE_URL": "postgresql+psycopg://u:p@h/d",
        })


def test_local_development_gets_a_default_secret():
    """A regra original — `pytest` e `docker compose up` não passam a exigir
    `.env` — é preservada **só** no caminho SQLite."""
    secret = _settings().resolve_session_secret({"DATABASE_URL": "sqlite:////tmp/x.db"})

    assert secret


def test_the_development_default_is_not_usable_in_production():
    """O default local não pode ser um segredo plausível.

    Se ele parecer um segredo de verdade, alguém o copia para a Vercel e as
    sessões passam a ser forjáveis por quem leu o repositório. O valor é
    explicitamente marcado como inseguro.
    """
    secret = _settings().resolve_session_secret({"DATABASE_URL": "sqlite://"})

    assert "insecure" in secret.lower() or "dev" in secret.lower()


# ---------------------------------------------------------------------------
# GOOGLE_CLIENT_ID
# ---------------------------------------------------------------------------

def test_google_client_id_comes_from_the_environment():
    assert _settings().resolve_google_client_id(
        {"GOOGLE_CLIENT_ID": "123-abc.apps.googleusercontent.com"}
    ) == "123-abc.apps.googleusercontent.com"


def test_missing_google_client_id_is_empty_not_none():
    """Vazio faz `verify_google_claims` recusar tudo — ver
    `test_empty_client_id_rejects_everything`. `None` arriscaria um
    `aud == None` casando com algo em algum caminho de comparação."""
    assert _settings().resolve_google_client_id({}) == ""
