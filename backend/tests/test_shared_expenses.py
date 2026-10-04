"""Fatia 4 — despesa compartilhada (D-Shared-1 a 9).

Escrito **antes** da implementação, conforme o processo do CLAUDE.md.

O modelo (D-Shared-2): um grupo em `shared_expenses` e **uma SAÍDA comum por
participante**, dona dele, na conta e na categoria dele. Por isso quase nada
aqui fala de agregação: saldo, `spent`, dashboard e relatório já funcionam
sobre transação comum. O que estes testes travam é o que é novo — a divisão,
a propagação das edições, as travas, e a única exceção ao isolamento: o
participante vê o grupo.

Saldo (D-Shared-1, confirmado): cada um debita **só a própria parte**. Sem
quem-pagou, sem dívida. O provisionamento dá R$ 0,00 de saldo inicial
(D-Tenant-5), então o saldo de cada um, depois de uma divisão, é exatamente
menos a sua parte.

Por que vermelho hoje
---------------------
As rotas não existem: quase tudo falha com 404 `"Not Found"` do FastAPI. Por
isso os testes **assertam o corpo** e não só o status onde a expectativa é
404 — mesma regra dos `*_write.py`: um 404 de rota ausente não pode passar
por 404 de regra de negócio.
"""

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from tests.conftest import money

ANA = "ana@example.com"
BIA = "bia@example.com"
CAIO = "caio@example.com"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture(name="people")
def people_fixture(client_as):
    """Ana, Bia e Caio, todos já logados — logo, provisionados e elegíveis.

    ⚠️ **Pré-requisito das fatias 2 e 3, conferido explicitamente.** Sem
    provisionamento não há conta, e sem isolamento a "primeira conta" de Bia
    seria a de Ana. Nesses casos os testes daqui morreriam em `IndexError` ou
    passariam por acidente — então a fixture para com uma mensagem que diz o
    que falta, e o teste aparece como ERROR de setup, não como FAILED.
    """
    clients = {email: client_as(email) for email in (ANA, BIA, CAIO)}
    for client in clients.values():
        assert client.get("/api/auth/me").status_code == 200

    for email, client in clients.items():
        accounts = client.get("/api/accounts").json()
        assert len(accounts) == 1 and money(accounts[0]["initial_balance"]) == 0, (
            f"pré-requisito ausente (fatias 2/3): {email} deveria ter só a própria "
            f"Conta Principal provisionada com R$ 0,00, tem {accounts}"
        )
    return clients


def _first_account(client):
    return client.get("/api/accounts").json()[0]["id"]


def _category_id(client, name):
    return next(c["id"] for c in client.get("/api/categories").json() if c["name"] == name)


def _balance(client):
    return money(client.get("/api/accounts").json()[0]["current_balance"])


def _share(client, amount, participants, title="Pizza", category="Alimentação", **extra):
    payload = {
        "title": title,
        "amount": amount,
        "date": datetime.date.today().isoformat(),
        "account_id": _first_account(client),
        "category_id": _category_id(client, category),
        "participants": participants,
        **extra,
    }
    return client.post("/api/shared-expenses", json=payload)


def _created(response):
    assert response.status_code == 201, response.text
    return response.json()


def _parts(group):
    return {part["email"]: money(part["amount"]) for part in group["parts"]}


def _my_part(client, group_id):
    """A transação do usuário que pertence ao grupo."""
    matches = [
        t for t in client.get("/api/transactions").json()
        if t.get("shared_expense_id") == group_id
    ]
    assert len(matches) == 1, matches
    return matches[0]


def _detail(response):
    """`detail` de um erro de regra — nunca o `"Not Found"` de rota ausente."""
    detail = response.json().get("detail")
    assert detail != "Not Found", "a rota não existe"
    return detail


# ---------------------------------------------------------------------------
# D-Shared-1 e 3: divisão e saldo
# ---------------------------------------------------------------------------

