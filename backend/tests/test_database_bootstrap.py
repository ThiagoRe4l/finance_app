"""Preparação de filesystem no import de `app.database`.

Escrito **antes** da correção, conforme o processo do CLAUDE.md.

O que aconteceu no primeiro CI
------------------------------
`backend` e `backend-postgres` falharam os dois com `PermissionError` ao tentar
criar `/workspace` em `os.makedirs`.

⚠️ **A causa não é a que o traceback sugere.** O `makedirs` **não** roda
incondicionalmente: ele é guardado por `sqlite_path_from_url`, que devolve
`None` para Postgres — verificado. O que acontece é outra coisa:

1. **Nenhum dos dois jobs define `DATABASE_URL`** — o de Postgres define só
   `TEST_DATABASE_URL`, que governa o engine da *suíte*, não o da aplicação.
2. No runner não existe `backend/.env.local`, então nada preenche a variável.
3. `resolve_database_url()` cai no **default**, que era
   `sqlite:////workspace/backend/database.db` — caminho absoluto específico do
   container de desenvolvimento.
4. O guard então acerta ao ver uma URL SQLite, e tenta criar `/workspace`, que
   exige escrever na raiz do filesystem.

Ou seja: o guard funciona, e o defeito é o **default** ser um caminho absoluto
que só existe numa máquina. O sintoma apareceu no `makedirs` porque é a
primeira linha que toca o disco.

Consequência que passou despercebida junto: no job `backend-postgres`, o engine
da **aplicação** nunca foi Postgres — era o SQLite do default. O job testava
Postgres só no engine da suíte.
"""

import os
import pathlib


def _database():
    """Import tardio: `prepare_sqlite_directory` ainda não existe."""
    from app import database

    return database


def _settings():
    from app import settings

    return settings


class _MakedirsSpy:
    """Registra chamadas em vez de tocar o disco.

    Injetado em vez de `monkeypatch.setattr(os, "makedirs", ...)` porque o alvo
    do teste é *não haver chamada*, e um patch global tornaria impossível
    distinguir "não chamou" de "chamou outra coisa".
    """

    def __init__(self):
        self.calls = []

    def __call__(self, path, exist_ok=False):
        self.calls.append(path)


# ---------------------------------------------------------------------------
# Postgres não pode encostar em caminho de SQLite
# ---------------------------------------------------------------------------

def test_postgres_url_creates_no_directory():
    """🔴 O caso do job `backend-postgres`.

    Com Postgres não existe arquivo de banco, então não existe diretório a
    preparar — e tentar é como o job morreu.
    """
    spy = _MakedirsSpy()

    result = _database().prepare_sqlite_directory(
        "postgresql+psycopg://u:p@h/d", makedirs=spy
    )

    assert result is None
    assert spy.calls == []


def test_bare_postgres_url_creates_no_directory():
    """A URL crua do painel do Neon, antes da normalização.

    Esta função não pode depender de `normalize_database_url` ter rodado: errar
    para o lado de "é SQLite" é exatamente o que derrubou o CI.
    """
    spy = _MakedirsSpy()

    assert _database().prepare_sqlite_directory("postgresql://u:p@h/d", makedirs=spy) is None
    assert spy.calls == []


def test_in_memory_sqlite_creates_no_directory():
    """`sqlite://` não tem arquivo — é o que a suíte usa."""
    spy = _MakedirsSpy()

    assert _database().prepare_sqlite_directory("sqlite://", makedirs=spy) is None
    assert spy.calls == []


def test_relative_sqlite_creates_no_directory():
    """Caminho relativo depende do diretório de trabalho do processo.

    Criar diretório a partir dele é imprevisível — e o projeto não usa esse
    formato em lugar nenhum (o default leva quatro barras).
    """
    spy = _MakedirsSpy()

    assert _database().prepare_sqlite_directory("sqlite:///relativo.db", makedirs=spy) is None
    assert spy.calls == []


# ---------------------------------------------------------------------------
# SQLite absoluto: aí sim
# ---------------------------------------------------------------------------

