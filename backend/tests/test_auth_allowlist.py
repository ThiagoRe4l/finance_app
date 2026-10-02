"""Allowlist de e-mails — D-Auth-2.

Escrita **antes** da implementação, conforme o processo do CLAUDE.md.

Função pura, no mesmo formato de `resolve_cors_origins`: recebe o ambiente por
parâmetro, para que o teste exercite exatamente a função que a aplicação usa
sem mexer no ambiente do processo.
"""


def _settings():
    """Import tardio — ver a explicação em `test_settings.py`."""
    from app import settings

    return settings


def test_absent_variable_lets_nobody_in():
    """🔴 *Fail closed.* Allowlist ausente não pode significar allowlist aberta.

    É o oposto do padrão "todo default equivale ao comportamento de hoje" que
    vale para as outras variáveis — e é de propósito. O modo de falha do outro
    lado é liberar o app inteiro para qualquer conta Google do mundo.
    """
    assert _settings().resolve_allowed_emails({}) == frozenset()


def test_blank_variable_lets_nobody_in():
    """Campo definido vazio no painel é indistinguível de esquecido."""
    assert _settings().resolve_allowed_emails({"AUTH_ALLOWED_EMAILS": "   "}) == frozenset()


def test_single_email():
    assert _settings().resolve_allowed_emails(
        {"AUTH_ALLOWED_EMAILS": "pessoa@example.com"}
    ) == frozenset({"pessoa@example.com"})


def test_comma_separated_list_is_split_and_trimmed():
    """Painel da Vercel é campo de texto: espaço depois da vírgula é o normal
    de se digitar, e um e-mail com espaço à esquerda nunca casaria."""
    assert _settings().resolve_allowed_emails(
        {"AUTH_ALLOWED_EMAILS": "a@example.com, b@example.com ,c@example.com"}
    ) == frozenset({"a@example.com", "b@example.com", "c@example.com"})


def test_emails_are_lowercased():
    """🔴 Comparação case-insensitive.

    O domínio de e-mail é case-insensitive por RFC, e o Google pode devolver a
    parte local com a caixa que o usuário cadastrou. Guardar a allowlist com
    caixa diferente da claim recusaria um e-mail legítimo — falha que parece
    "allowlist não funciona" e manda a pessoa procurar no lugar errado.
    """
    allowed = _settings().resolve_allowed_emails(
        {"AUTH_ALLOWED_EMAILS": "Pessoa@Example.COM"}
    )

    assert allowed == frozenset({"pessoa@example.com"})


def test_empty_items_are_discarded():
    """Vírgula sobrando não pode virar entrada vazia na allowlist.

    Uma string vazia na lista casaria com e-mail vazio, e dependendo do
    caminho de comparação isso é um buraco.
    """
    assert _settings().resolve_allowed_emails(
        {"AUTH_ALLOWED_EMAILS": "a@example.com,,  ,b@example.com,"}
    ) == frozenset({"a@example.com", "b@example.com"})


# ---------------------------------------------------------------------------
# A checagem em si
# ---------------------------------------------------------------------------

def test_allowed_email_passes():
    allowed = frozenset({"a@example.com"})

    assert _settings().is_email_allowed("a@example.com", allowed) is True


def test_email_is_compared_case_insensitively():
    allowed = frozenset({"a@example.com"})

    assert _settings().is_email_allowed("A@Example.com", allowed) is True


def test_email_outside_the_list_is_rejected():
    allowed = frozenset({"a@example.com"})

    assert _settings().is_email_allowed("intruso@example.com", allowed) is False


def test_nobody_passes_an_empty_allowlist():
    """O par do *fail closed*: lista vazia recusa até e-mail bem formado."""
    assert _settings().is_email_allowed("a@example.com", frozenset()) is False


def test_blank_email_is_rejected_even_against_an_empty_item():
    """Defesa contra o caso que `test_empty_items_are_discarded` previne na
    outra ponta: string vazia nunca é um e-mail autorizado."""
    assert _settings().is_email_allowed("", frozenset({""})) is False