def test_splitting_with_one_person_debits_half_from_each(people):
    """🔴 A leitura confirmada em 02/10/2026: R$ 100 com uma pessoa = R$ 50 cada."""
    ana, bia = people[ANA], people[BIA]

    group = _created(_share(ana, "100.00", [BIA]))

    assert money(group["total_amount"]) == Decimal("100.00")
    assert group["creator"] == ANA
    assert _parts(group) == {ANA: Decimal("50.00"), BIA: Decimal("50.00")}
    assert _balance(ana) == Decimal("-50.00")
    assert _balance(bia) == Decimal("-50.00")


def test_the_leftover_cent_goes_to_the_creator(people):
    """R$ 100 ÷ 3 não fecha em centavos. A sobra é do criador — regra fixa, para
    que a mesma divisão dê sempre o mesmo resultado."""
    group = _created(_share(people[ANA], "100.00", [BIA, CAIO]))

    assert _parts(group) == {
        ANA: Decimal("33.34"), BIA: Decimal("33.33"), CAIO: Decimal("33.33"),
    }


@pytest.mark.parametrize("amount", ["0.03", "0.05", "10.00", "99.99", "1000.01", "12345.67"])
def test_parts_always_add_up_to_the_total(people, amount):
    """🔴 O invariante que o banco não garante (D-Shared-2), por `Decimal` exato.

    Um centavo perdido aqui some do app inteiro: nenhum agregado soma o grupo,
    todos somam as partes.
    """
    group = _created(_share(people[ANA], amount, [BIA, CAIO]))

    assert sum(_parts(group).values(), Decimal("0.00")) == Decimal(amount)
    assert money(group["total_amount"]) == Decimal(amount)


@pytest.mark.parametrize("edit_to", [None, "10.00"])
def test_every_ledger_holds_exactly_the_part_the_response_shows(people, edit_to):
    """🔴 A resposta **recalcula** as partes pela divisão; o ledger tem as que
    foram gravadas. Os dois têm que ser o mesmo número, centavo a centavo.

    ⚠️ Escrito **depois** da implementação, rotulado como tal: a mutação "ledger
    do criador sem a sobra de centavo, resposta intacta" deixou os 56 testes
    deste arquivo verdes. Todo teste olhava a resposta, ou dividia sem sobra.
    Este fecha isso com R$ 100 em três — o caso em que o criador carrega 1
    centavo a mais — na criação e depois de editar o valor.
    """
    ana = people[ANA]
    group = _created(_share(ana, "100.00", [BIA, CAIO]))
    if edit_to is not None:
        response = ana.patch(f"/api/shared-expenses/{group['id']}", json={"amount": edit_to})
        assert response.status_code == 200, response.text
        group = response.json()

    shown = _parts(group)
    in_ledgers = {
        email: money(_my_part(people[email], group["id"])["amount"]) for email in (ANA, BIA, CAIO)
    }

    assert in_ledgers == shown
    assert sum(in_ledgers.values(), Decimal("0.00")) == money(group["total_amount"])


def test_a_part_below_one_cent_is_rejected(people):
    """R$ 0,02 em três não dá um centavo a cada um. 422: depende só do payload."""
    response = _share(people[ANA], "0.02", [BIA, CAIO])

    assert response.status_code == 422


def test_each_part_is_a_regular_outflow_in_the_participants_own_ledger(people):
    """D-Shared-2: a parte é SAÍDA comum, na conta de quem a recebe — é isso que
    faz saldo, `spent` e dashboard funcionarem sem mudança."""
    bia = people[BIA]
    group = _created(_share(people[ANA], "100.00", [BIA]))

    part = _my_part(bia, group["id"])

    assert part["type"] == "SAÍDA"
    assert money(part["amount"]) == Decimal("50.00")
    assert part["account_id"] == _first_account(bia)
    assert part["title"] == "Pizza"


def test_each_dashboard_counts_only_its_own_part(people):
    ana, bia = people[ANA], people[BIA]
    _created(_share(ana, "100.00", [BIA]))

    for client in (ana, bia):
        summary = client.get("/api/dashboard/summary").json()
        assert money(summary["total_expenses"]) == Decimal("50.00")


