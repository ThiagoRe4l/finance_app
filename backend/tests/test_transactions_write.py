"""PATCH e DELETE de transação — dia 4.1.

Escrito **antes** da implementação, conforme a regra de processo do CLAUDE.md.
Hoje `/api/transactions/{id}` não existe em verbo nenhum: o arquivo inteiro é
vermelho, e a maior parte falha com 404 "Not Found" do próprio FastAPI (a rota
não casa), não com o 404 de domínio.

Por isso **todo teste que espera 404 também assere o texto do `detail`**. Sem
isso ele passaria hoje pelo motivo errado — a rota inexistente devolve 404
genérico e a asserção de status sozinha ficaria verde contra um endpoint que
não existe. Os pontos de atenção estão marcados com ⚠️ nos docstrings.

Decisões que este arquivo trava (todas registradas no CLAUDE.md em 07/08/2026):

* A1/A2 — PATCH estorna o efeito antigo e aplica o novo; DELETE estorna.
* A3 — `account_id` não muda na v1.
* A4 — `type` pode trocar; o saldo é conferido aritmeticamente.
* B6 — `installment_id` só pode ser desvinculado (`→ null`).
* B8 — a regra `is_fixed` × `installment_id` sai do schema, vai para o router e
  vira **400** no PATCH, enquanto o POST segue **422**.
"""

from decimal import Decimal

import pytest

from tests.conftest import (
    money,
    create_category,
    create_transaction,
    installment_payload,
)

CATEGORIA_INEXISTENTE = 9999
TRANSACAO_INEXISTENTE = 9999


def _balance(client):
    """Saldo da conta como `Decimal` exato.

    Passa pelo `money()` do conftest, que assere que o campo veio como string
    JSON. Concentrar isso aqui é o que permite as ~20 asserções de saldo deste
    arquivo compararem com `Decimal("9750.00")` em vez de `pytest.approx`.
    """
    return money(client.get("/api/accounts").json()[0]["current_balance"])


def _create_installment(client, account_id, category_id, **overrides):
    response = client.post(
        "/api/installments/",
        json=installment_payload(account_id, category_id, **overrides),
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# PATCH — campos livres e semântica parcial
# ---------------------------------------------------------------------------

def test_patch_updates_title(client, default_account, default_category):
    tx = create_transaction(client, default_account, default_category["id"]).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"title": "Mercado Extra"})

    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Mercado Extra"
    assert client.get("/api/transactions").json()[0]["title"] == "Mercado Extra"


def test_patch_is_partial_and_preserves_untouched_fields(client, default_account, default_category):
    """PATCH, não PUT: campo omitido fica como está.

    O modo de falha que este teste existe para pegar é o schema de update
    declarar defaults em vez de `Optional`/`exclude_unset` — aí `PATCH {title}`
    zera `amount` e `is_fixed` por omissão, silenciosamente.
    """
    tx = create_transaction(
        client, default_account, default_category["id"],
        tx_type="SAÍDA", amount=342.5, date="2026-08-01", title="Original",
    ).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"title": "Renomeada"})

    assert response.status_code == 200, response.text
    data = response.json()
    assert money(data["amount"]) == Decimal("342.50")
    assert data["date"] == "2026-08-01"
    assert data["type"] == "SAÍDA"
    assert data["category"]["id"] == default_category["id"]
    assert data["is_fixed"] is False


def test_patch_is_fixed_is_free(client, default_account, default_category):
    """B7: alternar fixa/variável é inócuo — muda só a badge no front."""
    tx = create_transaction(client, default_account, default_category["id"]).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"is_fixed": True})

    assert response.status_code == 200, response.text
    assert response.json()["is_fixed"] is True


def test_patch_category_moves_the_aggregation(client, default_account):
    """Trocar de categoria tem que mover o valor na agregação, não duplicá-lo."""
    alimentacao = create_category(client, name="Alimentação")
    transporte = create_category(client, name="Transporte", icon_name="Car", color="oklch(0.65 0.18 50)")
    tx = create_transaction(client, default_account, alimentacao["id"], "SAÍDA", 80.0).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": transporte["id"]})

    assert response.status_code == 200, response.text
    assert response.json()["category"]["name"] == "Transporte"

    by_name = {c["name"]: c for c in client.get("/api/categories/").json()}
    assert money(by_name["Alimentação"]["spent"]) == Decimal("0.00")
    assert by_name["Alimentação"]["txs_count"] == 0
    assert money(by_name["Transporte"]["spent"]) == Decimal("80.00")
    assert by_name["Transporte"]["txs_count"] == 1


