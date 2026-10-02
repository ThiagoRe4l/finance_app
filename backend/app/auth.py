"""Autenticação: sessão assinada e verificação do ID token do Google.

Decisões em "🔑 Autenticação" no CLAUDE.md (D-Auth-1 a D-Auth-8).

O módulo é pequeno de propósito. Ele decide se uma requisição é legítima, então
cada linha aqui vale mais do que uma linha de router — e quase toda a cobertura
é de **teste negativo**: o que importa não é o caminho felizssuceder, é nenhum
atalho funcionar.

Duas coisas que não são óbvias e são deliberadas:

* **A allowlist é reconferida em toda requisição**, não só no login. É isso que
  dá revogação sem tabela de sessão (D-Auth-2): tirar um e-mail da variável
  corta o acesso na requisição seguinte.
* **O algoritmo é conferido antes da chave.** `verify_google_id_token` lê o
  header e recusa o que não é RS256 *antes* de resolver a chave pública — sem
  isso, um token forjado dispararia busca de JWKS (rede) e, pior, abriria a
  porta para confusão de algoritmo.
"""

import datetime
from typing import Any, Mapping, Optional

import jwt
from fastapi import Depends, HTTPException, Request, status

from app import settings

SESSION_COOKIE = "session"

# 30 dias, deslizante (D-Auth-3): cada login renova a janela. Em segundos, para
# casar com o `max_age` do cookie sem conversão no caminho.
SESSION_MAX_AGE = datetime.timedelta(days=30).total_seconds()

SESSION_ALGORITHM = "HS256"

# O Google emite com as duas formas. Aceitar só uma recusa logins legítimos de
# forma intermitente, dependendo do que ele mandar.
GOOGLE_ISSUERS = frozenset({"https://accounts.google.com", "accounts.google.com"})

GOOGLE_ALGORITHM = "RS256"
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"


class InvalidGoogleToken(Exception):
    """ID token do Google que não pode virar sessão.

    Exceção única para **todos** os motivos de recusa — assinatura, claim,
    formato. O router a traduz em 401 sem detalhar a causa: dizer ao cliente
    *qual* checagem falhou é dar mapa para quem está tentando.
    """


# ---------------------------------------------------------------------------
# Sessão
# ---------------------------------------------------------------------------

def issue_session(
    email: str,
    secret: str,
    issued_at: Optional[datetime.datetime] = None,
) -> str:
    """Emite o token de sessão para `email`.

    `issued_at` é parâmetro para que o teste construa sessão antiga sem relógio
    falso — mesma razão de `resolve_*` receberem o ambiente.
    """
    if issued_at is None:
        issued_at = datetime.datetime.now(datetime.timezone.utc)

    payload = {
        "sub": email.strip().lower(),
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + datetime.timedelta(seconds=SESSION_MAX_AGE)).timestamp()),
    }

    return jwt.encode(payload, secret, algorithm=SESSION_ALGORITHM)


def read_session(token: str, secret: str) -> Optional[str]:
    """E-mail da sessão, ou `None` se o token não presta por qualquer motivo.

    Devolve `None` em vez de levantar porque **o cookie vem do cliente**:
    conteúdo arbitrário, expirado ou corrompido é entrada esperada, não
    excepcional. Levantar aqui viraria 500 para um caso de negócio normal
    (sessão velha).

    `algorithms=[SESSION_ALGORITHM]` é explícito: sem isso o PyJWT aceitaria
    `alg: none` e qualquer pessoa forjaria sessão para qualquer e-mail.
    """
    if not token:
        return None

    try:
        payload = jwt.decode(token, secret, algorithms=[SESSION_ALGORITHM])
    except jwt.InvalidTokenError:
        return None

    subject = payload.get("sub")

    return subject or None


# ---------------------------------------------------------------------------
# ID token do Google
# ---------------------------------------------------------------------------

