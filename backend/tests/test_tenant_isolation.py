"""Fatia 2 — escopo por usuário em toda rota (D-Tenant-3, 4 e 7).

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

🔴 O risco de maior severidade desta fatia é um usuário ver dado de outro por
um endpoint que esqueceu de filtrar. Por isso nada aqui é checagem pontual:
cada teste **percorre as rotas do app** e falha quando aparece uma que ele não
sabe exercitar. Rota nova não nasce fora da varredura.

Os cinco testes da D-Tenant-7
-----------------------------
1. **Diferencial nas leituras.** O retrato de B não pode mudar quando A
   escreve. É o que pega vazamento em **agregado** — `total_balance`,
   `monthly_flow`, `top_categories` —, onde o valor vazado não aparece
   sozinho, aparece somado.
2. **Toda rota com `{id}`**, todo método, com o id de A → mesma resposta de
   um id que não existe (D-Tenant-4).
3. **Todo campo `*_id` de corpo**, descoberto pelo schema da rota.
4. **Estrutural** — todo model financeiro tem dono, ou é exceção declarada.
5. **Guarda contra varredura vazia.**

Sem override de autenticação em lugar nenhum: os clientes são `client_as`,
com cookie real e uma sessão de banco por requisição (D-Tenant-8).

Por que vermelho hoje
---------------------
Não há dono: todo mundo vê tudo, e B consegue editar o que é de A. Os testes
1–3 falham por **vazamento real**, que é o motivo certo. O 4 falha por coluna
ausente.
"""

import datetime
import json
import re

from tests.conftest import money
from tests.test_auth_routes import PUBLIC_PATHS, _effective_routes

ANA = "ana@example.com"
BIA = "bia@example.com"
CAIO = "caio@example.com"

SENTINEL = "SENTINELA-A"

# Id que certamente não existe. A resposta para o id de A tem que ser
# **idêntica** à resposta para este — status e `detail` (D-Tenant-4).
MISSING_ID = 987654


# ---------------------------------------------------------------------------
# Enumeração de rotas
# ---------------------------------------------------------------------------

def _api_routes():
    return [
        route
        for route in _effective_routes()
        if getattr(route, "path", "").startswith("/api/")
        and route.path not in PUBLIC_PATHS
        and not route.path.startswith("/api/auth/")
    ]


def _has_route(method, path):
    return any(r.path == path and method in r.methods for r in _api_routes())


def _parameterless_gets():
    return sorted(
        r.path for r in _api_routes() if "GET" in r.methods and "{" not in r.path
    )


def _id_routes():
    """(método, rota) para toda rota com parâmetro de caminho.

    DELETE por último: se um DELETE vazasse antes, o PATCH seguinte daria 404
    pelo motivo errado e esconderia o próprio vazamento.
    """
    order = {"GET": 0, "PATCH": 1, "POST": 2, "DELETE": 3}
    pairs = [
        (method, r.path)
        for r in _api_routes()
        if "{" in r.path
        for method in r.methods
        if method in order
    ]
    return sorted(pairs, key=lambda p: (order[p[0]], p[1]))


def _body_id_fields():
    """{(método, rota, campo)} para todo campo `*_id` de corpo de requisição."""
    found = set()
    for r in _api_routes():
        for param in getattr(r.dependant, "body_params", []):
            model = param.field_info.annotation
            for name in getattr(model, "model_fields", {}):
                if name.endswith("_id"):
                    for method in r.methods:
                        found.add((method, r.path, name))
    return found


# ---------------------------------------------------------------------------
# Retrato e dados
# ---------------------------------------------------------------------------

def _snapshot(client):
    """Toda rota GET sem parâmetro, como o usuário a vê."""
    shot = {}
    for path in _parameterless_gets():
        response = client.get(path)
        shot[path] = (response.status_code, response.json())
    return shot


def _login(*clients):
    """Primeira requisição de cada um — dispara o provisionamento (fatia 3).

    Feito **antes** do retrato inicial: senão o próprio provisionamento de A
    apareceria no diferencial de B como se fosse vazamento — `GET
    /api/participants` legitimamente passa a listar A quando A entra.
    """
    for client in clients:
        assert client.get("/api/auth/me").status_code == 200