def test_patch_nonexistent_category_returns_404(client, default_account, default_category):
    """⚠️ O assert do `detail` é o que mantém este teste vermelho hoje: sem ele,
    o 404 genérico da rota inexistente já satisfaria o status."""
    tx = create_transaction(client, default_account, default_category["id"]).json()

    response = client.patch(
        f"/api/transactions/{tx['id']}", json={"category_id": CATEGORIA_INEXISTENTE}
    )

    assert response.status_code == 404
    assert "categoria" in response.json()["detail"].lower()


def test_patch_nonexistent_transaction_returns_404(client, default_account, default_category):
    """⚠️ Mesmo caso: o `detail` distingue 'transação não encontrada' do 404 de
    rota inexistente."""
    response = client.patch(
        f"/api/transactions/{TRANSACAO_INEXISTENTE}", json={"title": "Fantasma"}
    )

    assert response.status_code == 404
    assert "transa" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# PATCH — saldo (A1/A4). Todos conferem o valor final aritmeticamente.
# ---------------------------------------------------------------------------

def test_patch_amount_reverses_the_old_effect_before_applying_the_new(client, default_account, default_category):
    """Conta em 10000, saída de 100 → 9900. Editar para 250 tem que dar 9750.

    A implementação errada óbvia — aplicar só o delta sobre o saldo corrente,
    sem estornar — daria 9650. Os dois números são distintos de propósito.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()
    assert _balance(client) == Decimal("9900.00")

    response = client.patch(f"/api/transactions/{tx['id']}", json={"amount": 250.0})

    assert response.status_code == 200, response.text
    assert _balance(client) == Decimal("9750.00")


def test_patch_type_saida_to_entrada_swings_balance_by_twice_the_amount(client, default_account, default_category):
    """A4: troca de tipo é a operação de maior oscilação — `2 × amount`.

    10000 − 300 = 9700. Virando ENTRADA, o esperado é 10000 + 300 = 10300, e
    não 10000 (estorno sem reaplicação) nem 10300−300 (reaplicação sem estorno).
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 300.0).json()
    assert _balance(client) == Decimal("9700.00")

    response = client.patch(f"/api/transactions/{tx['id']}", json={"type": "ENTRADA"})

    assert response.status_code == 200, response.text
    assert response.json()["type"] == "ENTRADA"
    assert _balance(client) == Decimal("10300.00")


def test_patch_type_entrada_to_saida_swings_the_other_way(client, default_account, default_category):
    tx = create_transaction(client, default_account, default_category["id"], "ENTRADA", 300.0).json()
    assert _balance(client) == Decimal("10300.00")

    response = client.patch(f"/api/transactions/{tx['id']}", json={"type": "SAÍDA"})

    assert response.status_code == 200, response.text
    assert _balance(client) == Decimal("9700.00")


def test_patch_type_and_amount_together(client, default_account, default_category):
    """Estorno tem que usar os valores **antigos** e aplicar os **novos**.

    10000 − 300 = 9700; virando ENTRADA de 500 → 10000 + 500 = 10500. Uma
    implementação que estorne com o valor novo (10000 + 500 a partir de 9700)
    daria 10200.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 300.0).json()

    response = client.patch(
        f"/api/transactions/{tx['id']}", json={"type": "ENTRADA", "amount": 500.0}
    )

    assert response.status_code == 200, response.text
    assert _balance(client) == Decimal("10500.00")


def test_repeated_patches_do_not_drift_the_balance(client, default_account, default_category):
    """Idempotência do estorno: reenviar o mesmo valor não move o saldo.

    Se cada PATCH aplicar delta sem estornar, o saldo cai 200 por requisição e
    o erro só aparece muito depois, sem forma de reconciliar.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 200.0).json()

    for _ in range(3):
        response = client.patch(f"/api/transactions/{tx['id']}", json={"amount": 200.0})
        assert response.status_code == 200, response.text

    assert _balance(client) == Decimal("9800.00")