def test_a_regular_transaction_has_no_shared_expense(people):
    """`shared_expense_id` entra no contrato de `TransactionResponse`, nulo para
    transação comum — o front distingue as duas por ele."""
    ana = people[ANA]
    response = ana.post("/api/transactions", json={
        "title": "Mercado", "type": "SAÍDA", "amount": "10.00",
        "date": datetime.date.today().isoformat(),
        "category_id": _category_id(ana, "Alimentação"),
        "account_id": _first_account(ana),
    })

    assert response.status_code == 201
    assert "shared_expense_id" in response.json()
    assert response.json()["shared_expense_id"] is None


def test_a_failure_midway_through_the_fan_out_leaves_nothing_behind(people, session):
    """🔴 Falha real no meio do fan-out: a parte da criadora e a de Bia já foram
    adicionadas à sessão quando a de Caio falha — ele não tem conta.

    Nada pode sobrar: nem grupo, nem parte em ledger nenhum. Escrito junto da
    revisão da fatia 4 (não estava nos vermelhos aprovados).

    Caio fica sem conta por SQL direto: não há rota que apague conta, e é
    justamente o estado que um script ou uma limpeza manual produziria.
    """
    ana, bia, caio = people[ANA], people[BIA], people[CAIO]
    session.execute(
        text("DELETE FROM accounts WHERE id = :id"), {"id": _first_account(caio)}
    )
    session.commit()

    response = _share(ana, "90.00", [BIA, CAIO])

    assert response.status_code == 409
    assert CAIO in _detail(response)
    assert ana.get("/api/shared-expenses").json() == []
    assert bia.get("/api/shared-expenses").json() == []
    for client in (ana, bia):
        assert all(t.get("shared_expense_id") is None for t in client.get("/api/transactions").json())
    assert _balance(ana) == _balance(bia) == Decimal("0.00")


# ---------------------------------------------------------------------------
# D-Shared-5: categoria da parte
# ---------------------------------------------------------------------------

def test_the_part_lands_in_the_participants_category_with_the_same_name(people):
    bia = people[BIA]
    group = _created(_share(people[ANA], "100.00", [BIA], category="Alimentação"))

    assert _my_part(bia, group["id"])["category"]["id"] == _category_id(bia, "Alimentação")


def test_an_unknown_category_name_falls_back_to_shared(people):
    """Categoria que só a criadora tem → "Compartilhado", criada sob demanda e
    reaproveitada na próxima vez."""
    ana, bia = people[ANA], people[BIA]
    ana.post("/api/categories", json={
        "name": "Viagem da Ana", "icon_name": "Plane", "budget": "0", "color": "oklch(0.5 0 0)",
    })

    first = _created(_share(ana, "100.00", [BIA], category="Viagem da Ana"))
    second = _created(_share(ana, "40.00", [BIA], category="Viagem da Ana"))

    assert _my_part(bia, first["id"])["category"]["name"] == "Compartilhado"
    assert _my_part(bia, second["id"])["category"]["name"] == "Compartilhado"
    names = [c["name"] for c in bia.get("/api/categories").json()]
    assert names.count("Compartilhado") == 1


def test_participant_can_recategorize_their_own_part(people):
    bia = people[BIA]
    group = _created(_share(people[ANA], "100.00", [BIA]))
    part = _my_part(bia, group["id"])

    response = bia.patch(
        f"/api/transactions/{part['id']}", json={"category_id": _category_id(bia, "Lazer")}
    )

    assert response.status_code == 200
    assert response.json()["category"]["name"] == "Lazer"


# ---------------------------------------------------------------------------
# D-Shared-6: travas nas rotas de transação
# ---------------------------------------------------------------------------

_LOCKED_FIELDS = {
    "title": "Outro título",
    "amount": "1.00",
    "date": "2026-01-01",
    "type": "ENTRADA",
    "is_fixed": True,
    "installment_id": None,
}


