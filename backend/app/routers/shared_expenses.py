"""Despesa compartilhada — D-Shared-1 a 9 no CLAUDE.md.

O grupo não move dinheiro. O efeito no saldo são as **partes**: uma SAÍDA comum
por participante, dona dele, na conta e na categoria dele (D-Shared-2). Por
isso nada fora deste arquivo precisa saber que o grupo existe.

Duas coisas atravessam o isolamento aqui, e cada uma tem seu mecanismo:

* **Ver o grupo** — a visibilidade é "sou participante", não "sou dono". O
  grupo e a tabela de participantes ficam fora do filtro automático, e
  `_load_visible` é a regra explícita (D-Shared-9).
* **Escrever no ledger de outro** — a parte de cada participante é dele. Isso
  passa por `acting_as`, que troca o dono da sessão **para** o participante em
  vez de desligar o filtro.

As partes devolvidas na resposta são **recalculadas** pela divisão igualitária,
não lidas das transações: ler a parte dos outros exigiria furar o filtro, e a
divisão é determinística (`shared_split.py`).
"""

from decimal import Decimal
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas, settings
from app.shared_split import PartBelowOneCent, split_equally
from app.tenancy import acting_as, current_owner, owned_db

router = APIRouter(tags=["Shared expenses"])

GROUP_NOT_FOUND = "Despesa compartilhada não encontrada."

# Destino da parte quando o participante não tem categoria com o nome da que o
# criador escolheu (D-Shared-5). Criada sob demanda, uma vez por usuário.
SHARED_CATEGORY = {
    "name": "Compartilhado",
    "icon_name": "Users",
    "budget": Decimal("0.00"),
    "color": "oklch(0.6 0.1 280)",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_active(email: str) -> bool:
    """Ainda está na allowlist. Lido a cada chamada, como em `current_user`."""
    return settings.is_email_allowed(email, settings.resolve_allowed_emails())


def _resolve_participants(db: Session, emails: List[str]) -> List[models.User]:
    """Allowlist ∩ quem já tem linha em `users` (D-Shared-4).

    Fora desse universo é 404, como FK que não resolve. Quem nunca logou não
    tem conta para receber a parte — e criar dado para quem nunca entrou foi
    descartado.
    """
    users = []
    for email in emails:
        user = db.query(models.User).filter(models.User.email == email).one_or_none()
        if user is None or not _is_active(email):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Participante não encontrado: {email}.",
            )
        users.append(user)
    return users


def _load_visible(db: Session, group_id: int, me: models.User) -> models.SharedExpense:
    """O grupo, se eu participo dele. Senão, 404 — o mesmo de inexistente.

    🔴 É a regra explícita que substitui o filtro automático para o grupo
    (ressalva 3 da D-Tenant-3). Responder 403 para não participante
    confirmaria que o id existe (D-Tenant-4).
    """
    group = db.query(models.SharedExpense).filter(models.SharedExpense.id == group_id).one_or_none()
    if group is None or me.id not in {p.user_id for p in group.participants}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=GROUP_NOT_FOUND)
    return group


def _require_creator(group: models.SharedExpense, me: models.User) -> None:
    """403, não 404: quem chega aqui é participante e **vê** o grupo —
    "não existe" seria mentira (D-Shared-8)."""
    if group.creator_id != me.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Só quem criou a despesa compartilhada pode alterá-la ou excluí-la.",
        )


def _others(group: models.SharedExpense) -> List[str]:
    return sorted(p.user.email for p in group.participants if p.user_id != group.creator_id)


def _split(amount: Decimal, creator: str, others: List[str]) -> Dict[str, Decimal]:
    try:
        return split_equally(amount, creator, others)
    except PartBelowOneCent:
        # No POST isto é 422 pelo schema. Aqui o número de participantes pode
        # vir do banco — estado mesclado, 400 pela convenção do dia 4.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O valor não dá um centavo a cada participante.",
        )


def _response(group: models.SharedExpense) -> schemas.SharedExpenseResponse:
    """Partes recalculadas pela divisão, não lidas do ledger alheio."""
    creator = group.creator.email
    others = _others(group)
    parts = split_equally(group.total_amount, creator, others)
    return schemas.SharedExpenseResponse(
        id=group.id,
        title=group.title,
        total_amount=group.total_amount,
        date=group.date,
        creator=creator,
        parts=[schemas.SharedExpensePart(email=e, amount=parts[e]) for e in [creator, *others]],
    )