def test_patch_updating_only_the_title_leaves_the_balance_alone(client, default_account, default_category):
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 150.0).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"title": "Só o título"})

    assert response.status_code == 200, response.text
    assert _balance(client) == Decimal("9850.00")


def test_failed_patch_does_not_corrupt_the_balance(client, default_account, default_category):
    """Mesma ordem de validação do POST: FKs antes de mexer em saldo.

    ⚠️ A asserção de saldo sozinha passaria hoje (nada acontece, porque a rota
    não existe). É o par status+`detail` que mantém o teste vermelho.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()
    before = _balance(client)

    response = client.patch(
        f"/api/transactions/{tx['id']}",
        json={"amount": 5000.0, "category_id": CATEGORIA_INEXISTENTE},
    )

    assert response.status_code == 404
    assert "categoria" in response.json()["detail"].lower()
    assert _balance(client) == before


# ---------------------------------------------------------------------------
# ⚠️ COBERTURA RETROATIVA — escrita DEPOIS da implementação (07/08/2026)
#
# Os dois testes abaixo não estavam no lote aprovado antes do dia 4.1. Cobrem
# comportamento que a implementação precisou introduzir e que nenhuma decisão
# dos blocos A–F previa: o tratamento de `type` no PATCH.
#
# O 400 não era opcional — `_apply_to_balance` ramifica em `type`, então um
# valor arbitrário seria tratado como SAÍDA e gravaria saldo errado em silêncio.
# Mas isso é código novo com teste posterior, e a regra do CLAUDE.md exige que
# esses casos sejam rotulados como tal em vez de contados como cobertura prévia.
# ---------------------------------------------------------------------------

def test_patch_invalid_type_returns_400(client, default_account, default_category):
    """Espelha o 400 que `create_transaction` já devolve para tipo inválido."""
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"type": "TRANSFERÊNCIA"})

    assert response.status_code == 400
    assert "tipo" in response.json()["detail"].lower()


def test_invalid_type_is_rejected_before_the_balance_is_touched(client, default_account, default_category):
    """Mesma ordem de validação do resto do router: nada de saldo antes do 400.

    Sem isso, o estorno rodaria, o `setattr` gravaria o tipo inválido e o saldo
    ficaria com o crédito aplicado — corrompido por um payload que a API
    recusou.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()
    before = _balance(client)

    response = client.patch(
        f"/api/transactions/{tx['id']}", json={"type": "TRANSFERÊNCIA", "amount": 999.0}
    )

    assert response.status_code == 400
    assert _balance(client) == before
    assert money(client.get("/api/transactions").json()[0]["amount"]) == Decimal("100.00")


def test_patch_normalizes_lowercase_type(client, default_account, default_category):
    """O `field_validator` de `TransactionUpdate` — também sem teste prévio.

    `create_transaction` já normalizava; o caminho de update ganhou a mesma
    regra na implementação e ninguém a exercitava.
    """
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 300.0).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"type": "entrada"})

    assert response.status_code == 200, response.text
    assert response.json()["type"] == "ENTRADA"
    assert _balance(client) == Decimal("10300.00")


# ---------------------------------------------------------------------------
# PATCH — account_id proibido (A3)
# ---------------------------------------------------------------------------

def test_patch_cannot_change_account_id(client, default_account, default_category):
    """A3: mover transação entre contas mudaria dois saldos numa requisição.

    ⚠️ **Decisão que eu inferi, confirma antes de aprovar:** o 422 pressupõe
    `extra="forbid"` no schema de update. O default do Pydantic é *ignorar*
    campo desconhecido — o que devolveria 200 sem fazer nada e faria o cliente
    acreditar que moveu a transação. Mesmo raciocínio de
    `test_legacy_category_string_is_no_longer_accepted`.
    """
    outra = client.post("/api/accounts", json={"name": "Conta Secundária", "initial_balance": 500.0})
    assert outra.status_code == 201, outra.text
    tx = create_transaction(client, default_account, default_category["id"]).json()

    response = client.patch(
        f"/api/transactions/{tx['id']}", json={"account_id": outra.json()["id"]}
    )

    assert response.status_code == 422


