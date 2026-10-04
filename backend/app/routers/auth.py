"""Endpoints de autenticação — D-Auth-1, D-Auth-3.

Três rotas: login com o ID token do Google, consulta da sessão e logout.

`/google` e `/logout` são **públicas** por necessidade (quem não tem sessão
precisa conseguir criar uma, e quem tem uma expirada precisa conseguir
descartá-la). `/me` exige sessão e devolve 401 sem ela — é assim que o gate do
front descobre que não há login. A lista de rotas públicas é travada por teste.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app import auth, models, settings
from app.tenancy import current_owner

router = APIRouter(prefix="/auth", tags=["Auth"])


class GoogleCredential(BaseModel):
    """Payload do botão do Google Identity Services.

    O campo chama `credential` porque é o nome que o GIS usa na resposta — o
    front repassa o que recebeu, sem renomear.
    """

    credential: str = Field(..., description="ID token (JWT) emitido pelo Google")


class SessionUser(BaseModel):
    email: str


def _set_session_cookie(response: Response, email: str) -> None:
    """Grava o cookie de sessão.

    🔴 **Sem `domain=`.** O cookie precisa colar no host que o browser pediu —
    o domínio do **frontend** — para voltar pelo rewrite `/api`. Com `domain`
    apontando para o domínio do backend, o browser **descarta** o cookie e o
    login falha sem erro legível em lugar nenhum (D-Auth-3).

    `secure` acompanha o ambiente: em `http://localhost` um cookie `Secure`
    não é gravado, e o login local pararia de funcionar.
    """
    local = settings.is_local_environment(settings.resolve_database_url())

    response.set_cookie(
        key=auth.SESSION_COOKIE,
        value=auth.issue_session(email, settings.resolve_session_secret()),
        max_age=int(auth.SESSION_MAX_AGE),
        httponly=True,
        secure=not local,
        samesite="lax",
        path="/",
    )


@router.post("/google", response_model=SessionUser)
def login_with_google(payload: GoogleCredential, response: Response):
    """Troca um ID token do Google por uma sessão.

    **401 e 403 significam coisas diferentes aqui, e a distinção é deliberada:**

    * **401** — o token não presta (assinatura, audiência, expirado).
    * **403** — o token é legítimo e a pessoa simplesmente não tem acesso.

    Em nenhum dos dois um cookie é emitido. Se um 403 deixasse sessão para
    trás, a allowlist viraria decoração.
    """
    try:
        email = auth.verify_google_id_token(
            payload.credential, settings.resolve_google_client_id()
        )
    except auth.InvalidGoogleToken:
        # Sem detalhar qual checagem falhou: dizer ao cliente *onde* o token
        # foi recusado é dar mapa para quem está tentando.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Não foi possível validar a credencial do Google.",
        )

    if not settings.is_email_allowed(email, settings.resolve_allowed_emails()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta conta não tem acesso ao aplicativo.",
        )

    _set_session_cookie(response, email)

    return SessionUser(email=email)


@router.get("/me", response_model=SessionUser)
def read_current_user(owner: models.User = Depends(current_owner)):
    """Quem está logado. 401 sem sessão — é o sinal que o gate do front lê.

    Passa por `current_owner`, e não só por `current_user`, porque é a
    **primeira chamada que o front faz**: é aqui que um usuário novo ganha conta
    e categorias, antes de qualquer tela pedir dado (D-Tenant-5).
    """
    return SessionUser(email=owner.email)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response):
    """Descarta a sessão. **Idempotente de propósito.**

    Não depende de `current_user`: cookie expirado ou ausente tem que poder ser
    limpo, senão a pessoa fica presa num estado que só o devtools resolve.
    """
    response.delete_cookie(key=auth.SESSION_COOKIE, path="/")
