"""Comportamento de `category` como FK.

Escrito e aprovado **antes** da implementação, conforme a regra de processo do
CLAUDE.md — enquanto `Transaction.category` / `Installment.category_name` eram
string livre, este arquivo inteiro era vermelho.

Três testes descreviam comportamento que a FK eliminou. Foram removidos dos
arquivos de origem e substituídos aqui:

* `test_aggregation_matches_by_name_and_is_case_sensitive`
  → `test_categories_with_different_casing_are_distinct_rows`
* `test_transactions_in_unregistered_category_are_not_reported`
  → `test_no_transaction_can_be_orphaned_from_aggregation`
* `test_create_installment_category_name_exceeds_max_length`
  → `test_create_installment_with_nonexistent_category_returns_404`
"""

import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app import models
from tests.conftest import (
    create_account,
    create_category,
    create_transaction,
    installment_payload,
)

CATEGORIA_INEXISTENTE = 9999


# ---------------------------------------------------------------------------
# POST /transactions — vínculo com categoria
# ---------------------------------------------------------------------------

def test_create_transaction_with_valid_category(client, default_account, default_category):
    response = create_transaction(client, default_account, default_category["id"])

    assert response.status_code == 201, response.text
    data = response.json()
    # Response aninhada: o front pinta a badge sem uma segunda chamada
    assert data["category"] == {
        "id": default_category["id"],
        "name": "Alimentação",
        "color": "oklch(0.6 0.15 155)",
        "icon_name": "UtensilsCrossed",
    }
    # A string livre deixou de existir no contrato
    assert "category_id" not in data or isinstance(data.get("category_id"), int)


def test_create_transaction_with_nonexistent_category_returns_404(client, default_account):
    """Mesmo padrão de `installment_id`: FK que não resolve é 404, não 422."""
    response = create_transaction(client, default_account, CATEGORIA_INEXISTENTE)

    assert response.status_code == 404, response.text
    assert "categoria" in response.json()["detail"].lower()


def test_nonexistent_category_does_not_corrupt_balance(client, default_account):
    """Ordem de validação: todas as FKs antes de mexer em saldo.

    É a mesma regra que já vale para `installment_id` — se a checagem de
    categoria rodar depois do débito, um ID inválido deixa `current_balance`
    corrompido e o erro só aparece muito depois.
    """
    before = client.get("/api/accounts").json()[0]["current_balance"]

    response = create_transaction(client, default_account, CATEGORIA_INEXISTENTE, amount=250.0)
    assert response.status_code == 404

    after = client.get("/api/accounts").json()[0]["current_balance"]
    assert after == pytest.approx(before)


def test_nonexistent_category_persists_no_transaction(client, default_account):
    create_transaction(client, default_account, CATEGORIA_INEXISTENTE)

    assert client.get("/api/transactions").json() == []


def test_create_transaction_without_category_is_rejected(client, default_account):
    """`category_id` é NOT NULL — não existe transação sem categoria."""
    response = client.post("/api/transactions", json={
        "title": "Sem categoria",
        "type": "SAÍDA",
        "amount": 100.0,
        "date": "2026-08-07",
        "account_id": default_account,
    })

    assert response.status_code == 422
    assert any("category_id" in err["loc"] for err in response.json()["detail"])


def test_legacy_category_string_is_no_longer_accepted(client, default_account, default_category):
    """Contrato antigo tem que quebrar de forma barulhenta, não ser ignorado.

    Se `category: "Alimentação"` continuar passando silenciosamente, cliente
    velho segue gravando lixo sem ninguém perceber.
    """
    response = client.post("/api/transactions", json={
        "title": "Contrato antigo",
        "type": "SAÍDA",
        "amount": 100.0,
        "date": "2026-08-07",
        "category": "Alimentação",
        "account_id": default_account,
    })

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /installments — vínculo com categoria
# ---------------------------------------------------------------------------

def test_create_installment_with_valid_category(client, default_account, default_category):
    response = client.post(
        "/api/installments/",
        json=installment_payload(default_account, default_category["id"]),
    )

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["category"]["id"] == default_category["id"]
    assert data["category"]["name"] == "Alimentação"
    assert "category_name" not in data


def test_create_installment_with_nonexistent_category_returns_404(client, default_account):
    """Substitui o teste de `max_length` do antigo `category_name` (string)."""
    response = client.post(
        "/api/installments/",
        json=installment_payload(default_account, CATEGORIA_INEXISTENTE),
    )

    assert response.status_code == 404
    assert "categoria" in response.json()["detail"].lower()


