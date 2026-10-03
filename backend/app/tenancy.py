"""Quem é o dono da requisição, e a sessão de banco que carrega esse dono.

Decisões D-Tenant-3 e D-Tenant-5 no CLAUDE.md.

Duas dependencies, em camadas sobre `current_user` (que continua devolvendo só
o e-mail, e continua sendo a proteção de autenticação):

* `current_owner` resolve a linha de `users` do e-mail autenticado, criando-a
  na primeira vez.
* `owned_db` entrega a sessão marcada com o dono. É o que todo router de dados
  usa no lugar de `get_db`.

⚠️ **Estado na fatia 1:** a marcação existe e é usada para **carimbar o dono na
escrita**. O filtro de leitura (o evento `do_orm_execute`) é a fatia 2 — até lá,
leitura ainda vê tudo.

⚠️ **O escopo nunca vai dentro de `get_db`.** A suíte sobrescreve `get_db`; se o
dono morasse lá, o override o removeria junto.
"""

from fastapi import Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.auth import current_user
from app.database import get_db

OWNER_KEY = "owner_id"


def current_owner(
    email: str = Depends(current_user),
    db: Session = Depends(get_db),
) -> models.User:
    """A linha de `users` do e-mail autenticado. Cria na primeira vez.

    Vem **depois** de `current_user`, então a allowlist já foi conferida: e-mail
    revogado leva 401 lá e nunca chega a criar linha aqui.

    A corrida de duas primeiras requisições simultâneas cai no `UNIQUE(email)`:
    quem perde relê a linha que a outra criou.
    """
    user = db.query(models.User).filter(models.User.email == email).one_or_none()
    if user is not None:
        return user

    user = models.User(email=email)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return db.query(models.User).filter(models.User.email == email).one()

    db.refresh(user)
    return user


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


def owner_id(db: Session) -> int:
    """Dono da sessão, para carimbar em linha nova.

    Levanta se a sessão não foi marcada: criar linha sem dono é exatamente o
    defeito que esta fatia existe para impedir, e um `KeyError` aqui é melhor
    que um `IntegrityError` lá no banco.
    """
    return db.info[OWNER_KEY]