def _shared_category(db: Session, user_id: int) -> models.Category:
    category = db.query(models.Category).filter(
        models.Category.name == SHARED_CATEGORY["name"]
    ).one_or_none()
    if category is None:
        category = models.Category(**SHARED_CATEGORY, owner_id=user_id)
        db.add(category)
        db.flush()
    return category


def _create_part(
    db: Session,
    group: models.SharedExpense,
    user: models.User,
    amount: Decimal,
    category_name: str,
) -> None:
    """A parte de um participante que não é o criador, no ledger **dele**.

    Conta: a primeira dele (D-Shared-5 — mesma debt de "`account_id` sem
    seletor"). Categoria: a de mesmo nome exato, ou "Compartilhado".
    """
    with acting_as(db, user.id):
        account = db.query(models.Account).order_by(models.Account.id).first()
        if account is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{user.email} não tem conta para receber a parte.",
            )
        category = db.query(models.Category).filter(
            models.Category.name == category_name
        ).one_or_none() or _shared_category(db, user.id)

        db.add(models.Transaction(
            title=group.title,
            type="SAÍDA",
            amount=amount,
            date=group.date,
            category_id=category.id,
            account_id=account.id,
            is_fixed=False,
            shared_expense_id=group.id,
            owner_id=user.id,
        ))
        db.flush()


def _parts_of(db: Session, group: models.SharedExpense, user_id: int) -> List[models.Transaction]:
    with acting_as(db, user_id):
        return db.query(models.Transaction).filter(
            models.Transaction.shared_expense_id == group.id
        ).all()


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------

@router.get("/participants", response_model=List[schemas.Participant])
def list_participants(
    db: Session = Depends(owned_db),
    me: models.User = Depends(current_owner),
):
    """Com quem dá para dividir: allowlist ∩ quem já logou, menos eu.

    ⚠️ Expõe os e-mails da allowlist aos outros usuários — aceito na D-Shared-4,
    é o mecanismo de seleção.
    """
    users = db.query(models.User).filter(models.User.id != me.id).order_by(models.User.email).all()
    return [schemas.Participant(email=u.email) for u in users if _is_active(u.email)]


@router.post(
    "/shared-expenses",
    response_model=schemas.SharedExpenseResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_shared_expense(
    payload: schemas.SharedExpenseCreate,
    db: Session = Depends(owned_db),
    me: models.User = Depends(current_owner),
):
    if me.email in payload.participants:
        # 400 e não 422: só se sabe quem é "eu" olhando a sessão.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Você já participa da despesa que cria; liste só os outros.",
        )

    # Conta e categoria do criador, pelo filtro: as de outro dono não existem
    # para ele (D-Tenant-4).
    account = db.query(models.Account).filter(models.Account.id == payload.account_id).first()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conta não encontrada.")
    category = db.query(models.Category).filter(models.Category.id == payload.category_id).first()
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoria não encontrada.")

    others = _resolve_participants(db, payload.participants)
    parts = _split(payload.amount, me.email, [u.email for u in others])

    group = models.SharedExpense(
        creator_id=me.id, title=payload.title, total_amount=payload.amount, date=payload.date
    )
    group.participants = [models.SharedExpenseParticipant(user_id=u.id) for u in [me, *others]]
    db.add(group)
    db.flush()

    db.add(models.Transaction(
        title=group.title,
        type="SAÍDA",
        amount=parts[me.email],
        date=group.date,
        category_id=category.id,
        account_id=account.id,
        is_fixed=False,
        shared_expense_id=group.id,
        owner_id=me.id,
    ))
    for user in others:
        _create_part(db, group, user, parts[user.email], category.name)

    db.commit()
    db.refresh(group)
    return _response(group)


