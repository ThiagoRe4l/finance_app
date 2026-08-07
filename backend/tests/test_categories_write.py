"""PATCH e DELETE de categoria — dia 4.1.

Escrito **antes** da implementação. Hoje `/api/categories/{id}` não existe em
verbo nenhum; o arquivo inteiro é vermelho.

Mesma precaução de `test_transactions_write.py`: **todo teste que espera 404
assere também o `detail`**, senão o 404 genérico da rota inexistente já
satisfaria o status e o teste passaria hoje pelo motivo errado.

Decisões que este arquivo trava (CLAUDE.md, 07/08/2026):

* C9  — DELETE de categoria com transação vinculada → **409**, não 500.
* C10 — categoria usada **só** por parcelamento → 409 também. Caminho que o
  `RESTRICT` de `Installment.category_id` cobre e que nenhum teste exercitava.
* C11 — renomear categoria em uso é livre.
* F18 — DELETE devolve 204 sem corpo.

Sobre o 409 e o 500
-------------------
`ondelete="RESTRICT"` faz o banco levantar `IntegrityError`. Um router que
apenas emita o DELETE e deixe a exceção subir devolve **500** — erro de servidor
para um caso de negócio esperado. `test_category_in_use_cannot_be_deleted`
(`test_category_fk.py`) **não pega isso**: ele deleta via `fk_session`, sem
passar por router. É a diferença entre garantia de dado e contrato de API.
"""

import pytest

from tests.conftest import (
    create_category,
    create_transaction,
    installment_payload,
)

CATEGORIA_INEXISTENTE = 9999


def _categories_by_id(client):
    return {c["id"]: c for c in client.get("/api/categories/").json()}


# ---------------------------------------------------------------------------
# PATCH
# ---------------------------------------------------------------------------

def test_patch_budget(client, default_category):
    """O caso de uso que a tela de categorias existe para servir.

    O card inteiro de `categorias.tsx` é uma barra `spent/budget`; ajustar o
    orçamento é a única edição que o mock realmente sugere.
    """
    response = client.patch(f"/api/categories/{default_category['id']}", json={"budget": 1500.0})

    assert response.status_code == 200, response.text
    assert response.json()["budget"] == pytest.approx(1500.0)
    assert client.get("/api/categories/").json()[0]["budget"] == pytest.approx(1500.0)


def test_patch_is_partial_and_preserves_untouched_fields(client, default_category):
    """Campo omitido não pode ser zerado por omissão."""
    response = client.patch(f"/api/categories/{default_category['id']}", json={"budget": 1500.0})

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["name"] == "Alimentação"
    assert data["icon_name"] == "UtensilsCrossed"
    assert data["color"] == "oklch(0.6 0.15 155)"


def test_patch_color_and_icon(client, default_category):
    response = client.patch(
        f"/api/categories/{default_category['id']}",
        json={"color": "oklch(0.65 0.18 50)", "icon_name": "Car"},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["color"] == "oklch(0.65 0.18 50)"
    assert data["icon_name"] == "Car"


def test_patch_name_of_a_category_in_use_is_allowed(client, default_account, default_category):
    """C11: renomear não quebra FK.

    Reescreve o histórico dos relatórios — a transação antiga passa a aparecer
    sob o nome novo. Decidido que é aceitável: o vínculo é por id, o nome é
    rótulo de apresentação.
    """
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 120.0)

    response = client.patch(
        f"/api/categories/{default_category['id']}", json={"name": "Supermercado"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Supermercado"

    top = client.get("/api/reports/overview").json()["top_categories"]
    assert top[0]["name"] == "Supermercado"
    assert top[0]["value"] == pytest.approx(120.0)


def test_patch_preserves_the_aggregates(client, default_account, default_category):
    """Editar o orçamento não pode mexer em `spent`/`txs_count`.

    Os dois vêm de `func.sum`/`func.count`, não do model — o modo de falha é o
    router montar a `CategoryResponse` à mão no update e devolver os defaults
    `0.0`/`0`, fazendo a tela piscar zerada até o próximo GET.
    """
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 200.0)
    create_transaction(client, default_account, default_category["id"], "ENTRADA", 50.0)

    response = client.patch(f"/api/categories/{default_category['id']}", json={"budget": 900.0})

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["spent"] == pytest.approx(200.0)
    assert data["txs_count"] == 2


def test_patch_duplicate_name_is_rejected(client):
    """`Category.name` é `unique=True` no model.

    ⚠️ **Decisão que eu inferi, confirma antes de aprovar:** o 400 espelha o que
    `create_category` já devolve ("Categoria já existe."). Sem tratamento
    explícito no router, o `UNIQUE constraint` sobe como `IntegrityError` e vira
    **500** — o mesmo modo de falha do DELETE bloqueado.
    """
    create_category(client, name="Alimentação")
    transporte = create_category(client, name="Transporte", icon_name="Car", color="oklch(0.65 0.18 50)")

    response = client.patch(f"/api/categories/{transporte['id']}", json={"name": "Alimentação"})

    assert response.status_code == 400


def test_patch_renaming_to_its_own_name_is_not_a_conflict(client, default_category):
    """Fronteira do teste acima: mandar o nome que já é o próprio não colide."""
    response = client.patch(
        f"/api/categories/{default_category['id']}",
        json={"name": "Alimentação", "budget": 1200.0},
    )

    assert response.status_code == 200, response.text
    assert response.json()["budget"] == pytest.approx(1200.0)


def test_patch_nonexistent_category_returns_404(client):
    """⚠️ O `detail` mantém o teste vermelho hoje."""
    response = client.patch(f"/api/categories/{CATEGORIA_INEXISTENTE}", json={"budget": 100.0})

    assert response.status_code == 404
    assert "categoria" in response.json()["detail"].lower()


def test_patch_budget_reaches_the_dashboard_distribution(client, default_account, default_category):
    """`category_distribution` reusa `list_categories` — o novo budget tem que
    aparecer lá sem passo extra."""
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 120.0)

    assert client.patch(
        f"/api/categories/{default_category['id']}", json={"budget": 2500.0}
    ).status_code == 200

    distribution = client.get("/api/dashboard/summary").json()["category_distribution"]
    assert distribution[0]["budget"] == pytest.approx(2500.0)
    assert distribution[0]["spent"] == pytest.approx(120.0)


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