@pytest.mark.parametrize("field", sorted(_LOCKED_FIELDS))
@pytest.mark.parametrize("who", [ANA, BIA])
def test_a_part_cannot_be_edited_outside_the_group(people, field, who):
    """🔴 Mexer numa parte por fora quebraria a soma do grupo.

    Vale para a criadora também: até a parte dela só muda pelo grupo.
    `installment_id: null` entra porque desvincular é a única edição de
    parcelamento que transação comum aceita — e aqui não há o que desvincular.
    """
    group = _created(_share(people[ANA], "100.00", [BIA]))
    client = people[who]
    part = _my_part(client, group["id"])

    response = client.patch(f"/api/transactions/{part['id']}", json={field: _LOCKED_FIELDS[field]})

    assert response.status_code == 409, response.text
    assert _detail(response)


@pytest.mark.parametrize("who", [ANA, BIA])
def test_a_part_cannot_be_deleted_outside_the_group(people, who):
    group = _created(_share(people[ANA], "100.00", [BIA]))
    client = people[who]
    part = _my_part(client, group["id"])

    response = client.delete(f"/api/transactions/{part['id']}")

    assert response.status_code == 409
    assert _detail(response)
    assert _balance(client) == Decimal("-50.00")


# ---------------------------------------------------------------------------
# D-Shared-4 e 7: quem participa, e o que o payload aceita
# ---------------------------------------------------------------------------

def test_participants_are_the_allowlist_members_who_already_logged_in(people, client_as):
    """Allowlist ∩ `users`, menos o próprio.

    `nunca@` está na allowlist e nunca fez requisição: sem conta, não pode
    receber parte. `outra@` e `pessoa@` estão na allowlist base da suíte e
    também nunca logaram.
    """
    client_as("nunca@example.com")  # entra na allowlist, sem requisição

    response = people[ANA].get("/api/participants")

    assert response.status_code == 200
    assert {p["email"] for p in response.json()} == {BIA, CAIO}


def test_a_revoked_user_is_no_longer_a_participant_option(people, client_as):
    client_as.revoke(CAIO)

    response = people[ANA].get("/api/participants")

    assert response.status_code == 200, response.text
    assert {p["email"] for p in response.json()} == {BIA}


def test_the_creator_cannot_list_themselves(people):
    """O criador sempre participa (D-Shared-4); listá-lo é contar duas vezes.
    400 e não 422: só se sabe quem é "si mesmo" olhando a sessão."""
    response = _share(people[ANA], "100.00", [BIA, ANA])

    assert response.status_code == 400
    assert _detail(response)


@pytest.mark.parametrize("email", ["estranho@example.com", "nunca@example.com"])
def test_a_participant_outside_the_universe_is_not_found(people, client_as, email):
    """Fora da allowlist, ou nela sem nunca ter logado → 404, como FK que não
    resolve."""
    client_as("nunca@example.com")

    response = _share(people[ANA], "100.00", [email])

    assert response.status_code == 404
    assert _detail(response)


@pytest.mark.parametrize("participants", [[], [BIA, BIA]])
def test_participants_must_be_a_non_empty_list_without_repeats(people, participants):
    assert _share(people[ANA], "100.00", participants).status_code == 422


@pytest.mark.parametrize("extra", [
    {"type": "ENTRADA"}, {"is_fixed": True}, {"installment_id": 1},
])
def test_out_of_scope_fields_are_rejected(people, extra):
    """D-Shared-7: só SAÍDA, sem parcelamento, sem `is_fixed` — e campo fora do
    contrato é 422 barulhento, não ignorado em silêncio."""
    assert _share(people[ANA], "100.00", [BIA], **extra).status_code == 422


# ---------------------------------------------------------------------------
# D-Shared-9: quem vê o grupo
# ---------------------------------------------------------------------------

def test_a_participant_sees_the_whole_group(people):
    group = _created(_share(people[ANA], "100.00", [BIA]))

    response = people[BIA].get(f"/api/shared-expenses/{group['id']}")

    assert response.status_code == 200
    assert response.json()["creator"] == ANA
    assert _parts(response.json()) == {ANA: Decimal("50.00"), BIA: Decimal("50.00")}


