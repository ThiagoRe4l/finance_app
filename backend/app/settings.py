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
import pathlib
from typing import Any, Mapping, MutableMapping, Optional

# Arquivo de ambiente do desenvolvimento local.
#
# Fica em `backend/`, não na raiz: é onde o backend roda e onde a documentação
# manda colocá-lo. Está no `.gitignore` e nunca deve ser versionado — guarda a
# credencial do Neon.
ENV_FILE = pathlib.Path(__file__).resolve().parent.parent / ".env.local"


def load_env_file(
    path: pathlib.Path = ENV_FILE,
    env: Optional[MutableMapping[str, str]] = None,
) -> bool:
    """Carrega `path` no ambiente, se der. Devolve se carregou algo.

    **Condicional em duas dimensões**, e a segunda é a que importa não errar:

    1. **O arquivo existir.** Toda máquina que nunca o criou segue funcionando
       com os defaults — é o que mantém `pytest` e `docker compose up`
       independentes de configuração.
    2. **`python-dotenv` estar instalado.** Ele vive em `requirements-dev.txt`:
       na Vercel as variáveis são injetadas pela plataforma e carregar arquivo
       seria peso morto. Em produção este import falha, e um `ImportError` não
       tratado derrubaria a função serverless no **primeiro import** — falha que
       só apareceria no deploy. Daí o `except` largo e o no-op silencioso.

    ⚠️ **`override=False`: variável real de ambiente sempre vence o arquivo.**
    O contrário é o pior modo de falha possível aqui — um `.env.local` esquecido
    apontaria a produção para outro banco, e o sintoma seria dado faltando, não
    erro.
    """
    if env is None:
        env = os.environ

    if not path.is_file():
        return False

    try:
        from dotenv import dotenv_values
    except ImportError:
        return False

    # `dotenv_values` em vez de `load_dotenv`: devolve o conteúdo em vez de
    # escrever direto em `os.environ`, e é o que permite receber o mapeamento
    # por parâmetro — mesma razão de `resolve_*` não lerem `os.environ` no meio
    # do módulo. Sem isso, o teste de precedência precisaria mexer no ambiente
    # real do processo.
    for key, value in dotenv_values(path).items():
        if value is not None and key not in env:
            env[key] = value

    return True


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


# Carrega o arquivo no import deste módulo.
#
# Efeito colateral de import é coisa que este projeto evita — aqui é
# deliberado, e a alternativa é pior: chamar `load_env_file()` dentro de
# `database.py` tornaria a configuração **dependente de ordem de import**, e
# `main.py` resolve o CORS depois de importar os routers. Um dia alguém
# reordena os imports e o CORS passa a ler o ambiente antes de ele existir.
#
# É no-op quando o arquivo não existe (toda máquina de CI) ou quando
# `python-dotenv` não está instalado (produção).
load_env_file()


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


def engine_options_for(url: str) -> dict[str, Any]:
    """Argumentos de `create_engine` que dependem do dialeto.

    Existe porque o projeto passa a rodar em **dois** bancos: SQLite no
    desenvolvimento local e Postgres em produção (D-Vercel-1). Cada um precisa
    de opções que quebram no outro.

    SQLite
    ------
    `check_same_thread=False` é exclusivo do driver `sqlite3` e o psycopg
    rejeita o argumento. Sem `poolclass`: o pool default do SQLAlchemy serve, e
    não há pooler externo com quem coordenar.

    Postgres
    --------
    `poolclass=NullPool` — cada instância serverless importa `database.py` e
    criaria o próprio pool. Empilhado sobre o pooler do Neon, dá dois níveis de
    pooling e estoura o limite de conexões do free tier. Com `NullPool` a
    conexão é aberta e fechada por request e o pooling fica com quem sabe
    fazê-lo.

    🔴 `prepare_threshold=None` — **a armadilha desta fatia.** O psycopg3
    promove queries a *prepared statements* depois de algumas execuções. O
    pooler em transaction mode não garante a mesma sessão entre elas, e a query
    falha com `prepared statement "_pg3_0" does not exist`: **intermitente, só
    sob concorrência, e invisível em conexão direta**. Nenhum teste de
    integração pega isso — daí o contrato estar travado por teste unitário.
    """
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}

    from sqlalchemy.pool import NullPool

    return {
        "connect_args": {"prepare_threshold": None},
        "poolclass": NullPool,
    }