def _created(response):
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _build_dataset(client, share_with=None):
    """Um exemplar de cada recurso, todos marcados com o sentinela.

    Os valores são improváveis de propósito: um `777777.77` aparecendo no
    JSON de outra pessoa é diagnóstico imediato. Mas o teste diferencial não
    depende deles — ele compara o retrato inteiro.
    """
    today = datetime.date.today().isoformat()

    account = _created(client.post("/api/accounts", json={
        "name": f"{SENTINEL} conta", "initial_balance": "555555.55",
    }))
    category = _created(client.post("/api/categories", json={
        "name": f"{SENTINEL} categoria", "icon_name": "Home",
        "budget": "4444.44", "color": "oklch(0.5 0 0)",
    }))
    installment = _created(client.post("/api/installments", json={
        "title": f"{SENTINEL} parcelamento", "category_id": category,
        "total_amount": "3999.96", "installment_amount": "333.33",
        "current_installment": 1, "total_installments": 12,
        "end_date": "Ago/2027", "account_id": account,
    }))
    transaction = _created(client.post("/api/transactions", json={
        "title": f"{SENTINEL} saída", "type": "SAÍDA", "amount": "777777.77",
        "date": today, "category_id": category, "account_id": account,
    }))
    _created(client.post("/api/transactions", json={
        "title": f"{SENTINEL} entrada", "type": "ENTRADA", "amount": "666666.66",
        "date": today, "category_id": category, "account_id": account,
    }))
    _created(client.post("/api/transactions", json={
        "title": f"{SENTINEL} parcela", "type": "SAÍDA", "amount": "333.33",
        "date": today, "category_id": category, "account_id": account,
        "installment_id": installment,
    }))
    investment = _created(client.post("/api/investments", json={
        "name": f"{SENTINEL} investimento", "current_balance": "222222.22",
    }))
    _created(client.post(f"/api/investments/{investment}/history", json={
        "date": today, "balance": "111111.11",
    }))

    ids = {
        "account_id": account,
        "category_id": category,
        "installment_id": installment,
        "transaction_id": transaction,
        "investment_id": investment,
    }

    # Fatia 4. Condicional porque a rota ainda não existe na fatia 2 — e isso
    # não abre buraco: se a rota existir e o grupo não for criado aqui,
    # `{shared_expense_id}` fica fora de `ids` e o teste das rotas com id
    # falha por parâmetro desconhecido.
    if share_with is not None and _has_route("POST", "/api/shared-expenses"):
        ids["shared_expense_id"] = _created(client.post("/api/shared-expenses", json={
            "title": f"{SENTINEL} grupo", "amount": "999.99", "date": today,
            "account_id": account, "category_id": category,
            "participants": [share_with],
        }))

    return ids


def _diff(before, after):
    return sorted(path for path in before if before[path] != after.get(path))


# ---------------------------------------------------------------------------
# 1. Diferencial nas leituras
# ---------------------------------------------------------------------------

def test_another_users_writes_never_change_what_i_read(client_as):
    """🔴 O teste central desta fatia.

    B tira um retrato de **toda** rota GET sem parâmetro. A cria um conjunto
    completo de dados — e compartilha um grupo com C, não com B. O retrato de B
    tem que sair idêntico.

    Comparar o retrato inteiro, e não procurar o sentinela, é o que pega o
    vazamento em agregado: se `total_balance` somar a conta de A, o número de B
    muda — sem que `555555.55` apareça em lugar nenhum.
    """
    ana, bia, caio = client_as(ANA), client_as(BIA), client_as(CAIO)
    _login(ana, bia, caio)

    before = _snapshot(bia)
    _build_dataset(ana, share_with=CAIO)
    after = _snapshot(bia)

    assert not _diff(before, after), (
        f"leituras de {BIA} mudaram quando {ANA} escreveu: {_diff(before, after)}"
    )


def test_the_writer_does_see_their_own_data(client_as):
    """✅ **Já passa hoje** — guarda, não cobertura. O diferencial passaria vazio se A não tivesse
    conseguido escrever nada — ou se toda leitura devolvesse lista vazia."""
    ana, bia = client_as(ANA), client_as(BIA)
    _login(ana, bia)

    _build_dataset(ana)

    assert SENTINEL in json.dumps(_snapshot(ana), ensure_ascii=False)


