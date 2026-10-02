"""Cookie de sessão assinado — D-Auth-3.

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

Este é o arquivo mais sensível da fatia: é ele que decide se uma sessão é
legítima. Por isso a maior parte dos testes é **negativa** — o que importa não
é o caminho felizssuceder, é nenhum atalho funcionar.
"""

import datetime

import pytest

SECRET = "segredo-de-teste-nao-use-em-producao"
OTHER_SECRET = "outro-segredo-completamente-diferente"


def _auth():
    """Import tardio: `app.auth` ainda não existe na etapa vermelha.

    No topo do arquivo, derrubaria a coleção da suíte inteira e os 301 testes
    verdes parariam de dar sinal — ver a mesma decisão em `test_settings.py`.
    """
    from app import auth

    return auth


# ---------------------------------------------------------------------------
# Ida e volta
# ---------------------------------------------------------------------------

def test_round_trip_recovers_the_email():
    auth = _auth()
    token = auth.issue_session("pessoa@example.com", secret=SECRET)

    assert auth.read_session(token, secret=SECRET) == "pessoa@example.com"


def test_token_does_not_expose_the_email_in_cleartext():
    """Não é confidencialidade de verdade — JWT é assinado, não cifrado, e o
    payload é base64. O teste existe para que ninguém confunda as duas coisas
    ao ler o código: se um dia o cookie precisar esconder o e-mail, isto falha
    e obriga a decisão explícita."""
    token = _auth().issue_session("pessoa@example.com", secret=SECRET)

    assert "pessoa@example.com" not in token


# ---------------------------------------------------------------------------
# Os ataques
# ---------------------------------------------------------------------------

def test_tampered_token_is_rejected():
    """🔴 Um byte trocado invalida a assinatura."""
    auth = _auth()
    token = auth.issue_session("pessoa@example.com", secret=SECRET)
    tampered = token[:-1] + ("a" if token[-1] != "a" else "b")

    assert auth.read_session(tampered, secret=SECRET) is None


def test_token_signed_with_another_secret_is_rejected():
    """🔴 Segredo alheio não serve — é o que dá sentido a rotacionar o segredo
    para derrubar todas as sessões (D-Auth-3)."""
    auth = _auth()
    token = auth.issue_session("pessoa@example.com", secret=OTHER_SECRET)

    assert auth.read_session(token, secret=SECRET) is None


def test_unsigned_token_is_rejected():
    """🔴 `alg: none` — o ataque mais clássico contra JWT.

    Uma biblioteca mal configurada aceita um token sem assinatura nenhuma. Se
    isto passar, qualquer pessoa forja sessão para qualquer e-mail.
    """
    import jwt

    forged = jwt.encode(
        {"sub": "intruso@example.com", "iat": 0}, key="", algorithm="none"
    )

    assert _auth().read_session(forged, secret=SECRET) is None


def test_garbage_is_rejected_without_raising():
    """Cookie corrompido ou de outra aplicação não pode virar 500.

    O cookie vem do cliente: conteúdo arbitrário é entrada esperada, não
    excepcional.
    """
    auth = _auth()

    for junk in ("", "nao-e-um-jwt", "a.b.c", "x" * 500):
        assert auth.read_session(junk, secret=SECRET) is None


def test_expired_token_is_rejected():
    """🔴 Sessão de 31 dias não vale mais (D-Auth-3: 30 dias)."""
    auth = _auth()
    issued = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=31)
    token = auth.issue_session("pessoa@example.com", secret=SECRET, issued_at=issued)

    assert auth.read_session(token, secret=SECRET) is None


def test_token_just_inside_the_window_is_accepted():
    """O par do teste acima. Sem ele, um erro de sinal no cálculo da expiração
    passaria — o token expiraria sempre, e o sintoma seria "login não gruda"."""
    auth = _auth()
    issued = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=29)
    token = auth.issue_session("pessoa@example.com", secret=SECRET, issued_at=issued)

    assert auth.read_session(token, secret=SECRET) == "pessoa@example.com"


# ---------------------------------------------------------------------------
# Janela deslizante
# ---------------------------------------------------------------------------

def test_session_window_is_thirty_days():
    """A constante é contrato: a tela não desloga em 30 dias de uso."""
    assert _auth().SESSION_MAX_AGE == datetime.timedelta(days=30).total_seconds()


def test_reissue_moves_the_window_forward():
    """Deslizante: usar o app renova o prazo.

    Sem isto, o usuário é deslogado 30 dias depois do primeiro login mesmo
    usando o app todo dia — que é o oposto do que a decisão pediu.
    """
    auth = _auth()
    issued = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=29)
    old = auth.issue_session("pessoa@example.com", secret=SECRET, issued_at=issued)

    renewed = auth.issue_session("pessoa@example.com", secret=SECRET)

    assert old != renewed
    assert auth.read_session(renewed, secret=SECRET) == "pessoa@example.com"
