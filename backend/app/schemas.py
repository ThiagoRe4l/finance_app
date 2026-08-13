from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
import datetime
from decimal import Decimal
from typing import List, Optional

class AccountBase(BaseModel):
    name: str = Field(..., max_length=100, description="Nome da conta bancária")
    initial_balance: Decimal = Field(Decimal("0.00"), description="Saldo inicial da conta")

class AccountCreate(AccountBase):
    pass

class AccountResponse(AccountBase):
    id: int
    current_balance: Decimal

    # Configuração moderna para compatibilidade com SQLAlchemy no Pydantic v2
    model_config = ConfigDict(from_attributes=True)

class InstallmentProgress(BaseModel):
    current_installment: int
    total_installments: int

    model_config = ConfigDict(from_attributes=True)


class CategoryRef(BaseModel):
    """Categoria aninhada nas responses de transação e parcelamento.

    Carrega `color` e `icon_name` junto do nome para que o front pinte a badge
    sem uma segunda chamada a /categories. Serialização direta do ORM pela
    relação — ver "Design Patterns" no CLAUDE.md; toda listagem que expõe este
    campo precisa de `joinedload`, senão vira N+1.
    """
    id: int
    name: str
    color: str
    icon_name: str

    model_config = ConfigDict(from_attributes=True)


class TransactionCreate(BaseModel):
    title: str = Field(..., max_length=150, description="Título/descrição da transação")
    type: str = Field(..., description="Tipo de transação: 'ENTRADA' ou 'SAÍDA'")
    amount: Decimal = Field(..., gt=0, description="Valor da transação")
    date: datetime.date = Field(..., description="Data da transação")
    category_id: int = Field(..., description="ID da categoria cadastrada")
    is_fixed: bool = Field(False, description="Indica se é uma despesa fixa/recorrente")
    account_id: int = Field(..., description="ID da conta bancária relacionada")
    installment_id: Optional[int] = Field(None, description="ID do parcelamento de origem, se houver")

    @field_validator('type')
    @classmethod
    def normalize_type(cls, v: str) -> str:
        if isinstance(v, str):
            return v.upper()
        return v

    @model_validator(mode='after')
    def check_fixed_and_installment_exclusive(self):
        if self.installment_id is not None and self.is_fixed:
            raise ValueError("Uma transação não pode ser fixa e parcelada ao mesmo tempo.")
        return self

class TransactionUpdate(BaseModel):
    """Payload parcial do `PATCH /transactions/{id}`.

    Todo campo é opcional: o que não vier no corpo não é tocado. O router lê
    `model_dump(exclude_unset=True)` para distinguir "não enviado" de "enviado
    como null" — a diferença importa em `installment_id`, onde `null` é um
    pedido explícito de desvínculo.

    `account_id` **não existe aqui de propósito** (decisão A3). Com
    `extra="forbid"` a tentativa vira 422; sem ele, o Pydantic descartaria o
    campo em silêncio e a resposta 200 faria o cliente acreditar que a
    transação mudou de conta.

    A regra `is_fixed` × `installment_id` **não** está neste schema — ver
    `update_transaction` no router. Num payload parcial ela depende do estado
    mesclado com a linha do banco, que o schema não enxerga.
    """
    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = Field(None, max_length=150)
    type: Optional[str] = Field(None, description="'ENTRADA' ou 'SAÍDA'")
    amount: Optional[Decimal] = Field(None, gt=0)
    date: Optional[datetime.date] = None
    category_id: Optional[int] = None
    is_fixed: Optional[bool] = None
    installment_id: Optional[int] = Field(
        None, description="Só aceita null (desvincular) — ver decisão B6"
    )

    @field_validator('type')
    @classmethod
    def normalize_type(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str):
            return v.upper()
        return v


class TransactionResponse(BaseModel):
    id: int
    title: str
    type: str
    amount: Decimal
    date: datetime.date
    category: CategoryRef
    is_fixed: bool
    account_id: int
    installment_id: Optional[int] = None
    installment: Optional[InstallmentProgress] = None

    model_config = ConfigDict(from_attributes=True)


class InvestmentCreate(BaseModel):
    name: str = Field(..., max_length=100, description="Nome do investimento")
    current_balance: Decimal = Field(..., description="Aporte ou saldo inicial do investimento")


class InvestmentResponse(BaseModel):
    id: int
    name: str
    current_balance: Decimal

    # Configuração moderna para compatibilidade com SQLAlchemy no Pydantic v2
    model_config = ConfigDict(from_attributes=True)


class InvestmentHistoryCreate(BaseModel):
    date: datetime.date = Field(..., description="Data do registro de histórico")
    balance: Decimal = Field(..., description="Saldo do investimento na data informada")