def test_no_read_exposes_another_users_sentinel(client_as):
    """Diagnóstico do diferencial: quando ele falha, este diz **onde**.

    Os valores numéricos entram também — o saldo inicial e a saída aparecem
    sozinhos em listas, mesmo que em agregados venham somados.
    """
    ana, bia, caio = client_as(ANA), client_as(BIA), client_as(CAIO)
    _login(ana, bia, caio)

    _build_dataset(ana, share_with=CAIO)

    leaks = []
    for path, (_, body) in _snapshot(bia).items():
        text = json.dumps(body, ensure_ascii=False)
        for marker in (SENTINEL, "555555.55", "777777.77", "666666.66", "222222.22"):
            if marker in text:
                leaks.append(f"{path}: {marker}")

    assert not leaks, f"dado de {ANA} visível para {BIA}: {leaks}"


# ---------------------------------------------------------------------------
# 2. Toda rota com {id}
# ---------------------------------------------------------------------------

# Corpo de cada rota com id. PATCH leva uma mudança **real**: se o escopo
# vazar, o dado de A muda e o retrato dele denuncia. Um `{}` vazio passaria
# sem efeito e esconderia o vazamento.
_ID_ROUTE_BODIES = {
    ("PATCH", "/api/transactions/{transaction_id}"): {"title": "INVASAO"},
    ("PATCH", "/api/categories/{category_id}"): {"name": "INVASAO"},
    ("PATCH", "/api/installments/{installment_id}"): {"title": "INVASAO"},
    ("PATCH", "/api/shared-expenses/{shared_expense_id}"): {"title": "INVASAO"},
    ("POST", "/api/investments/{investment_id}/history"): {
        "date": datetime.date.today().isoformat(), "balance": "1.00",
    },
}


def _fill(path, ids):
    return re.sub(r"\{(\w+)\}", lambda m: str(ids[m.group(1)]), path)


def test_every_id_route_answers_another_users_id_as_if_it_did_not_exist(client_as):
    """🔴 O segundo defeito do mapeamento: PATCH/DELETE buscavam só por id.

    Para cada rota com parâmetro de caminho e cada método, B usa o id de A. A
    resposta tem que ser **idêntica** à de um id inexistente — mesmo status,
    mesmo corpo. Comparar com o inexistente (e não com um `detail` escrito à
    mão) cobre D-Tenant-4 e ainda pega o 404 `"Not Found"` de rota ausente.

    Parâmetro que este teste não conhece **falha o teste**: rota nova não fica
    fora da varredura em silêncio.
    """
    ana, bia, caio = client_as(ANA), client_as(BIA), client_as(CAIO)
    _login(ana, bia, caio)
    ids = _build_dataset(ana, share_with=CAIO)
    ana_before = _snapshot(ana)

    unknown, leaked = [], []
    for method, path in _id_routes():
        params = re.findall(r"\{(\w+)\}", path)
        missing = [p for p in params if p not in ids]
        if missing:
            unknown.append(f"{method} {path}: {missing}")
            continue

        body = _ID_ROUTE_BODIES.get((method, path))
        foreign = bia.request(method, _fill(path, ids), json=body)
        absent = bia.request(method, _fill(path, {p: MISSING_ID for p in params}), json=body)

        foreign_shape = (foreign.status_code, foreign.text)
        absent_shape = (absent.status_code, absent.text)
        if foreign_shape != absent_shape or absent.status_code != 404:
            leaked.append(f"{method} {path}: {foreign_shape} ≠ inexistente {absent_shape}")

    assert not unknown, f"rotas com parâmetro que a varredura não sabe preencher: {unknown}"
    assert not leaked, f"rotas que tratam o id de outro usuário como acessível: {leaked}"

    # E nada de A mudou — inclusive o que só a rota com id mostra.
    assert not _diff(ana_before, _snapshot(ana))
    history = ana.get(f"/api/investments/{ids['investment_id']}/history").json()
    assert len(history) == 1


# ---------------------------------------------------------------------------
# 3. Todo campo *_id de corpo
# ---------------------------------------------------------------------------

def _bia_resources(bia):
    """Recursos próprios de B — o resto do payload tem que ser válido para
    que o 404 seja **do id de A**, e não de qualquer outra coisa."""
    today = datetime.date.today().isoformat()
    account = _created(bia.post("/api/accounts", json={"name": "Conta B", "initial_balance": "0"}))
    category = _created(bia.post("/api/categories", json={
        "name": "Categoria B", "icon_name": "Home", "budget": "0", "color": "oklch(0.5 0 0)",
    }))
    installment = _created(bia.post("/api/installments", json={
        "title": "Parcelamento B", "category_id": category, "total_amount": "120.00",
        "installment_amount": "10.00", "current_installment": 1,
        "total_installments": 12, "end_date": "Ago/2027", "account_id": account,
    }))
    transaction = _created(bia.post("/api/transactions", json={
        "title": "Saída B", "type": "SAÍDA", "amount": "10.00", "date": today,
        "category_id": category, "account_id": account,
    }))
    return {
        "account_id": account, "category_id": category,
        "installment_id": installment, "transaction_id": transaction,
    }


