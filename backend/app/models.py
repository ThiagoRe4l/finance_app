from datetime import date
from typing import List, Optional
from decimal import Decimal
from sqlalchemy import ForeignKey, String, Numeric, Date, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Tipo único para dinheiro. 12 dígitos, 2 casas: até 9.999.999.999,99.
#
# ⚠️ O SQLite **não** tem tipo decimal nativo — `NUMERIC` é só afinidade e o
# valor é gravado como REAL (`typeof()` devolve `real`). O que se ganha aqui é a
# conversão float→Decimal **na leitura**, quantizada nesta escala, que absorve o
# epsilon do ponto flutuante antes de o valor chegar a qualquer comparação ou ao
# JSON. Não é armazenamento exato; ver a decisão registrada no CLAUDE.md.
MONEY = Numeric(12, 2)

class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    initial_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0.00"), nullable=False)
    current_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0.00"), nullable=False)

    # Relação um-para-muitos com Transações (com cascade delete)
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction", back_populates="account", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Account {self.name} (Balance: {self.current_balance})>"


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # 'ENTRADA' ou 'SAÍDA'
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    installment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("installments.id", ondelete="SET NULL"), nullable=True
    )

    # Relação muitos-para-um com Conta
    account: Mapped["Account"] = relationship("Account", back_populates="transactions")

    # Relação muitos-para-um com Categoria
    category: Mapped["Category"] = relationship("Category", back_populates="transactions")

    # Relação muitos-para-um com Parcelamento (opcional)
    installment: Mapped[Optional["Installment"]] = relationship("Installment")

    def __repr__(self) -> str:
        return f"<Transaction {self.type} - {self.amount} on Account {self.account_id}>"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    icon_name: Mapped[str] = mapped_column(String(50), nullable=False)
    budget: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0.00"), nullable=False)
    color: Mapped[str] = mapped_column(String(50), nullable=False)

    # Relações inversas. Sem cascade de propósito: as FKs são RESTRICT, então
    # categoria em uso não sai — apagar movimentação junto seria perda de dado.
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction", back_populates="category"
    )
    installments: Mapped[List["Installment"]] = relationship(
        "Installment", back_populates="category"
    )

    def __repr__(self) -> str:
        return f"<Category {self.name} (Budget: {self.budget})>"


class Installment(Base):
    __tablename__ = "installments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    total_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    installment_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    current_installment: Mapped[int] = mapped_column(Integer, nullable=False)
    total_installments: Mapped[int] = mapped_column(Integer, nullable=False)
    end_date: Mapped[str] = mapped_column(String(20), nullable=False)  # Ex: "Ago/2026"
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)

    # Relação muitos-para-um com Conta
    account: Mapped["Account"] = relationship("Account")

    # Relação muitos-para-um com Categoria
    category: Mapped["Category"] = relationship("Category", back_populates="installments")

    def __repr__(self) -> str:
        return f"<Installment {self.title} ({self.current_installment}/{self.total_installments})>"


class Investment(Base):
    __tablename__ = "investments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    current_balance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0.00"), nullable=False)

    # Relação um-para-muitos com Histórico de Investimentos
    history: Mapped[List["InvestmentHistory"]] = relationship(
        "InvestmentHistory", back_populates="investment", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Investment {self.name} (Current: {self.current_balance})>"


class InvestmentHistory(Base):
    __tablename__ = "investment_history"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    investment_id: Mapped[int] = mapped_column(ForeignKey("investments.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    balance: Mapped[Decimal] = mapped_column(MONEY, nullable=False)

    # Relação muitos-para-um com Investimento
    investment: Mapped["Investment"] = relationship("Investment", back_populates="history")

    def __repr__(self) -> str:
        return f"<InvestmentHistory for Investment {self.investment_id} on {self.date}: {self.balance}>"