class InvestmentHistoryResponse(BaseModel):
    id: int
    date: datetime.date
    balance: Decimal
    investment_id: int

    model_config = ConfigDict(from_attributes=True)


# Novas Schemas para Categoria e Parcelamento
class CategoryBase(BaseModel):
    name: str = Field(..., max_length=50, description="Nome da categoria")
    icon_name: str = Field(..., max_length=50, description="Nome do ícone da Lucide")
    budget: Decimal = Field(Decimal("0.00"), description="Orçamento mensal para a categoria")
    color: str = Field(..., max_length=50, description="Cor em formato OKLCH ou HEX")

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    """Payload parcial do `PATCH /categories/{id}`.

    `extra="forbid"` pelo mesmo motivo de `TransactionUpdate`: campo
    desconhecido tem que falhar barulhento, não ser descartado.
    """
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(None, max_length=50)
    icon_name: Optional[str] = Field(None, max_length=50)
    budget: Optional[Decimal] = None
    color: Optional[str] = Field(None, max_length=50)


class CategoryResponse(CategoryBase):
    id: int
    spent: Decimal = Decimal("0.00")
    txs_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class InstallmentBase(BaseModel):
    title: str = Field(..., max_length=100)
    category_id: int = Field(..., description="ID da categoria cadastrada")
    total_amount: Decimal
    installment_amount: Decimal
    current_installment: int
    total_installments: int
    end_date: str
    account_id: int

class InstallmentCreate(InstallmentBase):
    pass

class InstallmentUpdate(BaseModel):
    """Payload parcial do `PATCH /installments/{id}`.

    `account_id` está fora do schema pela regra geral: IDs de relacionamento
    central são imutáveis via PATCH em toda a API. Com `extra="forbid"` a
    tentativa vira 422 em vez de ser descartada em silêncio.

    A trava de `installment_amount`/`total_installments`/`total_amount` **não**
    está aqui — ver `update_installment` no router. Ela depende de haver
    transação vinculada e de o valor ter de fato mudado, dois fatos que só o
    banco conhece.
    """
    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = Field(None, max_length=100)
    category_id: Optional[int] = None
    total_amount: Optional[Decimal] = None
    installment_amount: Optional[Decimal] = None
    current_installment: Optional[int] = Field(
        None, description="Pode exceder total_installments — significa quitado"
    )
    total_installments: Optional[int] = None
    end_date: Optional[str] = Field(None, max_length=20)


class InstallmentResponse(InstallmentBase):
    id: int
    category: CategoryRef
    remaining_amount: Decimal = Field(
        ..., description="Quanto ainda falta pagar: parcela × parcelas restantes"
    )

    model_config = ConfigDict(from_attributes=True)


class InstallmentSummary(BaseModel):
    """Totais do cabeçalho da tela de parcelamentos.

    Endpoint próprio em vez de campos novos em `DashboardSummary`: a tela
    precisa dos três números e faria duas requisições — uma delas ao resumo do
    dashboard, que não é o assunto dela. Ver a decisão no CLAUDE.md.

    `active_count` e `monthly_committed_amount` repetem valores que
    `DashboardSummary` também expõe, mas vêm da **mesma função**
    (`app/installment_metrics.py`), não de uma segunda implementação.
    """
    active_count: int
    monthly_committed_amount: Decimal
    remaining_total_amount: Decimal


# Schemas para Agregações (Dashboard e Relatórios)
class MonthlyFlow(BaseModel):
    month: str
    income: Decimal
    outcome: Decimal

class DashboardSummary(BaseModel):
    total_balance: Decimal
    total_revenues: Decimal
    total_expenses: Decimal
    total_savings: Decimal
    monthly_flow: List[MonthlyFlow]
    recent_transactions: List[TransactionResponse]
    category_distribution: List[CategoryResponse]
    active_installments_count: int
    monthly_committed_amount: Decimal
    balance_change_pct: Optional[float] = None
    expenses_change_pct: Optional[float] = None
    savings_pct_of_revenue: Optional[float] = None

class CategoryReport(BaseModel):
    name: str
    value: Decimal

class ReportSummary(BaseModel):
    total_revenues: Decimal
    total_expenses: Decimal
    average_savings: float
    monthly_comparative: List[MonthlyFlow]
    top_categories: List[CategoryReport]
    # `insights` foi removido em 13/08/2026: frase pronta em português é
    # apresentação, e o backend não duplica lógica de apresentação (padrão do
    # dia 3). A tela monta o único insight com lastro — parcelamentos — a partir
    # de `GET /installments/summary`. Ver o registro no CLAUDE.md.

