from datetime import date
from typing import List
from sqlalchemy import ForeignKey, String, Float, Date, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    initial_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    current_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Relação um-para-muitos com Transações (com cascade delete)
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction", back_populates="account", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Account {self.name} (Balance: {self.current_balance})>"


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # 'ENTRADA' ou 'SAÍDA'
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)

    # Relação muitos-para-um com Conta
    account: Mapped["Account"] = relationship("Account", back_populates="transactions")

    def __repr__(self) -> str:
        return f"<Transaction {self.type} - {self.amount} on Account {self.account_id}>"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    icon_name: Mapped[str] = mapped_column(String(50), nullable=False)
    budget: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    color: Mapped[str] = mapped_column(String(50), nullable=False)

    def __repr__(self) -> str:
        return f"<Category {self.name} (Budget: {self.budget})>"


class Installment(Base):
    __tablename__ = "installments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    category_name: Mapped[str] = mapped_column(String(50), nullable=False)
    total_amount: Mapped[float] = mapped_column(Float, nullable=False)
    installment_amount: Mapped[float] = mapped_column(Float, nullable=False)
    current_installment: Mapped[int] = mapped_column(Integer, nullable=False)
    total_installments: Mapped[int] = mapped_column(Integer, nullable=False)
    end_date: Mapped[str] = mapped_column(String(20), nullable=False)  # Ex: "Ago/2026"
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)

    # Relação muitos-para-um com Conta
    account: Mapped["Account"] = relationship("Account")

    def __repr__(self) -> str:
        return f"<Installment {self.title} ({self.current_installment}/{self.total_installments})>"


class Investment(Base):
    __tablename__ = "investments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    current_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

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
    balance: Mapped[float] = mapped_column(Float, nullable=False)

    # Relação muitos-para-um com Investimento
    investment: Mapped["Investment"] = relationship("Investment", back_populates="history")

    def __repr__(self) -> str:
        return f"<InvestmentHistory for Investment {self.investment_id} on {self.date}: {self.balance}>"
