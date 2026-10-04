"""Quem é o dono da requisição, e a sessão de banco que carrega esse dono.

Decisões D-Tenant-3 e D-Tenant-5 no CLAUDE.md.

Duas dependencies, em camadas sobre `current_user` (que continua devolvendo só
o e-mail, e continua sendo a proteção de autenticação):

* `current_owner` resolve a linha de `users` do e-mail autenticado, criando-a
  na primeira vez.
* `owned_db` entrega a sessão marcada com o dono. É o que todo router de dados
  usa no lugar de `get_db`.

A marcação faz duas coisas: carimba o dono em toda linha criada (`owner_id`)
e, pelo evento `_scope_to_owner`, filtra **todo** `SELECT` da sessão pelo dono.

⚠️ **O escopo nunca vai dentro de `get_db`.** A suíte sobrescreve `get_db`; se o
dono morasse lá, o override o removeria junto.
"""

from contextlib import contextmanager
from typing import Iterator

from fastapi import Depends
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import ORMExecuteState, Session, with_loader_criteria

from app import models
from app.auth import current_user
from app.database import get_db
from app.provisioning import provision_user

OWNER_KEY = "owner_id"

# Os models com dono direto (D-Tenant-2). `InvestmentHistory` não está aqui de
# propósito: é alcançado só pelo investimento, que é filtrado — as duas rotas
# de histórico buscam o investimento primeiro e devolvem 404 se ele não for do
# dono. O teste estrutural da varredura trava a lista de tabelas sem dono.
OWNED_MODELS = (
    models.Account,
    models.Category,
    models.Installment,
    models.Investment,
    models.Transaction,
)


@event.listens_for(Session, "do_orm_execute")
def _scope_to_owner(state: ORMExecuteState) -> None:
    """Filtra pelo dono todo `SELECT` de uma sessão marcada (D-Tenant-3).

    `with_loader_criteria` decide sozinho onde a condição vai: no `ON` para a
    tabela que entra por join — preservando o `outerjoin` de `_aggregated_rows`,
    em que categoria sem transação no mês continua aparecendo zerada — e no
    `WHERE` para a tabela principal. Verificado nos formatos de consulta do
    código antes de decidir (tabela na D-Tenant-3).

    Vale também para carregamento de relação (lazy load) e para `refresh`.

    ⚠️ **Só `SELECT`.** `UPDATE`/`DELETE` em massa não passam por aqui — o
    projeto não os usa; edição e exclusão carregam o objeto antes, e o
    carregamento é filtrado. Ressalva 1 da D-Tenant-3.

    Sessão sem marca (scripts, migrations, a sessão direta dos testes) não é
    filtrada. O que garante que toda rota de dados use a sessão marcada é o
    teste estrutural `test_every_data_route_uses_the_owner_scoped_session`.
    """
    if not state.is_select:
        return

    owner = state.session.info.get(OWNER_KEY)
    if owner is None:
        return

    # `owner` é lido **fora** do lambda: o SQLAlchemy só aceita no corpo do
    # lambda variáveis que ele consiga transformar em parâmetro de SQL.
    state.statement = state.statement.options(
        *(
            with_loader_criteria(
                model, lambda cls: cls.owner_id == owner, include_aliases=True
            )
            for model in OWNED_MODELS
        )
    )


def resolve_user(db: Session, email: str, provision: bool = True) -> models.User:
    """A linha de `users` de `email`, criada — e provisionada — na primeira vez.

    O gatilho do provisionamento é **criar a linha**, não "não ter conta": o
    dono migrado já tem linha e dados, e não pode ganhar uma segunda "Conta
    Principal" (D-Tenant-5).

    Criação e provisionamento vão no **mesmo commit**. Separados, um processo
    que morresse no meio deixaria um usuário sem conta que nunca mais seria
    provisionado.

    A corrida de duas primeiras requisições simultâneas cai no `UNIQUE(email)`:
    quem perde desfaz a própria tentativa inteira e relê o usuário que a outra
    criou, já provisionado.

    ⚠️ O `except` também pega `IntegrityError` vindo de `provision_user`. Aí a
    releitura não acha ninguém — não houve corrida — e o erro **original** é
    relançado. Reler com `.one()` trocaria a causa real por um `NoResultFound`
    que aponta para o lugar errado.

    `provision=False` existe só para a fixture `client` da suíte — com as 10
    categorias padrão, cada `create_category(client, "Alimentação")` dos
    testes antigos colidiria (D-Tenant-8).
    """
    user = db.query(models.User).filter(models.User.email == email).one_or_none()
    if user is not None:
        return user

    user = models.User(email=email)
    db.add(user)
    try:
        db.flush()
        if provision:
            provision_user(db, user)
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = db.query(models.User).filter(models.User.email == email).one_or_none()
        if winner is None:
            raise
        return winner

    db.refresh(user)
    return user


def current_owner(
    email: str = Depends(current_user),
    db: Session = Depends(get_db),
) -> models.User:
    """O usuário autenticado, provisionado na primeira requisição.

    Vem **depois** de `current_user`, então a allowlist já foi conferida: e-mail
    revogado leva 401 lá e nunca chega a criar linha nem dado aqui.

    Na resolução da sessão, e não só no login, porque as sessões de 30 dias
    emitidas antes da migration nunca passam pelo login de novo.
    """
    return resolve_user(db, email)


def owned_db(
    db: Session = Depends(get_db),
    owner: models.User = Depends(current_owner),
) -> Session:
    """A sessão da requisição, marcada com o dono.

    O FastAPI reaproveita a mesma instância de `get_db` dentro da requisição,
    então esta é a **mesma** sessão que `current_owner` usou.
    """
    db.info[OWNER_KEY] = owner.id
    return db


@contextmanager
def acting_as(db: Session, user_id: int) -> Iterator[None]:
    """Troca o dono da sessão **para** `user_id` durante o bloco.

    É a única porta para escrever no ledger de outra pessoa — a parte dela numa
    despesa compartilhada (D-Shared-2). O filtro **não é desligado**: dentro do
    bloco, toda consulta enxerga só o dado de `user_id`. Errar o id aqui não
    alcança um terceiro qualquer, só aquele usuário.

    Alternativa descartada: uma opção de execução que pulasse o filtro numa
    consulta. Seria uma brecha de "ver tudo", e o risco desta série inteira é
    justamente uma consulta que esqueceu de filtrar.

    🔴 Só o router da despesa compartilhada usa — travado por
    `test_switching_the_owner_scope_is_confined_to_the_shared_expense_router`.
    """
    previous = db.info.get(OWNER_KEY)
    db.info[OWNER_KEY] = user_id
    try:
        yield
    finally:
        db.info[OWNER_KEY] = previous


def owner_id(db: Session) -> int:
    """Dono da sessão, para carimbar em linha nova.

    Levanta se a sessão não foi marcada: criar linha sem dono é exatamente o
    defeito que esta fatia existe para impedir, e um `KeyError` aqui é melhor
    que um `IntegrityError` lá no banco.
    """
    return db.info[OWNER_KEY]
