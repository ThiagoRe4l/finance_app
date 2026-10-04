"""O que um usuário novo recebe no primeiro acesso (D-Tenant-5).

Substitui o `init_db.py`, que populava conta e categorias **sem dono**. A lista
de categorias é a mesma do seed antigo; o que muda é que cada usuário ganha a
sua, e a conta nasce com saldo inicial **R$ 0,00** — num usuário real, os
R$ 10.000 do seed seriam dado errado desde o primeiro minuto.

Quem chama é `tenancy.current_owner`, e só quando **cria** a linha de `users`.
O gatilho não é "não ter conta": o dono migrado (D-Tenant-6) já tem linha e
dados, e não pode ganhar uma segunda "Conta Principal" por cima.
"""

from decimal import Decimal

from sqlalchemy.orm import Session

from app import models

MAIN_ACCOUNT_NAME = "Conta Principal"

DEFAULT_CATEGORIES = (
    {"name": "Moradia", "icon_name": "Home", "budget": Decimal("2500.00"), "color": "oklch(0.45 0.04 235)"},
    {"name": "Alimentação", "icon_name": "UtensilsCrossed", "budget": Decimal("1500.00"), "color": "oklch(0.6 0.15 155)"},
    {"name": "Transporte", "icon_name": "Car", "budget": Decimal("600.00"), "color": "oklch(0.65 0.18 50)"},
    {"name": "Lazer", "icon_name": "Gamepad2", "budget": Decimal("400.00"), "color": "oklch(0.6 0.2 300)"},
    {"name": "Saúde", "icon_name": "HeartPulse", "budget": Decimal("300.00"), "color": "oklch(0.6 0.2 25)"},
    {"name": "Educação", "icon_name": "GraduationCap", "budget": Decimal("250.00"), "color": "oklch(0.55 0.15 200)"},
    {"name": "Compras", "icon_name": "ShoppingBag", "budget": Decimal("200.00"), "color": "oklch(0.55 0.05 250)"},
    {"name": "Receita", "icon_name": "Plus", "budget": Decimal("0.00"), "color": "oklch(0.94 0.06 155)"},
    # Aparecem nos formulários de transação e parcelamento desde a integração
    # das telas; sem elas, o front oferecia categoria que o usuário não tinha.
    {"name": "Eletrônicos", "icon_name": "Laptop", "budget": Decimal("300.00"), "color": "oklch(0.55 0.12 265)"},
    {"name": "Móveis", "icon_name": "Sofa", "budget": Decimal("150.00"), "color": "oklch(0.58 0.08 85)"},
)


def provision_user(db: Session, user: models.User) -> None:
    """Adiciona à sessão a conta e as categorias padrão de `user`.

    Não faz commit: quem chama cria o usuário e o provisiona **na mesma
    transação**. Usuário sem conta, se o processo morresse no meio, seria um
    usuário que nunca mais é provisionado — a linha já existiria.
    """
    db.add(models.Account(
        name=MAIN_ACCOUNT_NAME, initial_balance=Decimal("0.00"), owner_id=user.id
    ))
    for category in DEFAULT_CATEGORIES:
        db.add(models.Category(**category, owner_id=user.id))