def test_installment_category_validated_independently_of_account(client, default_category):
    """Conta inválida + categoria válida continua 404 de conta.

    Garante que a checagem nova não mascara nem é mascarada pela antiga.
    """
    response = client.post(
        "/api/installments/",
        json=installment_payload(9999, default_category["id"]),
    )

    assert response.status_code == 404
    assert "conta" in response.json()["detail"].lower()


def test_create_installment_without_category_is_rejected(client, default_account):
    payload = installment_payload(default_account, 1)
    del payload["category_id"]

    response = client.post("/api/installments/", json=payload)

    assert response.status_code == 422
    assert any("category_id" in err["loc"] for err in response.json()["detail"])


# ---------------------------------------------------------------------------
# GET /categories — agregação por join, não por comparação de string
# ---------------------------------------------------------------------------

def test_spent_sums_only_expenses_but_count_includes_all(client, default_account, default_category):
    """A assimetria continua valendo depois da FK: `spent` filtra SAÍDA,
    `txs_count` conta a categoria inteira."""
    cat_id = default_category["id"]
    create_transaction(client, default_account, cat_id, "SAÍDA", 150.0)
    create_transaction(client, default_account, cat_id, "SAÍDA", 100.5)
    create_transaction(client, default_account, cat_id, "ENTRADA", 900.0)

    category = client.get("/api/categories/").json()[0]

    assert category["spent"] == pytest.approx(250.5)
    assert category["txs_count"] == 3


def test_aggregates_are_isolated_per_category(client, default_account):
    alimentacao = create_category(client, name="Alimentação")
    transporte = create_category(client, name="Transporte", icon_name="Car", color="oklch(0.65 0.18 50)")

    create_transaction(client, default_account, alimentacao["id"], "SAÍDA", 200.0)
    create_transaction(client, default_account, transporte["id"], "SAÍDA", 75.0)
    create_transaction(client, default_account, transporte["id"], "SAÍDA", 25.0)

    by_name = {c["name"]: c for c in client.get("/api/categories/").json()}

    assert by_name["Alimentação"]["spent"] == pytest.approx(200.0)
    assert by_name["Alimentação"]["txs_count"] == 1
    assert by_name["Transporte"]["spent"] == pytest.approx(100.0)
    assert by_name["Transporte"]["txs_count"] == 2


def test_category_without_transactions_has_zero_aggregates(client, default_account):
    """O join não pode fazer categoria sem movimento sumir da listagem.

    Regressão do modo de falha clássico: trocar o loop por um INNER JOIN
    silenciosamente descarta as categorias com zero transações.
    """
    create_category(client, name="Alimentação")
    lazer = create_category(client, name="Lazer", icon_name="Gamepad2", color="oklch(0.6 0.2 300)")

    create_transaction(client, default_account, create_category(
        client, name="Transporte", icon_name="Car", color="oklch(0.65 0.18 50)"
    )["id"], "SAÍDA", 50.0)

    data = client.get("/api/categories/").json()

    assert len(data) == 3
    lazer_row = next(c for c in data if c["id"] == lazer["id"])
    assert lazer_row["spent"] == 0.0
    assert lazer_row["txs_count"] == 0


def test_no_transaction_can_be_orphaned_from_aggregation(client, default_account):
    """Invariante que a FK compra — substitui o teste da transação órfã.

    Antes, transação com categoria não cadastrada era aceita e sumia do
    relatório. Agora todo valor de SAÍDA aparece em exatamente uma categoria,
    então a soma dos `spent` fecha com o total gasto.
    """
    alimentacao = create_category(client, name="Alimentação")
    transporte = create_category(client, name="Transporte", icon_name="Car", color="oklch(0.65 0.18 50)")

    create_transaction(client, default_account, alimentacao["id"], "SAÍDA", 342.5)
    create_transaction(client, default_account, transporte["id"], "SAÍDA", 28.9)
    create_transaction(client, default_account, alimentacao["id"], "SAÍDA", 86.4)

    categories = client.get("/api/categories/").json()
    total_spent = sum(c["spent"] for c in categories)

    assert total_spent == pytest.approx(342.5 + 28.9 + 86.4)


