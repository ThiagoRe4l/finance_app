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

# Driver Postgres do projeto (D-Vercel-2): psycopg v3, não o psycopg2 legado.
POSTGRES_DRIVER = "postgresql+psycopg"

# Esquemas Postgres que chegam **sem** driver e precisam ganhar um.
# `postgres` é a forma curta que vários painéis ainda usam; o SQLAlchemy a
# rejeita desde a 1.4, com erro sobre plugin de dialeto que não ajuda ninguém.
BARE_POSTGRES_SCHEMES = ("postgresql", "postgres")


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


def normalize_database_url(url: str) -> str:
    """Garante um driver explícito em URL de Postgres.

    O console do Neon entrega `postgresql://` nu. O SQLAlchemy resolve esquema
    sem driver para o dialeto do **psycopg2**, que não está instalado — e a
    falha é `ModuleNotFoundError: No module named 'psycopg2'`, que não diz nada
    sobre o que está errado de verdade. Era o terceiro dos três problemas
    encontrados ao aplicar o schema no Neon, e o único que ficou sem correção
    de código: até aqui se consertava a URL à mão, o que resolvia uma string e
    não o problema.

    ⚠️ **Só preenche o que está ausente.** URL com driver explícito passa
    intacta, inclusive `postgresql+psycopg2://` e `postgresql+asyncpg://`:
    reescrevê-las seria trocar em silêncio uma escolha de quem as escreveu.
    SQLite também não é tocado.
    """
    scheme, separator, rest = url.partition("://")
    if not separator:
        return url
    if "+" in scheme or scheme.lower() not in BARE_POSTGRES_SCHEMES:
        return url

    return f"{POSTGRES_DRIVER}://{rest}"


def resolve_database_url(env: Mapping[str, str] = os.environ) -> str:
    """URL do banco. Sem `DATABASE_URL`, o caminho de sempre.

    O nome é `DATABASE_URL` e não `DATABASE_DIR` de propósito: é a convenção do
    ecossistema e é o que deixa a troca para Postgres ser mudança de config em
    vez de mudança de código (ver a alternativa descartada na D-Deploy-2).
    """
    return normalize_database_url(_value(env, "DATABASE_URL") or DEFAULT_DATABASE_URL)


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


# ---------------------------------------------------------------------------
# Ambiente: um conceito, não duas checagens (D-Auth-5 e D-Auth-8)
# ---------------------------------------------------------------------------

def is_local_environment(url: str) -> bool:
    """`True` no desenvolvimento local.

    A definição é a D-Vercel-1: **ambiente local é o que roda em SQLite.**
    Produção é Postgres no Neon, sempre.

    Existe nomeado **uma vez** porque duas decisões dependem de "estamos em
    desenvolvimento?" — o default de `SESSION_SECRET` (D-Auth-5) e o
    desligamento de `/docs` (D-Auth-8). Duas checagens ad-hoc é como as duas
    divergiriam depois, e uma delas divergindo para o lado errado abre a
    produção.

    ⚠️ Não depende de `normalize_database_url` ter rodado antes: um chamador
    futuro pode passar a URL crua, e errar para o lado de "é local"
    desativaria a exigência do segredo em produção.
    """
    return url.startswith("sqlite")


# ---------------------------------------------------------------------------
# Allowlist de e-mails (D-Auth-2)
# ---------------------------------------------------------------------------

def resolve_allowed_emails(env: Mapping[str, str] = os.environ) -> frozenset[str]:
    """E-mails autorizados a entrar, normalizados em minúsculo.

    Mesma forma de `resolve_cors_origins`: lista por vírgula, `strip` por item,
    itens vazios descartados.

    🔴 **Fail closed: variável ausente ou vazia devolve conjunto vazio, e
    ninguém entra.** É o oposto do padrão "todo default equivale ao
    comportamento de hoje" que vale para as outras variáveis — e é de
    propósito. O modo de falha do outro lado é liberar um app de finanças
    pessoais para qualquer conta Google do mundo.

    O minúsculo é obrigatório, não cosmético: o domínio de e-mail é
    case-insensitive por RFC, e o Google pode devolver a parte local com a
    caixa que a pessoa cadastrou. Guardar a allowlist com caixa diferente da
    claim recusaria um e-mail legítimo, e o sintoma ("allowlist não funciona")
    manda procurar no lugar errado.
    """
    raw = _value(env, "AUTH_ALLOWED_EMAILS")
    if raw is None:
        return frozenset()

    emails = (item.strip().lower() for item in raw.split(","))

    return frozenset(email for email in emails if email)


def is_email_allowed(email: str, allowed: frozenset[str]) -> bool:
    """Checagem case-insensitive contra a allowlist.

    E-mail vazio nunca passa, mesmo que a allowlist tenha uma entrada vazia —
    `resolve_allowed_emails` já descarta itens vazios, e esta é a segunda
    camada do mesmo cuidado.
    """
    if not email:
        return False

    return email.strip().lower() in allowed


# ---------------------------------------------------------------------------
# Segredo de sessão (D-Auth-5)
# ---------------------------------------------------------------------------

# ⚠️ Nomeado para ser impossível de confundir com um segredo de verdade. Se
# parecesse plausível, alguém o copiaria para a Vercel e as sessões passariam a
# ser forjáveis por quem leu o repositório. Há teste exigindo este formato.
DEV_SESSION_SECRET = "dev-only-insecure-session-secret-never-use-in-production"


def resolve_session_secret(env: Mapping[str, str] = os.environ) -> str:
    """Segredo que assina o cookie de sessão.

    🔴 **Esta função rompe deliberadamente a regra "toda variável tem default
    igual ao valor de hoje"**, registrada em "🔐 Variáveis de Ambiente". Segredo
    com default é segredo conhecido.

    A regra existia para `pytest` e `docker compose up` não passarem a exigir
    `.env`. Isso é preservado **só** no caminho local (SQLite). Em produção, a
    ausência é `RuntimeError` — barulhento, no boot, e não um 500 obscuro na
    primeira requisição autenticada.
    """
    secret = _value(env, "SESSION_SECRET")
    if secret:
        return secret

    if is_local_environment(resolve_database_url(env)):
        return DEV_SESSION_SECRET

    raise RuntimeError(
        "SESSION_SECRET é obrigatória fora do desenvolvimento local. "
        "Defina-a no projeto do backend na Vercel com um valor aleatório de "
        "pelo menos 32 bytes. Não há default: segredo com default é segredo "
        "conhecido, e qualquer pessoa com acesso ao repositório forjaria "
        "sessão para qualquer e-mail."
    )


def resolve_google_client_id(env: Mapping[str, str] = os.environ) -> str:
    """Client ID do OAuth do Google. Público — não é segredo (D-Auth-1).

    Devolve **string vazia** quando ausente, não `None`: vazio faz
    `verify_google_claims` recusar todo token (há teste), enquanto `None`
    arriscaria um `aud == None` casando com algo em algum caminho de
    comparação.
    """
    return _value(env, "GOOGLE_CLIENT_ID") or ""
