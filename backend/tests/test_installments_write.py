"""PATCH de parcelamento — dia 4.2.

Escrito **antes** da implementação, mesmo fluxo do 4.1. Hoje
`/api/installments/{id}` não existe em verbo nenhum: o arquivo é vermelho e a
maioria falha com o 404 `"Not Found"` do FastAPI (a rota não casa).

Por isso **todo teste que espera 404 assere também o `detail`** — sem isso ele
passaria hoje pelo motivo errado. Marcados com ⚠️ nos docstrings.

Decisões que este arquivo trava:

* D12 — `PATCH` genérico, sem ação dedicada (`POST /{id}/advance`).
* D13 — `current_installment > total_installments` é estado válido (quitado).
* D15 — `installment_amount`, `total_installments` e `total_amount` ficam
  bloqueados (**409**) quando existe qualquer transação vinculada ao
  parcelamento. O bloqueio é **por mudança de valor**, não por presença do
  campo: reenviar o valor que já está gravado passa, senão um formulário que
  manda o objeto inteiro ficaria inutilizável.

Parcelamento não mexe em saldo. `create_installment` nunca tocou
`current_balance`, e o PATCH mantém isso — há teste explícito, porque é
justamente o tipo de acoplamento que alguém adiciona por engano depois do
trabalho de saldo do 4.1.

Os quatro pontos que estavam em aberto quando este arquivo foi submetido foram
decididos em 07/08/2026 e já estão refletidos aqui: escopo do D15 (três
campos), status 409, bloqueio por mudança de valor, e `account_id` imutável.

> ⚠️ **Pendência conhecida, fora do 4.2:** a D13 tornou "quitado" um estado
> alcançável pela API, e `active_installments_count`/`monthly_committed_amount`
> (dashboard) contam **todos** os parcelamentos, sem filtro. Um 13/12 segue
> contado como ativo e como dinheiro comprometido. Registrado como dia 4.3 no
> CLAUDE.md — nenhum teste daqui fixa esse comportamento, de propósito.
"""

from decimal import Decimal

import pytest

from tests.conftest import (
    money,
    create_transaction,
    installment_payload,
)

CATEGORIA_INEXISTENTE = 9999
PARCELAMENTO_INEXISTENTE = 9999


