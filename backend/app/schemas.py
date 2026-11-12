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
    # k de N quando a transação foi gerada pelo parcelamento (P-1).
    installment_number: Optional[int] = None
    installment: Optional[InstallmentProgress] = None
    # Nulo para transação comum. É por ele que o front distingue a parte de
    # uma despesa compartilhada, que só muda de categoria por aqui (D-Shared-6).
    shared_expense_id: Optional[int] = None

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


class InstallmentScheduleInput(BaseModel):
    """O que define o cronograma (P-3 a P-5). Usado pelo cadastro e pela
    pré-visualização, que por isso validam igual.

    `extra="forbid"`: `end_date` deixou de ser aceito e tem que falhar
    barulhento (422), não ser descartado em silêncio.
    """
    model_config = ConfigDict(extra="forbid")

    total_amount: Optional[Decimal] = Field(
        None, gt=0, decimal_places=2, description="Valor total. Informe este ou installment_amount."
    )
    installment_amount: Optional[Decimal] = Field(
        None, gt=0, decimal_places=2, description="Valor da parcela. Informe este ou total_amount."
    )
    total_installments: int = Field(..., ge=1, le=120)
    current_installment: int = Field(
        1, ge=1, description="Parcela ainda a pagar (D13); no cadastro, não passa do total"
    )
    current_due_date: datetime.date = Field(
        ..., description="Data de vencimento da parcela atual; ancora o cronograma"
    )

    @field_validator("current_due_date")
    @classmethod
    def check_due_date_range(cls, value: datetime.date) -> datetime.date:
        # O cronograma soma até 120 meses: perto do ano 1 ou do 9999 o
        # calendário estourava no router, como 500 (revisão de 12/11/2026).
        if not 1900 <= value.year <= 2200:
            raise ValueError("Data fora do intervalo aceito (1900 a 2200).")
        return value

    @model_validator(mode="after")
    def check_schedule(self):
        if (self.total_amount is None) == (self.installment_amount is None):
            raise ValueError("Informe o valor total ou o valor da parcela — exatamente um dos dois.")
        if self.current_installment > self.total_installments:
            raise ValueError("A parcela atual não pode ser maior que a quantidade de parcelas.")
        # R$ 0,02 em 3 daria uma parcela de R$ 0,00: uma SAÍDA de zero, que o
        # `TransactionCreate` recusaria (revisão de 12/11/2026).
        if (
            self.total_amount is not None
            and self.total_amount < Decimal("0.01") * self.total_installments
        ):
            raise ValueError("O valor total precisa dar pelo menos R$ 0,01 por parcela.")
        return self


class InstallmentCreate(InstallmentScheduleInput):
    title: str = Field(..., max_length=100)
    category_id: int = Field(..., description="ID da categoria cadastrada")
    account_id: int


class InstallmentPreviewParcel(BaseModel):
    number: int
    date: datetime.date
    amount: Decimal


class InstallmentPreview(BaseModel):
    """Resposta de `POST /installments/preview`: o cronograma, sem gravar."""
    total_amount: Decimal
    installment_amount: Decimal
    remaining_amount: Decimal
    first_due_date: datetime.date
    end_date: str
    installments: List[InstallmentPreviewParcel]


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
    # `end_date` saiu: é calculado do cronograma (P-3). Com `extra="forbid"`,
    # enviá-lo é 422.


class InstallmentResponse(BaseModel):
    id: int
    title: str
    category_id: int
    total_amount: Decimal
    installment_amount: Decimal
    current_installment: int
    total_installments: int
    end_date: str
    account_id: int
    first_due_date: Optional[datetime.date] = Field(
        None, description="Data da parcela 1; nula nos parcelamentos sem cronograma"
    )
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



# ---------------------------------------------------------------------------
# Despesa compartilhada (D-Shared-1 a 9)
# ---------------------------------------------------------------------------

