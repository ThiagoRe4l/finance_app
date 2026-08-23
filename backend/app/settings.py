"""Configuração vinda do ambiente, resolvida por função pura.

Primeiro consumidor real de variável de ambiente no projeto — introduzido pela
fatia de deploy no Railway. Ver "🚢 Deploy — Railway" no CLAUDE.md.

Por que função pura em vez de ler `os.environ` no meio do módulo
---------------------------------------------------------------
`app/database.py` cria o engine **no import**. Config lida direto lá dentro só
seria testável com `importlib.reload`, que é frágil e contamina o resto da
suíte. Recebendo o ambiente por parâmetro, o teste exercita exatamente a função
que a aplicação usa — mesmo motivo de `enable_sqlite_foreign_keys` receber o
engine em vez de fechar sobre o global.

Regra comum às duas resoluções: **variável ausente e variável em branco caem no
mesmo default**. Campo definido vazio no painel do Railway é indistinguível de
campo esquecido, e o default é sempre o valor que o projeto já usava — sem
isso, `pytest` e `docker compose up` passariam a exigir `.env`.
"""

import os
from typing import Mapping, Optional

# Valor que estava hardcoded em `database.py` até a fatia de deploy.
#
# ⚠️ **Quatro barras.** `sqlite:///` (três) é caminho **relativo** ao diretório
# de trabalho do processo; a quarta barra é a raiz do caminho absoluto. Com três
# o banco nasce fora do volume e o dado some no primeiro redeploy — o modo de
# falha mais caro desta fatia, e o mais silencioso.
DEFAULT_DATABASE_URL = "sqlite:////workspace/backend/database.db"

# Liberado, como estava em `main.py`. Restringir é decisão de deploy (D-Deploy-6),
# não de desenvolvimento.
DEFAULT_CORS_ORIGINS = ["*"]

SQLITE_PREFIX = "sqlite:///"


def _value(env: Mapping[str, str], key: str) -> Optional[str]:
    raw = env.get(key)
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped or None


def resolve_database_url(env: Mapping[str, str] = os.environ) -> str:
    """URL do banco. Sem `DATABASE_URL`, o caminho de sempre.

    O nome é `DATABASE_URL` e não `DATABASE_DIR` de propósito: é a convenção do
    ecossistema e é o que deixa a troca para Postgres ser mudança de config em
    vez de mudança de código (ver a alternativa descartada na D-Deploy-2).
    """
    return _value(env, "DATABASE_URL") or DEFAULT_DATABASE_URL


def sqlite_path_from_url(url: str) -> Optional[str]:
    """Caminho do arquivo, para SQLite. `None` para qualquer outro banco.

    `database.py` precisa garantir o diretório antes de abrir a conexão — num
    volume recém-criado ele pode não existir. Devolver `None` em vez de
    levantar é o que mantém a porta do Postgres aberta: o chamador só cria
    diretório quando há diretório a criar.
    """
    if not url.startswith(SQLITE_PREFIX):
        return None

    path = url[len(SQLITE_PREFIX):]
    # SQLite em memória (`sqlite://`) e caminho relativo não têm diretório fixo
    # a criar; só o caminho absoluto (a quarta barra) interessa aqui.
    if not path.startswith("/"):
        return None

    return path


def resolve_cors_origins(env: Mapping[str, str] = os.environ) -> list[str]:
    """Origens permitidas. Lista separada por vírgula, ou `["*"]` por default.

    O `strip()` de cada item não é cosmético: o painel do Railway é campo de
    texto livre, espaço depois da vírgula é o natural de se digitar, e uma
    origem com espaço à esquerda nunca casa com o header `Origin` do browser —
    falharia como CORS bloqueado, sem dizer por quê.
    """
    raw = _value(env, "CORS_ALLOW_ORIGINS")
    if raw is None:
        return list(DEFAULT_CORS_ORIGINS)

    origins = [item.strip() for item in raw.split(",")]
    origins = [item for item in origins if item]

    return origins or list(DEFAULT_CORS_ORIGINS)
