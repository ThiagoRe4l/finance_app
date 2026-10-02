"""Carregamento condicional de `backend/.env.local`.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Por que isto merece teste
-------------------------
O carregamento é condicional em **duas** dimensões — o arquivo existir e a
biblioteca estar instalada — e a segunda só é falsa em **produção**, onde
`python-dotenv` não é instalado (fica em `requirements-dev.txt`). Ou seja: o
caminho que mais importa não acertar é justamente o que nunca roda localmente.
Sem teste, um `ImportError` não tratado derrubaria a função serverless inteira
no primeiro import, e isso só apareceria no deploy.

A precedência é a outra metade: variável real de ambiente tem que vencer o
arquivo. O contrário faria um `.env.local` esquecido numa máquina sobrescrever
a configuração de produção.
"""

import pathlib
import sys

import pytest


def _settings():
    """Import tardio — ver a explicação em `test_settings.py`."""
    from app import settings

    return settings


# ---------------------------------------------------------------------------
# Nome e localização
# ---------------------------------------------------------------------------

def test_env_file_is_looked_up_inside_backend():
    """🔴 O arquivo é `backend/.env.local`, não na raiz do repositório.

    Estava na raiz e era ignorado por completo. A localização faz parte do
    contrato: é onde o backend roda e onde a documentação manda colocá-lo.
    """
    path = _settings().ENV_FILE

    assert path.name == ".env.local"
    assert path.parent == pathlib.Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Condicional ao arquivo existir
# ---------------------------------------------------------------------------

def test_missing_file_is_a_silent_noop(tmp_path):
    """Sem arquivo, nada acontece — e não levanta.

    É o caminho de toda máquina que nunca criou o arquivo, e o de produção.
    """
    assert _settings().load_env_file(tmp_path / "nao-existe", env={}) is False


def test_values_are_loaded_from_the_file(tmp_path):
    env_file = tmp_path / ".env.local"
    env_file.write_text("DATABASE_URL=postgresql+psycopg://u:p@h/d\n", encoding="utf-8")
    env = {}

    assert _settings().load_env_file(env_file, env=env) is True
    assert env["DATABASE_URL"] == "postgresql+psycopg://u:p@h/d"


def test_comments_and_blank_lines_are_ignored(tmp_path):
    """O `.env.example` é todo comentado; copiá-lo para `.env.local` é o fluxo
    natural, e um comentário virando variável daria erro obscuro."""
    env_file = tmp_path / ".env.local"
    env_file.write_text(
        "# comentário\n\nCORS_ALLOW_ORIGINS=https://a.example\n", encoding="utf-8"
    )
    env = {}

    _settings().load_env_file(env_file, env=env)

    assert env == {"CORS_ALLOW_ORIGINS": "https://a.example"}


# ---------------------------------------------------------------------------
# Precedência: ambiente real vence o arquivo
# ---------------------------------------------------------------------------

def test_existing_variable_is_not_overridden(tmp_path):
    """🔴 `override=False`. O pior modo de falha deste arquivo.

    Na Vercel a variável vem da plataforma. Se o arquivo vencesse, um
    `.env.local` esquecido no deploy apontaria produção para outro banco — e o
    sintoma seria dado faltando, não erro.
    """
    env_file = tmp_path / ".env.local"
    env_file.write_text("DATABASE_URL=postgresql+psycopg://do-arquivo/d\n", encoding="utf-8")
    env = {"DATABASE_URL": "postgresql+psycopg://do-ambiente/d"}

    _settings().load_env_file(env_file, env=env)

    assert env["DATABASE_URL"] == "postgresql+psycopg://do-ambiente/d"


# ---------------------------------------------------------------------------
# Condicional à biblioteca estar instalada (o caminho de produção)
# ---------------------------------------------------------------------------

def test_absent_dotenv_library_is_a_silent_noop(tmp_path, monkeypatch):
    """🔴 Em produção `python-dotenv` NÃO está instalado (é dev-only).

    Um `ImportError` não tratado aqui derrubaria a função serverless no
    primeiro import, e só apareceria no deploy. Este teste simula a ausência
    da biblioteca escondendo-a do `sys.modules`.
    """
    env_file = tmp_path / ".env.local"
    env_file.write_text("DATABASE_URL=postgresql+psycopg://u:p@h/d\n", encoding="utf-8")
    monkeypatch.setitem(sys.modules, "dotenv", None)
    env = {}

    assert _settings().load_env_file(env_file, env=env) is False
    assert env == {}


# ---------------------------------------------------------------------------
# Guard: a suíte não pode acabar apontando para produção
# ---------------------------------------------------------------------------

def test_test_suite_engine_is_never_the_production_database():
    """🔴 O risco que o carregamento automático cria.

    `.env.local` guarda a URL do **Neon de produção**, e `app/database.py` cria
    o engine no import. Com carregamento automático, rodar `pytest` numa
    máquina com esse arquivo passaria a tocar produção.

    A insulação é a variável `TEST_DATABASE_URL`, separada de `DATABASE_URL` de
    propósito. Este teste trava o invariante — sem ele a proteção seria
    coincidência de nomes, e ninguém notaria se alguém "simplificasse" o
    `conftest.py` para reusar `resolve_database_url()`.
    """
    from tests.conftest import TEST_DATABASE_URL, engine

    assert "neon.tech" not in TEST_DATABASE_URL
    assert "neon.tech" not in str(engine.url)