def verify_google_claims(
    claims: Mapping[str, Any],
    client_id: str,
    now: Optional[datetime.datetime] = None,
) -> str:
    """Valida as claims de um ID token já decodificado e devolve o e-mail.

    Função separada da verificação de assinatura para poder ser testada sem
    rede e sem construir token: é aqui que vive a lógica que erra em silêncio.
    """
    if not client_id:
        # Sem `GOOGLE_CLIENT_ID` configurada, `aud == ""` casaria com string
        # vazia e a checagem de audiência viraria decoração.
        raise InvalidGoogleToken("GOOGLE_CLIENT_ID não configurada")

    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise InvalidGoogleToken("emissor inesperado")

    # 🔴 `aud` é o que amarra o token a ESTE app. Sem a checagem, um ID token
    # emitido para qualquer outro app Google do mundo viraria sessão aqui — e
    # qualquer pessoa consegue um, criando o próprio app.
    if claims.get("aud") != client_id:
        raise InvalidGoogleToken("audiência inesperada")

    # `is not True` e não `not ...`: claim ausente ou com valor estranho tem que
    # recusar. Ausência não é consentimento.
    if claims.get("email_verified") is not True:
        raise InvalidGoogleToken("e-mail não verificado pelo Google")

    email = claims.get("email")
    if not email:
        raise InvalidGoogleToken("token sem e-mail")

    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    expires_at = claims.get("exp")
    if not expires_at or int(expires_at) <= int(now.timestamp()):
        raise InvalidGoogleToken("token expirado")

    # Minúsculo porque a allowlist é guardada assim (D-Auth-2).
    return str(email).strip().lower()


def _default_signing_key(token: str) -> Any:
    """Chave pública do Google correspondente ao `kid` do token.

    `PyJWKClient` usa `urllib` da stdlib, então nenhum cliente HTTP novo entra
    em produção (D-Auth-4). A busca só acontece no login — toda requisição
    seguinte valida um HMAC local.
    """
    return jwt.PyJWKClient(GOOGLE_JWKS_URL).get_signing_key_from_jwt(token).key


def verify_google_id_token(
    token: str,
    client_id: str,
    signing_key_resolver=_default_signing_key,
) -> str:
    """Verifica assinatura **e** claims, devolvendo o e-mail.

    🔴 **O algoritmo é conferido antes de resolver a chave.** Se a verificação
    não fixasse RS256, um atacante assinaria um token com **HS256** usando a
    chave pública do Google (que é pública!) como segredo HMAC, e a biblioteca
    o validaria — a confusão de algoritmo, a falha clássica de JWT.

    Checar o header primeiro tem um segundo efeito: token forjado é recusado
    **sem** disparar busca de JWKS, então nem a rede é tocada e os testes
    rodam offline.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise InvalidGoogleToken("token malformado") from exc

    if header.get("alg") != GOOGLE_ALGORITHM:
        raise InvalidGoogleToken(f"algoritmo inesperado: {header.get('alg')!r}")

    try:
        key = signing_key_resolver(token)
        claims = jwt.decode(
            token,
            key,
            algorithms=[GOOGLE_ALGORITHM],
            audience=client_id,
            issuer=list(GOOGLE_ISSUERS),
        )
    except InvalidGoogleToken:
        raise
    except Exception as exc:
        # Largo de propósito: resolução de chave faz I/O e o PyJWT levanta
        # famílias diferentes. Nada disso pode escapar como 500 — a entrada é
        # do cliente.
        raise InvalidGoogleToken("assinatura inválida") from exc

    return verify_google_claims(claims, client_id)


# ---------------------------------------------------------------------------
# A dependency — a proteção de verdade (D-Auth-6)
# ---------------------------------------------------------------------------

def current_user(request: Request) -> str:
    """E-mail do usuário autenticado, ou 401.

    ⚠️ **Esta função é a proteção da API.** O gate do frontend é UX; o domínio
    do backend continua publicamente alcançável e o rewrite `/api` é
    conveniência de origem, não barreira de segurança.

    Duas checagens, não uma:

    1. o cookie está assinado e dentro da janela;
    2. **o e-mail continua na allowlist** — reconferido agora, não no login. É
       o que faz "tirar alguém do app" funcionar sem tabela de sessão
       (D-Auth-2).

    `settings.resolve_allowed_emails` é chamada pelo módulo, não importada
    direto, para que a leitura aconteça a cada requisição em vez de congelar no
    import.
    """
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado."
        )

    email = read_session(token, settings.resolve_session_secret())
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida ou expirada."
        )

    if not settings.is_email_allowed(email, settings.resolve_allowed_emails()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Acesso revogado."
        )

    return email