def _body_cases(own, today):
    """(método, rota, campo) → (rota preenchida, payload válido de B, status esperado).

    O payload usa os recursos de B; o teste troca **só** o campo em questão
    pelo id de A.
    """
    transaction_body = {
        "title": "Tentativa", "type": "SAÍDA", "amount": "1.00", "date": today,
        "category_id": own["category_id"], "account_id": own["account_id"],
    }
    installment_body = {
        "title": "Tentativa", "category_id": own["category_id"],
        "total_amount": "120.00", "installment_amount": "10.00",
        "current_installment": 1, "total_installments": 12,
        "end_date": "Ago/2027", "account_id": own["account_id"],
    }
    shared_body = {
        "title": "Tentativa", "amount": "10.00", "date": today,
        "account_id": own["account_id"], "category_id": own["category_id"],
        "participants": [CAIO],
    }
    tx_path = f"/api/transactions/{own['transaction_id']}"
    inst_path = f"/api/installments/{own['installment_id']}"

    return {
        ("POST", "/api/transactions", "account_id"): ("/api/transactions", transaction_body, 404),
        ("POST", "/api/transactions", "category_id"): ("/api/transactions", transaction_body, 404),
        ("POST", "/api/transactions", "installment_id"): ("/api/transactions", transaction_body, 404),
        ("PATCH", "/api/transactions/{transaction_id}", "category_id"): (tx_path, {}, 404),
        # Vincular a parcelamento já é 400 para qualquer id ("só desvincular",
        # dia 4.1). O que importa é não ser 200.
        ("PATCH", "/api/transactions/{transaction_id}", "installment_id"): (tx_path, {}, 400),
        ("POST", "/api/installments", "account_id"): ("/api/installments", installment_body, 404),
        ("POST", "/api/installments", "category_id"): ("/api/installments", installment_body, 404),
        ("PATCH", "/api/installments/{installment_id}", "category_id"): (inst_path, {}, 404),
        ("POST", "/api/shared-expenses", "account_id"): ("/api/shared-expenses", shared_body, 404),
        ("POST", "/api/shared-expenses", "category_id"): ("/api/shared-expenses", shared_body, 404),
    }


def test_every_body_id_field_is_covered_by_the_sweep():
    """✅ **Já passa hoje** — é contrato da varredura, não do app: os 8 campos
    atuais estão todos declarados. Fica vermelho quando aparecer um `*_id` novo
    sem caso — inclusive os dois de `/api/shared-expenses` na fatia 4, se a
    tabela abaixo não os tivesse.

    Campo `*_id` novo não passa sem caso.

    Sem isto, o próximo endpoint com `account_id` no corpo nasceria fora da
    varredura e ninguém perceberia.
    """
    declared = {
        key for key in _body_cases({k: 0 for k in (
            "account_id", "category_id", "installment_id", "transaction_id",
        )}, "2026-01-01")
        if _has_route(key[0], key[1])
    }

    assert _body_id_fields() == declared


def test_no_body_id_field_accepts_another_users_resource(client_as):
    """🔴 O terceiro defeito: POST conferia FK por existência, não por dono.

    Com a FK composta (D-Tenant-2) o banco recusaria de qualquer jeito — mas
    como `IntegrityError`, ou seja, 500. O router tem que chegar antes, com
    404.
    """
    ana, bia, caio = client_as(ANA), client_as(BIA), client_as(CAIO)
    _login(ana, bia, caio)
    foreign = _build_dataset(ana)
    own = _bia_resources(bia)
    bia_before = _snapshot(bia)

    wrong = []
    cases = _body_cases(own, datetime.date.today().isoformat())
    for (method, route, field), (path, body, expected) in cases.items():
        if not _has_route(method, route):
            continue
        payload = {**body, field: foreign[field]}
        response = bia.request(method, path, json=payload)
        if response.status_code != expected:
            wrong.append(f"{method} {route} [{field}] -> {response.status_code}: {response.text}")

    assert not wrong, f"campos de corpo que aceitam recurso de {ANA}: {wrong}"
    assert not _diff(bia_before, _snapshot(bia)), "uma tentativa recusada deixou rastro"


