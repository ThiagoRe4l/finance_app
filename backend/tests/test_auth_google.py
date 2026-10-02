"""Validação do ID token do Google — D-Auth-1.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

**Nenhum teste aqui fala com o Google.** A validação de claims é função pura
que recebe o payload já decodificado; a verificação de assinatura recebe o
resolvedor de chave por parâmetro. É a mesma razão de `resolve_*` receberem o
ambiente: sem injeção, este arquivo seria um teste de rede, lento e instável —
e o caminho sensível ficaria sem cobertura.

Todo teste negativo aqui corresponde a um token que um atacante consegue
produzir sozinho. Nenhum deles pode virar sessão.
"""

import datetime

import pytest

CLIENT_ID = "123456789-abc.apps.googleusercontent.com"


def _auth():
    from app import auth

    return auth


def _claims(**overrides):
    """Payload de um ID token válido do Google."""
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    payload = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "1234567890",
        "email": "pessoa@example.com",
        "email_verified": True,
        "exp": now + 3600,
        "iat": now,
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# O caminho válido
# ---------------------------------------------------------------------------

def test_valid_claims_yield_the_email():
    assert _auth().verify_google_claims(_claims(), CLIENT_ID) == "pessoa@example.com"


def test_the_alternative_issuer_is_accepted():
    """O Google emite com `accounts.google.com` **e** com
    `https://accounts.google.com`. Aceitar só um recusa logins legítimos de
    forma intermitente, dependendo do que o Google mandar."""
    assert _auth().verify_google_claims(
        _claims(iss="accounts.google.com"), CLIENT_ID
    ) == "pessoa@example.com"


def test_the_returned_email_is_normalized():
    """A allowlist guarda minúsculo (D-Auth-2); a claim pode vir com caixa."""
    assert _auth().verify_google_claims(
        _claims(email="Pessoa@Example.COM"), CLIENT_ID
    ) == "pessoa@example.com"


# ---------------------------------------------------------------------------
# Claims recusadas
# ---------------------------------------------------------------------------

def test_token_for_another_client_id_is_rejected():
    """🔴 `aud` é o que amarra o token a ESTE app.

    Sem a checagem, um ID token emitido para qualquer outro app Google do mundo
    virava sessão aqui — e qualquer pessoa consegue um, criando o próprio app.
    É a falha mais grave possível neste arquivo.
    """
    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_claims(_claims(aud="outro-app.apps.googleusercontent.com"), CLIENT_ID)


def test_token_from_another_issuer_is_rejected():
    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_claims(_claims(iss="https://evil.example"), CLIENT_ID)


def test_unverified_email_is_rejected():
    """🔴 `email_verified: false` significa que o Google não confirmou que a
    pessoa controla esse endereço. Aceitar permitiria cadastrar um e-mail da
    allowlist num provedor próprio e entrar."""
    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_claims(_claims(email_verified=False), CLIENT_ID)


def test_missing_email_verified_is_rejected():
    """Ausência não é consentimento: claim faltando tem que recusar, não cair
    num `.get()` que devolve `None` e segue adiante."""
    claims = _claims()
    del claims["email_verified"]

    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_claims(claims, CLIENT_ID)


def test_missing_email_is_rejected():
    claims = _claims()
    del claims["email"]

    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_claims(claims, CLIENT_ID)


def test_expired_token_is_rejected():
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())

    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_claims(_claims(exp=now - 60), CLIENT_ID)


def test_empty_client_id_rejects_everything():
    """Se `GOOGLE_CLIENT_ID` não estiver configurada, o `aud` do token casaria
    com string vazia e a checagem viraria decoração. Tem que recusar."""
    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_claims(_claims(), "")


# ---------------------------------------------------------------------------
# Assinatura: confusão de algoritmo
# ---------------------------------------------------------------------------

def test_hs256_token_is_not_accepted_where_rs256_is_expected():
    """🔴 Confusão de algoritmo — a falha clássica de verificação de JWT.

    O Google assina com RS256 (chave pública). Se a verificação não fixar
    `algorithms=["RS256"]`, um atacante assina um token com **HS256** usando a
    chave pública do Google (que é pública!) como segredo HMAC, e a biblioteca
    o valida.

    Este teste constrói exatamente esse token. Ele não pode virar sessão.
    """
    import jwt

    forged = jwt.encode(_claims(), key="qualquer-coisa", algorithm="HS256")

    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_id_token(forged, CLIENT_ID)


def test_unsigned_google_token_is_rejected():
    """🔴 `alg: none` na porta de entrada do login."""
    import jwt

    forged = jwt.encode(_claims(), key="", algorithm="none")

    with pytest.raises(_auth().InvalidGoogleToken):
        _auth().verify_google_id_token(forged, CLIENT_ID)


def test_malformed_token_is_rejected_without_raising_something_else():
    """Entrada arbitrária do cliente só pode produzir `InvalidGoogleToken` —
    nunca um erro de parsing que vire 500 no router."""
    for junk in ("", "nao-e-jwt", "a.b.c"):
        with pytest.raises(_auth().InvalidGoogleToken):
            _auth().verify_google_id_token(junk, CLIENT_ID)