def test_rejected_account_id_change_leaves_both_balances_alone(client, default_account, default_category):
    outra = client.post(
        "/api/accounts", json={"name": "Conta Secundária", "initial_balance": 500.0}
    ).json()
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"account_id": outra["id"]})
    assert response.status_code == 422

    by_name = {a["name"]: a for a in client.get("/api/accounts").json()}
    assert money(by_name["Conta Principal"]["current_balance"]) == Decimal("9900.00")
    assert money(by_name["Conta Secundária"]["current_balance"]) == Decimal("500.00")


# ---------------------------------------------------------------------------
# PATCH — installment_id só desvincula (B6)
# ---------------------------------------------------------------------------

def test_patch_can_unlink_the_installment(client, default_account, default_category):
    """B6: `installment_id → null` é a única mudança permitida no vínculo.

    Nota de implementação: `None` explícito precisa ser distinguido de "campo
    ausente" (`model_fields_set`/`exclude_unset`). Se o router usar
    `exclude_none`, este teste fica verde por acidente do lado errado — o campo
    seria descartado e o vínculo permaneceria. Daí a asserção dupla abaixo.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    tx = client.post("/api/transactions", json={
        "title": "Parcela",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": "2026-08-07",
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": installment["id"],
    }).json()
    assert tx["installment_id"] == installment["id"]

    response = client.patch(f"/api/transactions/{tx['id']}", json={"installment_id": None})

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["installment_id"] is None
    assert data["installment"] is None


def test_unlinking_the_installment_does_not_touch_the_balance(client, default_account, default_category):
    """Some o vínculo, não o lançamento — o dinheiro já saiu da conta."""
    installment = _create_installment(client, default_account, default_category["id"])
    tx = client.post("/api/transactions", json={
        "title": "Parcela",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": "2026-08-07",
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": installment["id"],
    }).json()
    before = _balance(client)

    response = client.patch(f"/api/transactions/{tx['id']}", json={"installment_id": None})

    assert response.status_code == 200, response.text
    assert _balance(client) == before


def test_patch_cannot_link_a_standalone_transaction_to_an_installment(client, default_account, default_category):
    """B6: vincular depois da criação não é permitido — 400."""
    installment = _create_installment(client, default_account, default_category["id"])
    tx = create_transaction(client, default_account, default_category["id"]).json()
    assert tx["installment_id"] is None

    response = client.patch(
        f"/api/transactions/{tx['id']}", json={"installment_id": installment["id"]}
    )

    assert response.status_code == 400


def test_patch_cannot_move_a_transaction_between_installments(client, default_account, default_category):
    origem = _create_installment(client, default_account, default_category["id"], title="Notebook")
    destino = _create_installment(client, default_account, default_category["id"], title="Cadeira")
    tx = client.post("/api/transactions", json={
        "title": "Parcela",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": "2026-08-07",
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": origem["id"],
    }).json()

    response = client.patch(
        f"/api/transactions/{tx['id']}", json={"installment_id": destino["id"]}
    )

    assert response.status_code == 400


# ---------------------------------------------------------------------------
# B8 — a regra exclusiva sobre estado mesclado
# ---------------------------------------------------------------------------

def test_patch_is_fixed_true_on_an_installment_transaction_returns_400(client, default_account, default_category):
    """O teste central do desvio registrado no CLAUDE.md.

    O payload `{"is_fixed": true}` é válido isoladamente — é o **estado
    mesclado** (transação que já tem `installment_id`) que viola a regra. O
    `@model_validator` do schema não enxerga isso, então a checagem migra para
    o router e o status vira 400.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    tx = client.post("/api/transactions", json={
        "title": "Parcela",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": "2026-08-07",
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": installment["id"],
    }).json()

    response = client.patch(f"/api/transactions/{tx['id']}", json={"is_fixed": True})

    assert response.status_code == 400


