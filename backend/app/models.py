from datetime import date
from typing import List, Optional
from decimal import Decimal
from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Tipo único para dinheiro. 12 dígitos, 2 casas: até 9.999.999.999,99.
#
# ⚠️ Sob **SQLite** isto não é armazenamento exato: o SQLite não tem tipo
# decimal nativo, `NUMERIC` é só afinidade e o valor vai para o disco como REAL.
# O que se ganha é a conversão float→Decimal **na leitura**, quantizada nesta
# escala, que absorve o epsilon antes de o valor chegar a uma comparação ou ao
# JSON.
#
# ⚠️ **Isso foi apurado à mão, não é coberto por teste.** Um `typeof()` num
# console em 08/08/2026 (SQLAlchemy 2.0.51 / SQLite 3.40.1); nenhuma asserção da
# suíte verifica o tipo de armazenamento, e nenhuma regressão aqui seria pega
# automaticamente. Trate como observação datada, não como invariante travada.
#
# Sob **Postgres** a ressalva não se aplica: `NUMERIC(12,2)` é exato de verdade.
# Ver a decisão do pivô no CLAUDE.md.
MONEY = Numeric(12, 2)


def _owner_column(table: str):
    """`owner_id` das tabelas com dono (D-Tenant-2).

    A FK tem nome explícito porque o `downgrade` no SQLite (modo batch) só
    consegue remover constraint que ele encontra pelo nome.

    `RESTRICT`: apagar um usuário com dado financeiro tem que ser decisão
    explícita, não efeito colateral. Não há rota que apague usuário.

    Indexada: o filtro da D-Tenant-3 põe `owner_id = ?` em **toda** consulta, e
    o Postgres não indexa coluna de FK sozinho.
    """
    return mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT", name=f"fk_{table}_owner_id_users"),
        nullable=False,
        index=True,
    )