def test_absolute_sqlite_prepares_its_directory():
    """O caso que a função existe para servir: volume ou pasta nova.

    O SQLite não cria diretório — sem isto, o primeiro boot falharia com
    "unable to open database file".
    """
    spy = _MakedirsSpy()

    result = _database().prepare_sqlite_directory("sqlite:////var/data/app.db", makedirs=spy)

    assert result == "/var/data"
    assert spy.calls == ["/var/data"]


# ---------------------------------------------------------------------------
# O default não pode ser específico de uma máquina
# ---------------------------------------------------------------------------

def test_the_default_database_lives_inside_the_backend_package():
    """🔴 A causa raiz.

    O default era `/workspace/backend/database.db`, caminho do container de
    desenvolvimento. Em qualquer outra máquina — runner do CI, laptop — ele
    aponta para um lugar que não existe, e o `makedirs` tenta criá-lo na raiz.

    Derivado de `__file__`, acompanha o checkout. É o mesmo padrão que
    `ENV_FILE` já usa.
    """
    backend_dir = pathlib.Path(__file__).resolve().parent.parent
    expected = backend_dir / "database.db"

    assert _settings().DEFAULT_DATABASE_URL == f"sqlite:///{expected}"


def test_the_default_is_an_absolute_sqlite_url():
    """Quatro barras: com três, o SQLAlchemy trata como caminho relativo e o
    banco nasce no diretório de trabalho de quem chamou."""
    assert _settings().DEFAULT_DATABASE_URL.startswith("sqlite:////")


def test_the_default_directory_already_exists():
    """O par do teste acima, pelo lado observável.

    Apontando para dentro do pacote, o diretório **já existe** e o `makedirs`
    do import é no-op — nunca mais há criação de diretório no caminho default.
    Era a criação que explodia.
    """
    path = _settings().sqlite_path_from_url(_settings().DEFAULT_DATABASE_URL)

    assert os.path.isdir(os.path.dirname(path))


# ---------------------------------------------------------------------------
# ⚠️ Falso verde, e o teste que o contorna
# ---------------------------------------------------------------------------
#
# `test_the_default_database_lives_inside_the_backend_package` **já passava**
# antes da correção — e não por acidente de escrita: neste container o caminho
# derivado de `__file__` e o literal `/workspace/backend` são **o mesmo**. O
# teste só ficaria vermelho numa máquina onde o checkout mora em outro lugar,
# que é exatamente a máquina onde o bug aparece e onde eu não rodo.
#
# Ele continua valendo (pega regressão para um literal *diferente*, e documenta
# a intenção), mas não prova a correção aqui. O teste abaixo prova: olha o
# código-fonte e exige que o caminho seja **derivado**, não escrito. É contrato
# sobre arquivo, no mesmo espírito de `test_every_requirement_is_pinned`.

def test_no_module_hardcodes_a_machine_specific_path():
    """🔴 Verificável nesta máquina, ao contrário do teste acima.

    `/workspace` é o bind mount do container de desenvolvimento. Nenhum
    caminho absoluto dele pode estar escrito no código: no runner do CI e em
    qualquer laptop ele não existe, e foi assim que os dois jobs morreram.

    `ENV_FILE` já derivava de `__file__`; o default do banco passou a derivar
    do mesmo lugar.

    ⚠️ **Cobre o pacote inteiro, não só `settings.py`.** A primeira versão
    olhava um arquivo só — e o mesmo literal pode nascer em qualquer módulo que
    precise de caminho. Varrer `app/` custa o mesmo e fecha a classe toda.
    """
    app_dir = pathlib.Path(__file__).resolve().parent.parent / "app"

    offending = []
    for module in sorted(app_dir.rglob("*.py")):
        for number, line in enumerate(module.read_text(encoding="utf-8").splitlines(), 1):
            if "/workspace" in line and not line.strip().startswith("#"):
                offending.append(f"{module.name}:{number}: {line.strip()}")

    assert not offending, (
        "caminho específico do container de desenvolvimento no código: "
        + " | ".join(offending)
    )