def _normalize_participants(emails: List[str]) -> List[str]:
    """Minúsculo e sem espaço, como a allowlist e a sessão (D-Auth-2).

    Lista vazia ou com repetição é payload malformado — 422, sem olhar o banco.
    Repetição só é detectável **depois** de normalizar: `Bia@x` e `bia@x` são a
    mesma pessoa.
    """
    normalized = [email.strip().lower() for email in emails]
    if not normalized:
        raise ValueError("Informe ao menos um participante além de você.")
    if len(set(normalized)) != len(normalized):
        raise ValueError("Participante repetido.")
    return normalized


class SharedExpenseCreate(BaseModel):
    """Só SAÍDA, sem parcelamento e sem `is_fixed` (D-Shared-7).

    `extra="forbid"`: esses campos não existem aqui, e mandá-los tem que ser
    422 barulhento — ignorar em silêncio faria o cliente achar que criou uma
    despesa fixa.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(..., max_length=150)
    amount: Decimal = Field(..., gt=0, decimal_places=2, description="Total, antes da divisão")
    date: datetime.date
    account_id: int = Field(..., description="Conta de quem cria — a das outras partes é a primeira de cada um")
    category_id: int = Field(..., description="Categoria de quem cria — os outros recebem a de mesmo nome")
    participants: List[str] = Field(..., description="E-mails dos **outros** participantes")

    @field_validator("participants")
    @classmethod
    def normalize_participants(cls, v: List[str]) -> List[str]:
        return _normalize_participants(v)

    @model_validator(mode="after")
    def every_part_gets_at_least_one_cent(self):
        """Depende só do payload: o total e o número de participantes estão
        aqui. Por isso 422, e não 400 (D-Shared-3)."""
        if self.amount * 100 < len(self.participants) + 1:
            raise ValueError("O valor não dá um centavo a cada participante.")
        return self


class SharedExpenseUpdate(BaseModel):
    """Edição do grupo — só por quem criou (D-Shared-8).

    `account_id`/`category_id` ficam de fora: IDs de relacionamento central são
    imutáveis via PATCH em toda a API (regra geral do dia 4).
    """

    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = Field(None, max_length=150)
    amount: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    date: Optional[datetime.date] = None
    participants: Optional[List[str]] = None

    @field_validator("participants")
    @classmethod
    def normalize_participants(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return None if v is None else _normalize_participants(v)


class SharedExpensePart(BaseModel):
    email: str
    amount: Decimal


class SharedExpenseResponse(BaseModel):
    id: int
    title: str
    total_amount: Decimal
    date: datetime.date
    creator: str
    parts: List[SharedExpensePart]


class Participant(BaseModel):
    email: str


# --- Importação de fatura (`docs/importacao-fatura.md`) ---------------------


class InstallmentHint(BaseModel):
    current: int
    total: int


class InvoicePreviewItem(BaseModel):
    """Uma linha reconhecida na fatura. Nada foi gravado (D-Import-1)."""
    date: datetime.date
    title: str
    amount: Decimal
    type: str
    installment_hint: Optional[InstallmentHint] = None
    is_payment: bool
    duplicate: bool = Field(..., description="Já existe na conta (D-Import-4)")
    selected: bool = Field(..., description="Sugestão da tela: falso para pagamento e duplicada")
    suggested_category_id: Optional[int] = None


class InvoicePreview(BaseModel):
    lines_read: int = Field(..., description="Linhas de texto lidas no PDF")
    items: List[InvoicePreviewItem]


class InvoiceConfirmItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: datetime.date
    title: str = Field(..., min_length=1, max_length=150)
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    type: str = Field(..., pattern="^(ENTRADA|SAÍDA)$")
    category_id: int
    allow_duplicate: bool = Field(
        False,
        description="O usuário marcou de novo uma linha apontada como duplicada: importar mesmo assim",
    )


class InvoiceConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: int
    items: List[InvoiceConfirmItem] = Field(..., min_length=1, max_length=500)


class InvoiceConfirmResult(BaseModel):
    created: int
    skipped_duplicates: int
