from pydantic import BaseModel, Field, ConfigDict, field_validator
import datetime
from typing import List, Optional

class AccountBase(BaseModel):
    name: str = Field(..., max_length=100, description="Nome da conta bancária")
    initial_balance: float = Field(0.0, description="Saldo inicial da conta")

class AccountCreate(AccountBase):
    pass

class AccountResponse(AccountBase):
    id: int
    current_balance: float

    # Configuração moderna para compatibilidade com SQLAlchemy no Pydantic v2
    model_config = ConfigDict(from_attributes=True)

class TransactionCreate(BaseModel):
    type: str = Field(..., description="Tipo de transação: 'ENTRADA' ou 'SAÍDA'")
    amount: float = Field(..., gt=0, description="Valor da transação")
    date: datetime.date = Field(..., description="Data da transação")
    category: str = Field(..., max_length=50, description="Categoria da transação")
    account_id: int = Field(..., description="ID da conta bancária relacionada")

    @field_validator('type')
    @classmethod
    def normalize_type(cls, v: str) -> str:
        if isinstance(v, str):
            return v.upper()
        return v

class TransactionResponse(BaseModel):
    id: int
    type: str
    amount: float
    date: datetime.date
    category: str
    account_id: int

    model_config = ConfigDict(from_attributes=True)


class InvestmentCreate(BaseModel):
    name: str = Field(..., max_length=100, description="Nome do investimento")
    current_balance: float = Field(..., description="Aporte ou saldo inicial do investimento")


class InvestmentResponse(BaseModel):
    id: int
    name: str
    current_balance: float

    # Configuração moderna para compatibilidade com SQLAlchemy no Pydantic v2
    model_config = ConfigDict(from_attributes=True)


class InvestmentHistoryCreate(BaseModel):
    date: datetime.date = Field(..., description="Data do registro de histórico")
    balance: float = Field(..., description="Saldo do investimento na data informada")


class InvestmentHistoryResponse(BaseModel):
    id: int
    date: datetime.date
    balance: float
    investment_id: int

    model_config = ConfigDict(from_attributes=True)


# Novas Schemas para Categoria e Parcelamento
class CategoryBase(BaseModel):
    name: str = Field(..., max_length=50, description="Nome da categoria")
    icon_name: str = Field(..., max_length=50, description="Nome do ícone da Lucide")
    budget: float = Field(0.0, description="Orçamento mensal para a categoria")
    color: str = Field(..., max_length=50, description="Cor em formato OKLCH ou HEX")

class CategoryCreate(CategoryBase):
    pass

class CategoryResponse(CategoryBase):
    id: int
    spent: float = 0.0
    txs_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class InstallmentBase(BaseModel):
    title: str = Field(..., max_length=100)
    category_name: str = Field(..., max_length=50)
    total_amount: float
    installment_amount: float
    current_installment: int
    total_installments: int
    end_date: str
    account_id: int

class InstallmentCreate(InstallmentBase):
    pass

class InstallmentResponse(InstallmentBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


# Schemas para Agregações (Dashboard e Relatórios)
class MonthlyFlow(BaseModel):
    month: str
    income: float
    outcome: float

class DashboardSummary(BaseModel):
    total_balance: float
    total_revenues: float
    total_expenses: float
    total_savings: float
    monthly_flow: List[MonthlyFlow]
    recent_transactions: List[TransactionResponse]
    category_distribution: List[CategoryResponse]
    active_installments_count: int
    monthly_committed_amount: float

class CategoryReport(BaseModel):
    name: str
    value: float

class ReportSummary(BaseModel):
    total_revenues: float
    total_expenses: float
    average_savings: float
    monthly_comparative: List[MonthlyFlow]
    top_categories: List[CategoryReport]
    insights: List[str]