def test_groups_are_listed_for_every_participant(people):
    group = _created(_share(people[ANA], "100.00", [BIA]))

    for email in (ANA, BIA):
        ids = [g["id"] for g in people[email].get("/api/shared-expenses").json()]
        assert ids == [group["id"]]


def test_a_non_participant_sees_nothing(people):
    """🔴 A única exceção ao isolamento não pode virar regra.

    O grupo fica fora do filtro automático (ressalva 3 da D-Tenant-3) — então é
    aqui, e na varredura, que se prova que a regra explícita funciona.
    """
    caio = people[CAIO]
    group = _created(_share(people[ANA], "100.00", [BIA]))

    assert caio.get("/api/shared-expenses").json() == []
    response = caio.get(f"/api/shared-expenses/{group['id']}")
    assert response.status_code == 404
    assert _detail(response)


# ---------------------------------------------------------------------------
# D-Shared-8: edição e exclusão
# ---------------------------------------------------------------------------

def test_changing_the_amount_recomputes_every_part(people):
    ana, bia = people[ANA], people[BIA]
    group = _created(_share(ana, "100.00", [BIA]))

    response = ana.patch(f"/api/shared-expenses/{group['id']}", json={"amount": "60.00"})

    assert response.status_code == 200
    assert _parts(response.json()) == {ANA: Decimal("30.00"), BIA: Decimal("30.00")}
    assert _balance(ana) == Decimal("-30.00")
    assert _balance(bia) == Decimal("-30.00")


def test_adding_a_participant_creates_their_part_and_recomputes(people):
    ana, caio = people[ANA], people[CAIO]
    group = _created(_share(ana, "100.00", [BIA]))

    response = ana.patch(f"/api/shared-expenses/{group['id']}", json={"participants": [BIA, CAIO]})

    assert response.status_code == 200
    assert _parts(response.json()) == {
        ANA: Decimal("33.34"), BIA: Decimal("33.33"), CAIO: Decimal("33.33"),
    }
    assert _balance(caio) == Decimal("-33.33")


def test_removing_a_participant_deletes_their_part(people):
    ana, bia = people[ANA], people[BIA]
    group = _created(_share(ana, "100.00", [BIA, CAIO]))

    response = ana.patch(f"/api/shared-expenses/{group['id']}", json={"participants": [CAIO]})

    assert response.status_code == 200
    assert BIA not in _parts(response.json())
    assert _balance(bia) == Decimal("0.00")
    assert bia.get(f"/api/shared-expenses/{group['id']}").status_code == 404


def test_title_and_date_propagate_to_every_part(people):
    ana, bia = people[ANA], people[BIA]
    group = _created(_share(ana, "100.00", [BIA]))
    new_date = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

    ana.patch(f"/api/shared-expenses/{group['id']}", json={"title": "Jantar", "date": new_date})

    for client in (ana, bia):
        part = _my_part(client, group["id"])
        assert (part["title"], part["date"]) == ("Jantar", new_date)


def test_unknown_fields_in_the_group_patch_are_rejected(people):
    """`account_id` não muda depois de criado — mesma regra geral do dia 4."""
    group = _created(_share(people[ANA], "100.00", [BIA]))

    response = people[ANA].patch(f"/api/shared-expenses/{group['id']}", json={"account_id": 1})

    assert response.status_code == 422


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_only_the_creator_edits_or_deletes(people, method):
    """403, não 404: a participante **vê** o grupo, então "não existe" seria
    mentira. É o caso que estende a convenção de status (D-Shared-8)."""
    group = _created(_share(people[ANA], "100.00", [BIA]))
    path = f"/api/shared-expenses/{group['id']}"
    kwargs = {"json": {"title": "Meu"}} if method == "patch" else {}

    response = getattr(people[BIA], method)(path, **kwargs)

    assert response.status_code == 403
    assert _detail(response)