# ---------------------------------------------------------------------------
# Unicidade por dono, vista pela API
# ---------------------------------------------------------------------------

def test_two_users_can_create_a_category_with_the_same_name(client_as):
    ana, bia = client_as(ANA), client_as(BIA)
    _login(ana, bia)
    body = {"name": "Mesmo Nome", "icon_name": "Home", "budget": "0", "color": "oklch(0.5 0 0)"}

    assert ana.post("/api/categories", json=body).status_code == 201
    assert bia.post("/api/categories", json=body).status_code == 201


def test_the_same_user_still_cannot_repeat_a_category_name(client_as):
    """✅ **Já passa hoje** — regressão. O par do de cima: o escopo não pode ter afrouxado a regra dentro do
    mesmo dono."""
    ana = client_as(ANA)
    _login(ana)
    body = {"name": "Mesmo Nome", "icon_name": "Home", "budget": "0", "color": "oklch(0.5 0 0)"}

    assert ana.post("/api/categories", json=body).status_code == 201
    assert ana.post("/api/categories", json=body).status_code == 400


def test_balance_is_computed_only_over_my_own_accounts(client_as):
    """O quinto defeito do mapeamento, isolado para diagnóstico.

    `total_balance` soma `Transaction` sem passar por `Account`. Um filtro
    aplicado só em `Account` deixaria o ledger de A dentro do total de B. O
    diferencial já pega isso; este diz o nome do campo quando falhar.
    """
    ana, bia = client_as(ANA), client_as(BIA)
    _login(ana, bia)
    bia_total = money(bia.get("/api/dashboard/summary").json()["total_balance"])

    _build_dataset(ana)

    assert money(bia.get("/api/dashboard/summary").json()["total_balance"]) == bia_total


# ---------------------------------------------------------------------------
# 4. Estrutural
# ---------------------------------------------------------------------------

# Tabelas sem `owner_id`, cada uma com o motivo. Adicionar aqui é decisão de
# isolamento — por isso a lista é explícita e mora no teste.
_TABLES_WITHOUT_OWNER = {
    "users": "é o próprio dono",
    "investment_history": "herda pelo investimento (CASCADE) — D-Tenant-2",
    "shared_expenses": "visível por participação, não por dono — D-Shared-9",
}


def test_every_table_has_an_owner_or_is_a_declared_exception():
    """🔴 Análogo de `test_every_foreign_key_declares_ondelete`.

    Tabela nova sem `owner_id` não entra no filtro automático da D-Tenant-3 — e
    não há outra coisa que a filtraria. Este teste obriga a escolha a ser
    explícita.
    """
    from app.database import Base
    from app import models  # noqa: F401 — registra os models no metadata

    problems = []
    for name, table in Base.metadata.tables.items():
        if name in _TABLES_WITHOUT_OWNER:
            continue
        column = table.columns.get("owner_id")
        if column is None:
            problems.append(f"{name}: sem owner_id")
        elif column.nullable:
            problems.append(f"{name}: owner_id aceita NULL")

    assert not problems, f"tabelas fora do isolamento: {problems}"


def test_every_data_route_uses_the_owner_scoped_session():
    """🔴 Estrutural, como `test_every_api_route_declares_the_auth_dependency`.

    O filtro da D-Tenant-3 vive na sessão entregue por `owned_db`. Rota que
    pega a sessão crua de `get_db` lê o banco inteiro — e os testes
    comportamentais só a pegariam se alguém lembrasse de criar dado para ela.
    """
    from fastapi.dependencies.utils import get_flat_dependant

    from app.tenancy import owned_db

    unscoped = []
    for route in _api_routes():
        calls = [dep.call for dep in get_flat_dependant(route.dependant).dependencies]
        if owned_db not in calls:
            unscoped.append(f"{sorted(route.methods)} {route.path}")

    assert not unscoped, f"rotas sem a sessão escopada por dono: {unscoped}"


# ---------------------------------------------------------------------------
# 5. Guarda contra varredura vazia
# ---------------------------------------------------------------------------

def test_the_sweeps_actually_covered_something():
    """✅ **Já passa hoje** — guarda. Um laço que não itera passa vazio. Os números são os de hoje (7 GETs sem
    parâmetro, 7 pares método × rota com id, 8 campos de corpo) — piso, não
    igualdade."""
    assert len(_parameterless_gets()) >= 7, _parameterless_gets()
    assert len(_id_routes()) >= 7, _id_routes()
    assert len(_body_id_fields()) >= 8, _body_id_fields()
