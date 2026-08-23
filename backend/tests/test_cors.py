"""CORS — origem restrita e sem credenciais (D-Deploy-6).

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
A resolução da variável `CORS_ALLOW_ORIGINS` em si é coberta por
`test_settings.py`; aqui o alvo é o comportamento do app montado.
"""

def test_credentials_are_not_allowed(client):
    """🔴 Hoje o app manda `allow_credentials=True` junto de `allow_origins=["*"]`.

    A combinação é inválida pela especificação de CORS. O Starlette contorna
    refletindo a origem da requisição em vez de mandar `*` — o que na prática
    significa "aceita **qualquer** origem, com credenciais".

    O `apiFetch` não manda `credentials` em chamada nenhuma, então fechar não
    custa nada funcionalmente.
    """
    response = client.get("/api/accounts/", headers={"Origin": "https://qualquer.example"})

    assert "access-control-allow-credentials" not in {
        k.lower() for k in response.headers
    }


def test_wildcard_origin_is_echoed_as_wildcard(client):
    """Com `allow_credentials=False`, o Starlette volta a mandar `*` literal.

    É a evidência observável de que a combinação inválida saiu: enquanto
    credentials estiver ligado, o header vem com a origem refletida.
    """
    response = client.get("/api/accounts/", headers={"Origin": "https://qualquer.example"})

    assert response.headers.get("access-control-allow-origin") == "*"