def test_deleting_the_group_removes_every_part_and_restores_balances(people):
    ana, bia = people[ANA], people[BIA]
    group = _created(_share(ana, "100.00", [BIA]))

    assert ana.delete(f"/api/shared-expenses/{group['id']}").status_code == 204

    assert _balance(ana) == Decimal("0.00")
    assert _balance(bia) == Decimal("0.00")
    assert bia.get(f"/api/shared-expenses/{group['id']}").status_code == 404


# ---------------------------------------------------------------------------
# D-Shared-8: quem saiu da allowlist (decidido em 03/10/2026)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("change", [
    {"amount": "60.00"},
    {"participants": [BIA, CAIO]},  # recalcularia a parte de Bia
    {"participants": [CAIO]},       # apagaria a parte de Bia
])
def test_changes_that_would_touch_a_revoked_participant_are_blocked(people, client_as, change):
    """🔴 Mudar o ledger de quem já saiu, sem ela poder ver, é o caso bloqueado."""
    ana = people[ANA]
    group = _created(_share(ana, "100.00", [BIA]))
    client_as.revoke(BIA)

    response = ana.patch(f"/api/shared-expenses/{group['id']}", json=change)

    assert response.status_code == 409
    assert _detail(response)


def test_title_can_still_change_with_a_revoked_participant(people, client_as):
    """`title`/`date` ficaram fora do bloqueio: a decisão nomeou valor e
    participantes."""
    ana = people[ANA]
    group = _created(_share(ana, "100.00", [BIA]))
    client_as.revoke(BIA)

    response = ana.patch(f"/api/shared-expenses/{group['id']}", json={"title": "Jantar"})

    assert response.status_code == 200


def test_deleting_still_works_and_reaches_the_revoked_ledger(people, client_as, session):
    """Excluir é sempre permitido, inclusive quando remove a parte de quem saiu.

    A conferência é pelo banco porque a revogada não consegue mais logar para
    olhar.
    """
    ana = people[ANA]
    group = _created(_share(ana, "100.00", [BIA]))
    client_as.revoke(BIA)

    assert ana.delete(f"/api/shared-expenses/{group['id']}").status_code == 204

    remaining = session.execute(
        text("SELECT COUNT(*) FROM transactions WHERE shared_expense_id = :id"),
        {"id": group["id"]},
    ).scalar()
    assert remaining == 0


# ---------------------------------------------------------------------------
# Schema: o CASCADE que garante "excluir o grupo = excluir as partes"
# ---------------------------------------------------------------------------

def test_deleting_a_group_cascades_to_its_parts_at_database_level(fk_session):
    """Em SQL cru, pela razão de `test_fk_cascade.py`: o router apagar as partes
    uma a uma deixaria o teste verde sem o `ON DELETE CASCADE`."""
    db = fk_session
    db.execute(text("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"))
    db.execute(text(
        "INSERT INTO accounts (id, name, initial_balance, owner_id) VALUES (1, 'C', 0, 1)"
    ))
    db.execute(text(
        "INSERT INTO categories (id, name, icon_name, budget, color, owner_id) "
        "VALUES (1, 'X', 'Home', 0, 'oklch(0.5 0 0)', 1)"
    ))
    db.execute(text(
        "INSERT INTO shared_expenses (id, creator_id, title, total_amount, date) "
        "VALUES (1, 1, 'Pizza', 100, :date)"
    ), {"date": datetime.date.today()})
    db.execute(text(
        "INSERT INTO transactions (id, title, type, amount, date, category_id, is_fixed, "
        "account_id, owner_id, shared_expense_id) "
        "VALUES (1, 'Pizza', 'SAÍDA', 100, :date, 1, false, 1, 1, 1)"
    ), {"date": datetime.date.today()})
    db.commit()

    db.execute(text("DELETE FROM shared_expenses WHERE id = 1"))
    db.commit()

    assert db.execute(text("SELECT COUNT(*) FROM transactions")).scalar() == 0