def test_unlinking_and_setting_fixed_in_one_request_is_allowed(client, default_account, default_category):
    """Fronteira do 400 acima: o estado **final** é consistente, então passa.

    Se a checagem olhar só para o valor antigo de `installment_id` em vez do
    mesclado, este pedido legítimo é recusado — e o usuário fica sem caminho
    para converter uma parcela em despesa fixa.
    """
    installment = _create_installment(client, default_account, default_category["id"])
    tx = client.post("/api/transactions", json={
        "title": "Parcela",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": "2026-08-07",
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": installment["id"],
    }).json()

    response = client.patch(
        f"/api/transactions/{tx['id']}", json={"installment_id": None, "is_fixed": True}
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["installment_id"] is None
    assert data["is_fixed"] is True


def test_post_keeps_returning_422_for_the_same_rule(client, default_account, default_category):
    """Regressão do desvio: PATCH é 400, POST continua 422.

    ⚠️ **Este teste já passa hoje** — o POST tem o validador no schema desde
    sempre. Não conta como cobertura nova; está aqui para travar a diferença de
    status quando a regra for duplicada no router, que é exatamente o momento em
    que alguém "uniformiza" os dois e quebra o contrato do POST.
    """
    installment = _create_installment(client, default_account, default_category["id"])

    response = client.post("/api/transactions", json={
        "title": "Fixa e parcelada",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": "2026-08-07",
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": installment["id"],
        "is_fixed": True,
    })

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# DELETE (A2)
# ---------------------------------------------------------------------------

def test_delete_returns_204_without_body(client, default_account, default_category):
    """F18: 204 sem corpo.

    Lembrete de contrato: isso quebra o `api.delete` atual do front, que faz
    `response.json()` incondicionalmente. O ajuste no `apiFetch` faz parte da
    entrega — ver "Status da Integração" no CLAUDE.md.
    """
    tx = create_transaction(client, default_account, default_category["id"]).json()

    response = client.delete(f"/api/transactions/{tx['id']}")

    assert response.status_code == 204
    assert response.content == b""
    assert client.get("/api/transactions").json() == []


def test_delete_reverses_an_expense(client, default_account, default_category):
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()
    assert _balance(client) == Decimal("9900.00")

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    assert _balance(client) == Decimal("10000.00")


def test_delete_reverses_an_income(client, default_account, default_category):
    tx = create_transaction(client, default_account, default_category["id"], "ENTRADA", 500.0).json()
    assert _balance(client) == Decimal("10500.00")

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    assert _balance(client) == Decimal("10000.00")


def test_delete_only_reverses_the_deleted_transaction(client, default_account, default_category):
    """10000 − 100 − 250 = 9650; apagando só a de 100 → 9750."""
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 100.0).json()
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 250.0)
    assert _balance(client) == Decimal("9650.00")

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    assert _balance(client) == Decimal("9750.00")
    assert len(client.get("/api/transactions").json()) == 1


def test_delete_removes_the_value_from_the_category_aggregation(client, default_account, default_category):
    tx = create_transaction(client, default_account, default_category["id"], "SAÍDA", 90.0).json()
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 10.0)

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    category = client.get("/api/categories/").json()[0]
    assert money(category["spent"]) == Decimal("10.00")
    assert category["txs_count"] == 1


def test_delete_nonexistent_transaction_returns_404(client):
    """⚠️ O `detail` é o que separa este 404 do 404 de rota inexistente."""
    response = client.delete(f"/api/transactions/{TRANSACAO_INEXISTENTE}")

    assert response.status_code == 404
    assert "transa" in response.json()["detail"].lower()


def test_delete_of_an_installment_transaction_keeps_the_installment(client, default_account, default_category):
    """Apagar a parcela lançada não apaga o parcelamento de origem."""
    installment = _create_installment(client, default_account, default_category["id"])
    tx = client.post("/api/transactions", json={
        "title": "Parcela",
        "type": "SAÍDA",
        "amount": 500.0,
        "date": "2026-08-07",
        "category_id": default_category["id"],
        "account_id": default_account,
        "installment_id": installment["id"],
    }).json()

    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 204

    assert len(client.get("/api/installments/").json()) == 1