class User(Base):
    """Identidade, não autorização (D-Tenant-1).

    Estar aqui não dá acesso a nada: quem decide é a allowlist, reconferida a
    cada requisição (D-Auth-2). A linha existe para ser **dono** — e o momento
    em que ela é criada é o gatilho do provisionamento (D-Tenant-5).

    O e-mail é guardado sempre em minúsculo, como a allowlist e a sessão.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)

    def __repr__(self) -> str:
        return f"<User {self.email}>"


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        # Nome único **por dono**, não global: o segundo usuário também tem a
        # sua "Conta Principal" (D-Tenant-2).
        UniqueConstraint("owner_id", "name", name="uq_accounts_owner_id_name"),
        # Alvo das FKs compostas de `transactions` e `installments`.
        UniqueConstraint("id", "owner_id", name="uq_accounts_id_owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    initial_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0.00"), nullable=False)
    owner_id: Mapped[int] = _owner_column("accounts")

    # ⚠️ **Não existe `current_balance` aqui.** O saldo é derivado do ledger na
    # leitura (`app/account_balance.py`), não armazenado. A coluna foi removida
    # em vez de mantida como campo morto: campo que ninguém mais atualiza é
    # campo que alguém preenche errado, e voltaria a divergir do ledger sem nada
    # denunciar. `AccountResponse.current_balance` continua existindo como campo
    # **derivado** — mesma natureza de `spent`/`txs_count` em `categories.py`.

    # Relação um-para-muitos com Transações (com cascade delete)
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction",
        back_populates="account",
        cascade="all, delete-orphan",
        primaryjoin="Account.id == foreign(Transaction.account_id)",
    )

    def __repr__(self) -> str:
        return f"<Account {self.name} (Initial: {self.initial_balance})>"


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        # 🔴 FKs compostas (D-Tenant-2): o **banco** recusa transação de um dono
        # apontando para conta ou categoria de outro. Com FK simples a conta
        # "existe" e passa.
        ForeignKeyConstraint(
            ["account_id", "owner_id"], ["accounts.id", "accounts.owner_id"],
            name="fk_transactions_account_owner", ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["category_id", "owner_id"], ["categories.id", "categories.owner_id"],
            name="fk_transactions_category_owner", ondelete="RESTRICT",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # 'ENTRADA' ou 'SAÍDA'
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    account_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # ⚠️ FK **simples**, de propósito. Composta com `SET NULL` anularia também
    # `owner_id`, que é NOT NULL — e o `SET NULL (coluna)` do Postgres 15 não
    # existe no SQLite (D-Vercel-1). Aqui a proteção é o filtro da D-Tenant-3.
    installment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("installments.id", ondelete="SET NULL"), nullable=True
    )
    # Parte de uma despesa compartilhada (D-Shared-2). CASCADE: excluir o grupo
    # é excluir as partes — no ledger de cada participante.
    shared_expense_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("shared_expenses.id", ondelete="CASCADE", name="fk_transactions_shared_expense"),
        nullable=True,
        index=True,
    )
    owner_id: Mapped[int] = _owner_column("transactions")

    # As relações juntam só pelo id: a igualdade de dono é garantida pela FK
    # composta no banco. Juntar também por `owner_id` faria duas relações
    # escreverem a mesma coluna, e o SQLAlchemy acusaria o conflito.
    account: Mapped["Account"] = relationship(
        "Account",
        back_populates="transactions",
        primaryjoin="Account.id == foreign(Transaction.account_id)",
    )

    category: Mapped["Category"] = relationship(
        "Category",
        back_populates="transactions",
        primaryjoin="Category.id == foreign(Transaction.category_id)",
    )

    # Relação muitos-para-um com Parcelamento (opcional)
    installment: Mapped[Optional["Installment"]] = relationship("Installment")

    def __repr__(self) -> str:
        return f"<Transaction {self.type} - {self.amount} on Account {self.account_id}>"


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_categories_owner_id_name"),
        UniqueConstraint("id", "owner_id", name="uq_categories_id_owner_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    icon_name: Mapped[str] = mapped_column(String(50), nullable=False)
    budget: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0.00"), nullable=False)
    color: Mapped[str] = mapped_column(String(50), nullable=False)
    owner_id: Mapped[int] = _owner_column("categories")

    # Relações inversas. Sem cascade de propósito: as FKs são RESTRICT, então
    # categoria em uso não sai — apagar movimentação junto seria perda de dado.
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction",
        back_populates="category",
        primaryjoin="Category.id == foreign(Transaction.category_id)",
    )
    installments: Mapped[List["Installment"]] = relationship(
        "Installment",
        back_populates="category",
        primaryjoin="Category.id == foreign(Installment.category_id)",
    )

    def __repr__(self) -> str:
        return f"<Category {self.name} (Budget: {self.budget})>"


class Installment(Base):
    __tablename__ = "installments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["account_id", "owner_id"], ["accounts.id", "accounts.owner_id"],
            name="fk_installments_account_owner", ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["category_id", "owner_id"], ["categories.id", "categories.owner_id"],
            name="fk_installments_category_owner", ondelete="RESTRICT",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    installment_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    current_installment: Mapped[int] = mapped_column(Integer, nullable=False)
    total_installments: Mapped[int] = mapped_column(Integer, nullable=False)
    end_date: Mapped[str] = mapped_column(String(20), nullable=False)  # Ex: "Ago/2026"
    account_id: Mapped[int] = mapped_column(Integer, nullable=False)
    owner_id: Mapped[int] = _owner_column("installments")

    # Relação muitos-para-um com Conta
    account: Mapped["Account"] = relationship(
        "Account", primaryjoin="Account.id == foreign(Installment.account_id)"
    )

    # Relação muitos-para-um com Categoria
    category: Mapped["Category"] = relationship(
        "Category",
        back_populates="installments",
        primaryjoin="Category.id == foreign(Installment.category_id)",
    )

    def __repr__(self) -> str:
        return f"<Installment {self.title} ({self.current_installment}/{self.total_installments})>"


class Investment(Base):
    __tablename__ = "investments"
    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_investments_owner_id_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    current_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0.00"), nullable=False)
    owner_id: Mapped[int] = _owner_column("investments")

    # Relação um-para-muitos com Histórico de Investimentos
    history: Mapped[List["InvestmentHistory"]] = relationship(
        "InvestmentHistory", back_populates="investment", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Investment {self.name} (Current: {self.current_balance})>"


class SharedExpense(Base):
    """Despesa dividida entre usuários (D-Shared-2).

    O grupo **não move dinheiro**: o efeito no saldo são as partes, uma SAÍDA
    comum por participante, em `transactions` com `shared_expense_id`. Por isso
    saldo, `spent`, dashboard e relatório funcionam sem saber que o grupo
    existe.

    Sem `owner_id`: a visibilidade é "sou participante", não "sou dono"
    (D-Shared-9). Fica fora do filtro automático, com regra explícita no
    router.
    """

    __tablename__ = "shared_expenses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    creator_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_shared_expenses_creator"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)

    creator: Mapped["User"] = relationship("User")
    participants: Mapped[List["SharedExpenseParticipant"]] = relationship(
        "SharedExpenseParticipant", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<SharedExpense {self.title} ({self.total_amount})>"


class SharedExpenseParticipant(Base):
    """Quem participa de cada grupo — o criador inclusive.

    É a fonte de verdade de "sou participante" e da lista de partes. Sem esta
    tabela, as duas coisas exigiriam ler as transações de **outros** donos, ou
    seja, furar o filtro da D-Tenant-3. Com ela, ninguém lê o ledger alheio: as
    partes da resposta são recalculadas pela divisão igualitária, que é
    determinística.
    """

    __tablename__ = "shared_expense_participants"

    shared_expense_id: Mapped[int] = mapped_column(
        ForeignKey("shared_expenses.id", ondelete="CASCADE", name="fk_participants_shared_expense"),
        primary_key=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_participants_user"),
        primary_key=True,
        index=True,
    )

    user: Mapped["User"] = relationship("User")


class InvestmentHistory(Base):
    """Sem `owner_id`: filha com CASCADE, herda o dono pelo investimento
    (D-Tenant-2). Uma coluna própria seria um segundo lugar para divergir."""

    __tablename__ = "investment_history"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    investment_id: Mapped[int] = mapped_column(ForeignKey("investments.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    balance: Mapped[Decimal] = mapped_column(MONEY, nullable=False)

    # Relação muitos-para-um com Investimento
    investment: Mapped["Investment"] = relationship("Investment", back_populates="history")

    def __repr__(self) -> str:
        return f"<InvestmentHistory for Investment {self.investment_id} on {self.date}: {self.balance}>"