def test_delete_unused_category_returns_204(client):
    category = create_category(client, name="Categoria Sem Uso")

    response = client.delete(f"/api/categories/{category['id']}")

    assert response.status_code == 204
    assert response.content == b""
    assert client.get("/api/categories/").json() == []


def test_delete_category_with_transaction_returns_409(client, default_account, default_category):
    """C9: o caso que hoje viraria 500.

    O router precisa checar a referência **antes** de emitir o DELETE. Deixar o
    `IntegrityError` do RESTRICT subir devolve erro de servidor para uma
    situação de negócio prevista.
    """
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0)

    response = client.delete(f"/api/categories/{default_category['id']}")

    assert response.status_code == 409


def test_delete_category_used_only_by_an_installment_returns_409(client, default_account, default_category):
    """C10: caminho que nenhum teste exercitava.

    Sem transação nenhuma — só um parcelamento apontando para a categoria. O
    `RESTRICT` de `Installment.category_id` bloqueia igual, e uma checagem que
    olhe apenas `Transaction` deixaria passar e cairia em 500 no banco.
    """
    response = client.post(
        "/api/installments/",
        json=installment_payload(default_account, default_category["id"]),
    )
    assert response.status_code == 201, response.text
    assert client.get("/api/transactions").json() == []

    response = client.delete(f"/api/categories/{default_category['id']}")

    assert response.status_code == 409


def test_blocked_delete_leaves_everything_in_place(client, default_account, default_category):
    """⚠️ A parte "nada foi apagado" passaria hoje por acidente (a rota não
    existe). É o 409 que mantém o teste vermelho."""
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0)

    assert client.delete(f"/api/categories/{default_category['id']}").status_code == 409

    assert default_category["id"] in _categories_by_id(client)
    assert len(client.get("/api/transactions").json()) == 1


def test_delete_succeeds_after_its_transactions_are_removed(client, default_account, default_category):
    """Caminho de desbloqueio, ponta a ponta pelos dois endpoints do dia 4.1."""
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()

    assert client.delete(f"/api/categories/{default_category['id']}").status_code == 409

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204
    assert client.delete(f"/api/categories/{default_category['id']}").status_code == 204

    assert client.get("/api/categories/").json() == []


def test_delete_only_removes_the_targeted_category(client, default_account):
    alvo = create_category(client, name="Lazer", icon_name="Gamepad2", color="oklch(0.6 0.2 300)")
    mantida = create_category(client, name="Alimentação")
    create_transaction(client, default_account, mantida["id"], "SAÍDA", 50.0)

    assert client.delete(f"/api/categories/{alvo['id']}").status_code == 204

    remaining = _categories_by_id(client)
    assert list(remaining) == [mantida["id"]]
    assert remaining[mantida["id"]]["spent"] == pytest.approx(50.0)


def test_delete_nonexistent_category_returns_404(client):
    """⚠️ O `detail` separa do 404 de rota inexistente."""
    response = client.delete(f"/api/categories/{CATEGORIA_INEXISTENTE}")

    assert response.status_code == 404
    assert "categoria" in response.json()["detail"].lower()