@router.get("/shared-expenses", response_model=List[schemas.SharedExpenseResponse])
def list_shared_expenses(
    db: Session = Depends(owned_db),
    me: models.User = Depends(current_owner),
):
    """Os grupos de que participo — inclusive os que criei."""
    groups = (
        db.query(models.SharedExpense)
        .join(models.SharedExpenseParticipant)
        .filter(models.SharedExpenseParticipant.user_id == me.id)
        .order_by(models.SharedExpense.date.desc(), models.SharedExpense.id.desc())
        .all()
    )
    return [_response(g) for g in groups]


@router.get("/shared-expenses/{shared_expense_id}", response_model=schemas.SharedExpenseResponse)
def get_shared_expense(
    shared_expense_id: int,
    db: Session = Depends(owned_db),
    me: models.User = Depends(current_owner),
):
    return _response(_load_visible(db, shared_expense_id, me))


@router.patch("/shared-expenses/{shared_expense_id}", response_model=schemas.SharedExpenseResponse)
def update_shared_expense(
    shared_expense_id: int,
    payload: schemas.SharedExpenseUpdate,
    db: Session = Depends(owned_db),
    me: models.User = Depends(current_owner),
):
    """Só o criador. Valor e participantes recalculam a parte de todos.

    🔴 Se a mudança de valor ou de participantes alcançar alguém que saiu da
    allowlist, 409 (decidido em 03/10/2026): mudar o ledger de quem já saiu,
    sem ela poder ver, é o caso bloqueado. `title`/`date` não estão no bloqueio.
    """
    group = _load_visible(db, shared_expense_id, me)
    _require_creator(group, me)
    data = payload.model_dump(exclude_unset=True)

    members = {p.user.email: p.user for p in group.participants}
    current_others = set(members) - {me.email}
    new_others = set(data["participants"]) if data.get("participants") is not None else current_others
    if me.email in new_others:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Você já participa da despesa que criou; liste só os outros.",
        )

    added_emails = new_others - current_others
    removed_emails = current_others - new_others
    # Só os **novos** passam pela checagem de universo: um participante que já
    # está no grupo e saiu da allowlist cai no 409 abaixo, não num 404.
    added = _resolve_participants(db, sorted(added_emails))

    new_amount = data["amount"] if data.get("amount") is not None else group.total_amount
    if new_amount != group.total_amount or added_emails or removed_emails:
        gone = sorted(email for email in current_others | new_others if not _is_active(email))
        if gone:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Não é possível alterar valor ou participantes: "
                    f"{', '.join(gone)} não tem mais acesso ao aplicativo."
                ),
            )

    parts = _split(new_amount, me.email, sorted(new_others))

    if data.get("title") is not None:
        group.title = data["title"]
    if data.get("date") is not None:
        group.date = data["date"]
    group.total_amount = new_amount

    # A categoria do criador define o nome procurado para quem entra agora.
    category_name = _parts_of(db, group, me.id)[0].category.name

    for email in removed_emails:
        user = members[email]
        for part in _parts_of(db, group, user.id):
            db.delete(part)
        group.participants = [p for p in group.participants if p.user_id != user.id]

    for email in (new_others - added_emails) | {me.email}:
        for part in _parts_of(db, group, members[email].id):
            part.amount = parts[email]
            part.title = group.title
            part.date = group.date

    for user in added:
        group.participants.append(models.SharedExpenseParticipant(user_id=user.id))
        _create_part(db, group, user, parts[user.email], category_name)

    db.commit()
    db.refresh(group)
    return _response(group)


@router.delete("/shared-expenses/{shared_expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shared_expense(
    shared_expense_id: int,
    db: Session = Depends(owned_db),
    me: models.User = Depends(current_owner),
):
    """Só o criador. Sempre permitido — inclusive quando remove a parte de
    quem saiu da allowlist (decidido em 03/10/2026).

    As partes são apagadas explicitamente, uma por participante, além do
    `ON DELETE CASCADE` do banco. Mesmo princípio dos 404 do projeto: o router
    não depende do banco para segurar a barra — e o SQLite sem o PRAGMA não
    aplicaria o CASCADE.
    """
    group = _load_visible(db, shared_expense_id, me)
    _require_creator(group, me)

    for participant in list(group.participants):
        for part in _parts_of(db, group, participant.user_id):
            db.delete(part)

    db.delete(group)
    db.commit()