def test_categories_with_different_casing_are_distinct_rows(client, default_account):
    """Substitui o teste de case-sensitivity.

    A grafia divergente deixa de ser um bug de agregação e vira o que sempre
    deveria ter sido: duas categorias distintas, cada uma com seu id. Nenhum
    valor se perde no caminho.
    """
    maiuscula = create_category(client, name="Alimentação")
    minuscula = create_category(client, name="alimentação")

    assert maiuscula["id"] != minuscula["id"]

    create_transaction(client, default_account, maiuscula["id"], "SAÍDA", 300.0)
    create_transaction(client, default_account, minuscula["id"], "SAÍDA", 999.0)

    by_id = {c["id"]: c for c in client.get("/api/categories/").json()}

    assert by_id[maiuscula["id"]]["spent"] == pytest.approx(300.0)
    assert by_id[minuscula["id"]]["spent"] == pytest.approx(999.0)


# ---------------------------------------------------------------------------
# Agregações derivadas: reports e dashboard
# ---------------------------------------------------------------------------

def test_reports_top_categories_grouped_by_foreign_key(client, default_account):
    """`reports.py` agrupa por `Transaction.category` string hoje — precisa
    passar a agrupar por id e resolver o nome via join."""
    moradia = create_category(client, name="Moradia", icon_name="Home", color="oklch(0.45 0.04 235)")
    alimentacao = create_category(client, name="Alimentação")

    create_transaction(client, default_account, moradia["id"], "SAÍDA", 2100.0)
    create_transaction(client, default_account, alimentacao["id"], "SAÍDA", 342.5)

    data = client.get("/api/reports/overview").json()

    assert data["top_categories"] == [
        {"name": "Moradia", "value": pytest.approx(2100.0)},
        {"name": "Alimentação", "value": pytest.approx(342.5)},
    ]


def test_dashboard_distribution_follows_the_same_join(client, default_account, default_category):
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 120.0)

    data = client.get("/api/dashboard/summary").json()

    distribution = {c["name"]: c for c in data["category_distribution"]}
    assert distribution["Alimentação"]["spent"] == pytest.approx(120.0)
    assert distribution["Alimentação"]["txs_count"] == 1


def test_recent_transactions_carry_nested_category(client, default_account, default_category):
    create_transaction(client, default_account, default_category["id"], "SAÍDA", 55.9, title="Netflix")

    data = client.get("/api/dashboard/summary").json()

    assert data["recent_transactions"][0]["category"]["name"] == "Alimentação"


# ---------------------------------------------------------------------------
# Enforcement no banco — dependem do PRAGMA foreign_keys ligado
# ---------------------------------------------------------------------------

def test_foreign_keys_pragma_is_enabled_on_app_engine():
    """O app real tem que abrir conexão com FK ligada.

    Sem isso, `ondelete` é decorativo: hoje o projeto declara CASCADE em
    `account_id` e SET NULL em `installment_id`, e o SQLite ignora os dois.
    """
    from app.database import engine as app_engine

    with app_engine.connect() as conn:
        from sqlalchemy import text
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_category_in_use_cannot_be_deleted(fk_session, fk_client):
    """`ondelete="RESTRICT"`: categoria com transação vinculada não sai.

    Não há endpoint de DELETE de categoria hoje — a garantia é de banco, e é
    prospectiva: quando o endpoint existir, ele não vai poder furar isso.
    """
    account_id = create_account(fk_client)
    category = create_category(fk_client)
    create_transaction(fk_client, account_id, category["id"])

    row = fk_session.query(models.Category).filter_by(id=category["id"]).one()
    fk_session.delete(row)

    with pytest.raises(IntegrityError):
        fk_session.commit()


def test_unused_category_can_be_deleted(fk_session, fk_client):
    category = create_category(fk_client, name="Categoria Sem Uso")

    row = fk_session.query(models.Category).filter_by(id=category["id"]).one()
    fk_session.delete(row)
    fk_session.commit()

    assert fk_session.query(models.Category).filter_by(id=category["id"]).first() is None


def test_orphan_category_id_rejected_at_database_level(fk_session, fk_client):
    """Cinto e suspensório: o 404 do router protege a API, o PRAGMA protege
    contra qualquer escrita que não passe pelo router (seed, script, shell)."""
    account_id = create_account(fk_client)

    fk_session.add(models.Transaction(
        title="Escrita direta",
        type="SAÍDA",
        amount=10.0,
        date=datetime.date(2026, 8, 7),
        category_id=CATEGORIA_INEXISTENTE,
        account_id=account_id,
    ))

    with pytest.raises(IntegrityError):
        fk_session.commit()
