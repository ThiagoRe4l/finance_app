"""Configuração de deploy na Vercel — contrato sobre arquivo.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Os dois invariantes aqui nasceram de falhas reais em produção, e nenhum dos
dois é verificável pela suíte de comportamento: são propriedades de arquivos de
configuração que só a plataforma interpreta.

1. **Nenhum rewrite do backend com `destination` de caminho.** O backend
   deployado devolvia `{"detail":"Not Found"}` em **toda** rota, inclusive
   `/health`. A causa estava em `backend/vercel.json`:

       {"rewrites": [{"source": "/(.*)", "destination": "/api/index"}]}

   O log de build da Vercel explicitou o mecanismo:

       WARNING! Internal rewrites in backend framework projects now route
       requests using the rewritten destination path.

   Ou seja, o `destination` passou a ser o caminho que roteia a requisição, e o
   app ASGI recebia `/api/index` em toda chamada — rota que ele não tem. A
   Vercel detecta o FastAPI nativamente ("backend framework project") e já
   roteia para o app; o rewrite competia com isso e vencia.

2. **A versão do Python de produção tem que bater com a do CI.** O log
   mostrou `Using python version: 3.12`, porque não havia `.python-version`,
   enquanto a `.venv` e os dois jobs de CI rodam **3.11**. Divergência dev/prod
   silenciosa — nada quebrou ainda, e é exatamente a classe de problema que a
   D-Vercel-1 existe para evitar.
"""

import json
import pathlib
import re

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
CI_WORKFLOW = REPO_DIR / ".github" / "workflows" / "ci.yml"


# ---------------------------------------------------------------------------
# 1. Rewrites do backend
# ---------------------------------------------------------------------------

def test_backend_declares_no_path_destination_rewrite():
    """🔴 O defeito que devolvia 404 em toda rota do backend.

    O teste **não** exige que `backend/vercel.json` não exista: um dia pode ser
    preciso declarar `headers`, `regions` ou `maxDuration` ali. O que não pode
    voltar é rewrite cujo `destination` seja um **caminho** — porque é o
    caminho, e não o arquivo, que a Vercel passa a usar para rotear.

    `destination` com URL absoluta (`https://...`) é outra coisa: é proxy para
    outro projeto, que é o que o frontend faz de propósito.
    """
    config_file = BACKEND_DIR / "vercel.json"
    if not config_file.is_file():
        return  # sem config, sem rewrite — é o estado desejado

    config = json.loads(config_file.read_text(encoding="utf-8"))

    offending = [
        rewrite
        for rewrite in config.get("rewrites", [])
        if str(rewrite.get("destination", "")).startswith("/")
    ]

    assert not offending, (
        "rewrite com destination de caminho em backend/vercel.json — a Vercel "
        f"roteia pelo caminho reescrito e o app ASGI nunca vê a rota original: {offending}"
    )


def test_backend_declares_no_legacy_routes():
    """`routes` é mutuamente exclusivo com `rewrites`/`headers` e conflita com a
    detecção nativa de backend framework. Se um dia for necessário, que seja
    por decisão registrada — não por tentativa de contornar um 404."""
    config_file = BACKEND_DIR / "vercel.json"
    if not config_file.is_file():
        return

    config = json.loads(config_file.read_text(encoding="utf-8"))

    assert "routes" not in config


# ---------------------------------------------------------------------------
# 2. Versão do Python
# ---------------------------------------------------------------------------

def _pinned_python_version() -> str:
    return (BACKEND_DIR / ".python-version").read_text(encoding="utf-8").strip()


def _ci_python_versions() -> list[str]:
    """Versões declaradas nos `setup-python` do workflow.

    Lido por regex em vez de parser YAML de propósito: PyYAML não está
    instalado, e acrescentá-lo às dependências de teste para um assert sobre
    uma linha conhecida seria dependência nova por conveniência. A estrutura
    procurada é literal e estável.
    """
    source = CI_WORKFLOW.read_text(encoding="utf-8")

    return re.findall(r'python-version:\s*"([^"]+)"', source)


def test_python_version_is_pinned_for_vercel():
    """🔴 Sem `.python-version`, a Vercel escolhe a versão dela.

    Escolheu **3.12** no deploy real, contra 3.11 em todo o resto do projeto.
    """
    assert _pinned_python_version() == "3.11"


def test_the_pinned_version_matches_every_ci_job():
    """O pin só vale se não divergir do que a suíte exercita.

    Se o CI subir para 3.12 e este arquivo ficar em 3.11, produção passa a
    rodar numa versão que nenhum teste tocou — e o contrário é pior, porque a
    suíte ficaria verde contra um interpretador que não é o de produção.
    """
    versions = _ci_python_versions()

    assert versions, "nenhum setup-python encontrado no workflow"
    assert set(versions) == {_pinned_python_version()}