def _create_installment(client, account_id, category_id, **overrides):
    response = client.post(
        "/api/installments/",
        json=installment_payload(account_id, category_id, **overrides),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _link_transaction(client, account_id, category_id, installment_id, amount=500.0):
    """Transação vinculada ao parcelamento — é o que dispara o bloqueio D15."""
    response = client.post("/api/transactions", json={
        "title": "Parcela lançada",
        "type": "SAÍDA",
        "amount": amount,
        "date": "2026-08-07",
        "category_id": category_id,
        "account_id": account_id,
        "installment_id": installment_id,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _balance(client):
    """Saldo da conta como `Decimal` exato.

    Passa pelo `money()` do conftest, que assere que o campo veio como string
    JSON. Concentrar isso aqui é o que permite as ~20 asserções de saldo deste
    arquivo compararem com `Decimal("9750.00")` em vez de `pytest.approx`.
    """
    return money(client.get("/api/accounts").json()[0]["current_balance"])


# ---------------------------------------------------------------------------
# PATCH — caminho feliz e semântica parcial (D12)
# ---------------------------------------------------------------------------

def test_patch_advances_current_installment(client, default_account, default_category):
    """D12: avançar a parcela é um PATCH comum, não uma ação dedicada.

    É o dado que o mock de `parcelamentos.tsx` expõe (`2/12`, `3/6`, `5/12`) e
    que avança todo mês — o campo mais obviamente mutável do app.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    assert installment["current_installment"] == 2

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"current_installment": 3}
    )

    assert response.status_code == 200, response.text
    assert response.json()["current_installment"] == 3
    assert client.get("/api/installments/").json()[0]["current_installment"] == 3


def test_patch_is_partial_and_preserves_untouched_fields(client, default_account, default_category):
    """Campo omitido não pode ser zerado por omissão."""
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"current_installment": 3}
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["title"] == "Notebook Dell"
    assert money(data["total_amount"]) == Decimal("6000.00")
    assert money(data["installment_amount"]) == Decimal("500.00")
    assert data["total_installments"] == 12
    assert data["end_date"] == "Ago/2026"
    assert data["account_id"] == default_account


def test_patch_title_and_end_date(client, default_account, default_category):
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}",
        json={"title": "Notebook Dell XPS", "end_date": "Set/2026"},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["title"] == "Notebook Dell XPS"
    assert data["end_date"] == "Set/2026"


def test_patch_category_updates_the_nested_ref(client, default_account, default_category):
    from tests.conftest import create_category

    eletronicos = create_category(
        client, name="Eletrônicos", icon_name="Laptop", color="oklch(0.55 0.05 250)"
    )
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"category_id": eletronicos["id"]}
    )

    assert response.status_code == 200, response.text
    assert response.json()["category"] == {
        "id": eletronicos["id"],
        "name": "Eletrônicos",
        "color": "oklch(0.55 0.05 250)",
        "icon_name": "Laptop",
    }


def test_patch_nonexistent_category_returns_404(client, default_account, default_category):
    """⚠️ O assert do `detail` é o que mantém isto vermelho hoje."""
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"category_id": CATEGORIA_INEXISTENTE}
    )

    assert response.status_code == 404
    assert "categoria" in response.json()["detail"].lower()


def test_patch_nonexistent_installment_returns_404(client):
    """⚠️ Idem — `detail` separa do 404 de rota inexistente."""
    response = client.patch(
        f"/api/installments/{PARCELAMENTO_INEXISTENTE}", json={"current_installment": 3}
    )

    assert response.status_code == 404
    assert "parcelamento" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# D13 — quitado é estado válido
# ---------------------------------------------------------------------------

def test_current_installment_may_equal_total(client, default_account, default_category):
    """Última parcela: 12/12."""
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"current_installment": 12}
    )

    assert response.status_code == 200, response.text
    assert response.json()["current_installment"] == 12


def test_current_installment_may_exceed_total(client, default_account, default_category):
    """D13: 13/12 é quitado, não erro de validação.

    Uma validação `current <= total` parece defensiva e quebraria justamente o
    caso de negócio decidido — não é para adicionar.
    """
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"current_installment": 13}
    )

    assert response.status_code == 200, response.text
    assert response.json()["current_installment"] == 13


def test_a_paid_off_installment_still_appears_in_the_listing(client, default_account, default_category):
    """Quitado continua existindo — a decisão foi sobre validade do estado, não
    sobre sumir da listagem."""
    installment = _create_installment(client, default_account, default_category["id"])

    assert client.patch(
        f"/api/installments/{installment['id']}", json={"current_installment": 13}
    ).status_code == 200

    listing = client.get("/api/installments/").json()
    assert len(listing) == 1
    assert listing[0]["current_installment"] == 13


def test_advancing_updates_the_progress_nested_in_transactions(client, default_account, default_category):
    """`TransactionResponse.installment` expõe `current/total` pela relação.

    Avançar a parcela tem que aparecer na transação vinculada sem nenhum passo
    extra — é serialização direta do ORM, o padrão registrado no CLAUDE.md.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    assert client.patch(
        f"/api/installments/{installment['id']}", json={"current_installment": 3}
    ).status_code == 200

    tx = client.get("/api/transactions").json()[0]
    assert tx["installment"] == {"current_installment": 3, "total_installments": 12}


# ---------------------------------------------------------------------------
# D15 — installment_amount e total_installments travados com transação vinculada
# ---------------------------------------------------------------------------

def test_patch_installment_amount_blocked_when_a_transaction_is_linked(client, default_account, default_category):
    """D15: o valor da parcela não pode divergir do que já foi lançado.

    ⚠️ **DECISÃO PENDENTE (status).** Escrevi 409 porque o bloqueio vem da
    *existência de uma linha relacionada*, mesma natureza de C9/C10 — e não de
    uma combinação inválida de campos, que é o caso do 400. A convenção que
    registrei no CLAUDE.md diz "409 — exclusão bloqueada por referência
    existente"; isto a estenderia para "escrita bloqueada". Se preferir 400,
    é troca de um número em 3 testes.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"installment_amount": 600.0}
    )

    assert response.status_code == 409


def test_patch_total_installments_blocked_when_a_transaction_is_linked(client, default_account, default_category):
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"total_installments": 24}
    )

    assert response.status_code == 409


def test_blocked_patch_persists_nothing(client, default_account, default_category):
    """⚠️ A parte "nada mudou" passaria hoje por acidente (a rota não existe).
    É o 409 que segura o teste vermelho."""
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}",
        json={"installment_amount": 600.0, "title": "Deveria não passar"},
    )

    assert response.status_code == 409

    stored = client.get("/api/installments/").json()[0]
    assert money(stored["installment_amount"]) == Decimal("500.00")
    assert stored["title"] == "Notebook Dell"


def test_installment_amount_is_editable_without_linked_transactions(client, default_account, default_category):
    """Sem transação vinculada, o bloqueio não se aplica — corrigir um
    parcelamento recém-cadastrado é caso legítimo."""
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"installment_amount": 600.0}
    )

    assert response.status_code == 200, response.text
    assert money(response.json()["installment_amount"]) == Decimal("600.00")


def test_total_installments_is_editable_without_linked_transactions(client, default_account, default_category):
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"total_installments": 24}
    )

    assert response.status_code == 200, response.text
    assert response.json()["total_installments"] == 24


def test_other_fields_stay_editable_with_a_linked_transaction(client, default_account, default_category):
    """A fronteira do D15: o bloqueio é de **dois campos**, não do recurso.

    O modo de falha óbvio é implementar "parcelamento com transação é
    somente-leitura" — o que travaria justamente o avanço mensal da parcela,
    que é o motivo do 4.2 existir.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}",
        json={"current_installment": 3, "title": "Notebook Dell XPS", "end_date": "Set/2026"},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["current_installment"] == 3
    assert data["title"] == "Notebook Dell XPS"
    assert data["end_date"] == "Set/2026"


def test_editing_unlocks_after_the_transaction_is_unlinked(client, default_account, default_category):
    """Ponta a ponta entre 4.1 e 4.2.

    `PATCH /transactions/{id} {"installment_id": null}` (decisão B6) remove o
    vínculo; com isso o bloqueio D15 deixa de valer. Se o bloqueio olhar algo
    que não seja `installment_id` — uma flag no parcelamento, uma contagem
    cacheada —, ele continua travado e este teste pega.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    tx = _link_transaction(client, default_account, default_category["id"], installment["id"])

    assert client.patch(
        f"/api/installments/{installment['id']}", json={"installment_amount": 600.0}
    ).status_code == 409

    assert client.patch(
        f"/api/transactions/{tx['id']}", json={"installment_id": None}
    ).status_code == 200

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"installment_amount": 600.0}
    )

    assert response.status_code == 200, response.text
    assert money(response.json()["installment_amount"]) == Decimal("600.00")


def test_deleting_the_linked_transaction_also_unlocks_editing(client, default_account, default_category):
    """Mesmo desbloqueio pelo outro caminho do 4.1: DELETE da transação."""
    installment = _create_installment(client, default_account, default_category["id"])
    tx = _link_transaction(client, default_account, default_category["id"], installment["id"])

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"total_installments": 24}
    )

    assert response.status_code == 200, response.text


def test_resending_the_same_installment_amount_is_not_blocked(client, default_account, default_category):
    """⚠️ **DECISÃO PENDENTE (no-op).** Reenviar o valor que já está gravado
    não muda nada, então escrevi como permitido — mesma lógica do
    `test_patch_renaming_to_its_own_name_is_not_a_conflict` do 4.1.

    Importa na prática: um formulário de edição envia o objeto inteiro, então
    `installment_amount` viria no payload mesmo quando o usuário só mexeu no
    título. Bloquear por presença do campo, e não por mudança de valor, tornaria
    a tela de edição inutilizável com qualquer parcela já lançada.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}",
        json={"installment_amount": 500.0, "title": "Notebook Dell XPS"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Notebook Dell XPS"


def test_patch_total_amount_blocked_when_a_transaction_is_linked(client, default_account, default_category):
    """D15 estendida (decisão de 07/08/2026): são **três** campos, não dois.

    `total_amount` não estava no texto original da D15, mas é da mesma família:
    deixá-lo aberto permitiria 12 parcelas de 500 com `total_amount` = 9000 —
    um total que não bate com `installment_amount × total_installments`. A tela
    de parcelamentos calcula "Saldo a pagar" a partir desses campos, então a
    incoerência apareceria direto na UI.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"total_amount": 9000.0}
    )

    assert response.status_code == 409


def test_total_amount_is_editable_without_linked_transactions(client, default_account, default_category):
    """Simetria com os outros dois campos travados: sem transação, edita."""
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"total_amount": 9000.0}
    )

    assert response.status_code == 200, response.text
    assert money(response.json()["total_amount"]) == Decimal("9000.00")


def test_resending_the_same_total_amount_is_not_blocked(client, default_account, default_category):
    """O bloqueio é por mudança de valor, e vale igual para os três campos."""
    installment = _create_installment(client, default_account, default_category["id"])
    _link_transaction(client, default_account, default_category["id"], installment["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}",
        json={"total_amount": 6000.0, "total_installments": 12, "installment_amount": 500.0,
              "current_installment": 3},
    )

    assert response.status_code == 200, response.text
    assert response.json()["current_installment"] == 3


# ---------------------------------------------------------------------------
# account_id e saldo
# ---------------------------------------------------------------------------

def test_patch_cannot_change_account_id(client, default_account, default_category):
    """Regra geral adotada em 07/08/2026: **IDs de relacionamento central são
    imutáveis via PATCH em toda a API.**

    Vale registrar que o motivo é diferente do da A3. Lá o veto era concreto —
    mover uma transação mexeria em dois saldos numa requisição. Parcelamento não
    toca saldo nenhum, então aqui o que sustenta a regra é a uniformidade do
    contrato: `account_id` significa a mesma coisa nos dois recursos e não
    deveria mudar de mutabilidade conforme o endpoint. Para mover um
    parcelamento de conta: excluir e recriar.
    """
    outra = client.post(
        "/api/accounts", json={"name": "Conta Secundária", "initial_balance": 500.0}
    ).json()
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.patch(
        f"/api/installments/{installment['id']}", json={"account_id": outra["id"]}
    )

    assert response.status_code == 422


def test_patch_does_not_touch_the_account_balance(client, default_account, default_category):
    """Parcelamento nunca mexeu em saldo e o PATCH não pode introduzir isso.

    Regressão dirigida ao trabalho do 4.1: depois de escrever estorno e
    reaplicação em `transactions.py`, é plausível alguém "completar" o padrão
    aqui — e passar a debitar a conta duas vezes, no parcelamento e na parcela
    lançada.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    before = _balance(client)

    assert client.patch(
        f"/api/installments/{installment['id']}",
        json={"current_installment": 3, "installment_amount": 600.0},
    ).status_code == 200

    assert _balance(client) == before
