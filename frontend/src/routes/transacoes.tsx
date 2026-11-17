import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Plus,
  Search,
  AlertCircle,
  RotateCw,
  Pencil,
  Trash2,
  FileUp,
  Inbox,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import { formatShortDate } from "@/lib/date";
import {
  deriveTransactionLabel,
  directionOf,
  signedAmount,
  sortNewestFirst,
  type Transaction,
  type TransactionLabel,
  type TransactionType,
} from "@/lib/transactions";
import { PeriodFilter } from "@/components/shared/PeriodFilter";
import {
  currentMonthKey,
  parsePeriodParam,
  periodLabel,
  periodSearch,
} from "@/lib/period";
import { TransactionFormDialog } from "@/components/transactions/TransactionFormDialog";
import { DeleteTransactionDialog } from "@/components/transactions/DeleteTransactionDialog";
import { ImportInvoiceDialog } from "@/components/transactions/ImportInvoiceDialog";
import { FloatingActionButton } from "@/components/shared/FloatingActionButton";

type Aba = "entradas" | "saidas";

export const Route = createFileRoute("/transacoes")({
  // A aba vai na URL, como em /recorrencias (T-5). Valor desconhecido cai na
  // aba padrão.
  // O período vai na URL como no Dashboard (`?periodo=`, PER-8); inválido é
  // descartado e a tela volta ao mês corrente.
  validateSearch: (
    search: Record<string, unknown>,
  ): { aba?: Aba; periodo?: string } => {
    const aba =
      search.aba === "saidas"
        ? "saidas"
        : search.aba === "entradas"
          ? "entradas"
          : undefined;
    const periodo = parsePeriodParam(search.periodo);
    return {
      ...(aba === undefined ? {} : { aba }),
      ...(periodo === undefined ? {} : { periodo }),
    };
  },
  head: () => ({
    meta: [
      { title: "Transações — Fisco" },
      {
        name: "description",
        content: "Gerencie suas entradas e saídas, fixas e variáveis.",
      },
    ],
  }),
  component: TransacoesPage,
});

const typeColor: Record<TransactionLabel, string> = {
  Fixa: "bg-secondary text-foreground",
  Variável: "bg-expense/20 text-expense-text",
  Parcelada: "bg-accent text-brand",
  Receita: "bg-income/10 text-income",
};

// Sem barra final: é a forma canônica das rotas de coleção (o backend aceita
// as duas). Com barra, `GET /api/transactions/` respondeu 404 no deploy
// estático da Vercel em 12/11/2026 — ver docs/common-hurdles.md, item 7.
const TRANSACTIONS_ENDPOINT = "/transactions";

// Só a tabela, que aparece a partir de `lg`, usa a grade; abaixo disso a
// lista é de cartões (M-12).
const COLUMNS =
  "grid lg:grid-cols-12 gap-4 px-6 py-4 border-b border-border last:border-0 items-center";

function TableHeader() {
  return (
    <div className="grid lg:grid-cols-12 gap-4 px-6 py-3 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
      <div className="col-span-1">Data</div>
      <div className="col-span-4">Descrição</div>
      <div className="col-span-2">Categoria</div>
      <div className="col-span-2">Tipo</div>
      <div className="col-span-2 text-right">Valor</div>
      <div className="col-span-1" />
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={COLUMNS}>
          <Skeleton className="col-span-1 h-4 w-10" />
          <Skeleton className="col-span-4 h-4 w-40" />
          <Skeleton className="col-span-2 h-4 w-24" />
          <Skeleton className="col-span-2 h-5 w-20 rounded-full" />
          <div className="col-span-2 flex justify-end">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="col-span-1" />
        </div>
      ))}
    </>
  );
}

function LoadingCards() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        // `aria-hidden`: sem ele, o leitor de tela anuncia "lista, 6 itens"
        // vazios durante o carregamento.
        <li
          key={i}
          aria-hidden="true"
          className="rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </li>
      ))}
    </>
  );
}

function ErrorBanner({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Não foi possível carregar as transações
          </p>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="flex items-center gap-2 px-4 py-2 min-h-11 lg:min-h-0 rounded-lg border border-border bg-card text-sm hover:bg-secondary transition-colors disabled:opacity-60 shrink-0"
      >
        <RotateCw className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
        {isRetrying ? "Tentando..." : "Tentar novamente"}
      </button>
    </div>
  );
}

function EmptyState({
  hasSearch,
  type,
  period,
  onCreate,
  onImport,
}: {
  hasSearch: boolean;
  type: TransactionType;
  /** O período já por extenso (ex.: `Novembro de 2026`). */
  period: string;
  onCreate: () => void;
  onImport: () => void;
}) {
  const noun = type === "ENTRADA" ? "entrada" : "saída";
  // Ensina no contexto (Q6): o vazio diz o que fazer em seguida.
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">
        {hasSearch
          ? `Nenhuma ${noun} corresponde à busca`
          : `Nenhuma ${noun} em ${period}`}
      </p>
      {!hasSearch && (
        <>
          <p className="max-w-sm text-xs text-muted-foreground">
            Lance {type === "ENTRADA" ? "o que recebeu" : "o que gastou"} em
            poucos segundos, ou traga uma fatura em PDF.
          </p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 lg:min-h-0 lg:py-2"
            >
              <Plus className="h-4 w-4" /> Nova transação
            </button>
            <button
              type="button"
              onClick={onImport}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm hover:bg-secondary lg:min-h-0 lg:py-2"
            >
              <FileUp className="h-4 w-4" /> Importar fatura
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Valor com sinal e rótulo para leitor de tela: a cor não é a única pista (M4). */
function SignedAmount({
  type,
  amount,
}: {
  type: TransactionType;
  amount: number;
}) {
  const { sign, srLabel } = directionOf(type);
  return (
    <>
      <span className="sr-only">{srLabel}: </span>
      {sign}
      {formatBRL(Math.abs(amount))}
    </>
  );
}

function TransactionRow({
  transaction,
  onEdit,
  onDelete,
}: {
  transaction: Transaction;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { label, meta } = deriveTransactionLabel(transaction);
  const amount = signedAmount(transaction);
  const isIncome = amount > 0;

  return (
    <div className={`group ${COLUMNS} hover:bg-secondary/40 transition-colors`}>
      <div className="col-span-1 text-sm text-muted-foreground tabular-nums">
        {formatShortDate(transaction.date)}
      </div>
      <div className="col-span-4 text-sm font-medium">{transaction.title}</div>
      <div className="col-span-2 text-sm text-muted-foreground">
        {transaction.category.name}
      </div>
      <div className="col-span-2">
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${typeColor[label]}`}
        >
          {meta ? `${label} ${meta}` : label}
        </span>
      </div>
      <div
        className={`col-span-2 text-right text-sm font-medium tabular-nums ${
          isIncome ? "text-income" : "text-foreground"
        }`}
      >
        <SignedAmount type={transaction.type} amount={amount} />
      </div>
      {/*
        Coluna própria, ao contrário dos cards de Categorias: numa tabela há
        onde pôr os controles sem sobrepor conteúdo. Continuam no hover para
        não poluir a leitura, com `focus-within` para o teclado — só a partir
        de `lg`, onde a tabela aparece (P2). Os 44 px de base são do P4: a
        tabela só renderiza a partir de `lg`, e lá valem os 28 px de hoje.
      */}
      <div className="col-span-1 flex justify-end gap-1 lg:hover-capable:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${transaction.title}`}
          className="h-11 w-11 lg:h-7 lg:w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir ${transaction.title}`}
          className="h-11 w-11 lg:h-7 lg:w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * O cartão do celular (M-4, M-12): descrição e valor em cima; data, categoria
 * e tipo embaixo, com as ações sempre visíveis à direita.
 */
function TransactionCard({
  transaction,
  onEdit,
  onDelete,
}: {
  transaction: Transaction;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { label, meta } = deriveTransactionLabel(transaction);
  const amount = signedAmount(transaction);
  const isIncome = amount > 0;

  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {/*
          `wrap-anywhere` entra na largura mínima, ao contrário de
          `break-words`: uma palavra única longa quebra em vez de alargar o
          cartão. O `aria-label` dos botões leva o título inteiro.
        */}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 wrap-anywhere text-sm font-medium">
            {transaction.title}
          </p>
        </div>
        <p
          className={`shrink-0 whitespace-nowrap tabular-nums text-sm font-medium ${
            isIncome ? "text-income" : "text-foreground"
          }`}
        >
          <SignedAmount type={transaction.type} amount={amount} />
        </p>
      </div>
      <div className="mt-1 flex items-center gap-x-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {formatShortDate(transaction.date)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">{transaction.category.name}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${typeColor[label]}`}
        >
          {meta ? `${label} ${meta}` : label}
        </span>
        {/* gap maior: editar e excluir ficam longe um do outro (Fitts, Q7). */}
        <div className="flex shrink-0 gap-4">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Editar ${transaction.title}`}
            className="h-11 w-11 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Excluir ${transaction.title}`}
            className="h-11 w-11 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

function TransacoesPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [deleting, setDeleting] = useState<Transaction | undefined>();
  const [search, setSearch] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const { aba = "entradas", periodo } = Route.useSearch();
  const currentKey = currentMonthKey();
  // O padrão é o mês corrente (PER-1): a tela nunca pede o histórico inteiro
  // sem o usuário escolher `Tudo`.
  const period = periodo ?? currentKey;
  const navigate = Route.useNavigate();
  const type: TransactionType = aba === "saidas" ? "SAÍDA" : "ENTRADA";

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["transactions", period],
    queryFn: () =>
      api.get<Transaction[]>(`${TRANSACTIONS_ENDPOINT}?period=${period}`),
    // Trocar de período não pisca: a lista antiga fica até a nova chegar.
    placeholderData: (previous) => previous,
  });

  /*
   * Busca client-side sobre o que já foi carregado: `GET /transactions/`
   * devolve tudo, sem paginação, então filtrar aqui não custa round-trip.
   * ⚠️ Vira dívida com volume — ver "sem paginação" no CLAUDE.md.
   */
  const term = search.trim().toLowerCase();
  const visible = sortNewestFirst(data ?? []).filter(
    (t) =>
      t.type === type &&
      (term === "" ||
        t.title.toLowerCase().includes(term) ||
        t.category.name.toLowerCase().includes(term)),
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Histórico"
        title="Transações"
        description="Histórico completo de entradas e saídas."
      />

      <Tabs
        value={aba}
        onValueChange={(value) =>
          navigate({
            search: (prev) => ({ ...prev, aba: value as Aba }),
            replace: true,
          })
        }
      >
        <div className="mb-4 border-b border-border">
          <TabsList className="h-auto justify-start gap-6 rounded-none bg-transparent p-0">
            <TabsTrigger
              value="entradas"
              className="-mb-px h-11 sm:h-9 rounded-none border-b-2 border-transparent bg-transparent px-1 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Entradas
            </TabsTrigger>
            <TabsTrigger
              value="saidas"
              className="-mb-px h-11 sm:h-9 rounded-none border-b-2 border-transparent bg-transparent px-1 text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Saídas
            </TabsTrigger>
          </TabsList>
        </div>

        {/*
          Opção B (F-2): o período à esquerda; à direita, pela ordem, Nova,
          Importar fatura e a busca. "Nova" só a partir de lg: abaixo, o
          flutuante a substitui.
        */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <PeriodFilter
            bare
            value={period}
            onChange={(key) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  periodo: periodSearch(key, currentKey),
                }),
                replace: true,
              })
            }
          />
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-1 sm:justify-end">
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Nova
            </button>
            <button
              type="button"
              onClick={() => setIsImporting(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 min-h-11 lg:min-h-0 rounded-lg border border-border bg-card text-sm hover:bg-secondary transition-colors"
            >
              <FileUp className="h-4 w-4" /> Importar fatura
            </button>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por descrição ou categoria..."
                aria-label="Buscar por descrição ou categoria"
                className="w-full pl-10 pr-4 py-2 min-h-11 lg:min-h-0 rounded-lg border border-border bg-card text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        <TabsContent value={aba} className="mt-0">
          {isError ? (
            <ErrorBanner
              message={
                error instanceof Error ? error.message : "Erro desconhecido."
              }
              onRetry={() => refetch()}
              isRetrying={isFetching}
            />
          ) : !isPending && visible.length === 0 ? (
            // Vazio uma vez só, fora das duas marcações (M-12).
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <EmptyState
                hasSearch={search.trim() !== ""}
                type={type}
                period={periodLabel(period)}
                onCreate={() => setIsCreating(true)}
                onImport={() => setIsImporting(true)}
              />
            </div>
          ) : (
            <>
              {/*
            Cartões abaixo de `lg`, tabela a partir de `lg`: as duas marcações
            renderizadas, escolhidas só por CSS (M-12). O `pb-16` é a folga
            para o botão flutuante não cobrir o último cartão.
          */}
              <ul className="lg:hidden flex flex-col gap-3 pb-16">
                {isPending ? (
                  <LoadingCards />
                ) : (
                  visible.map((transaction) => (
                    <TransactionCard
                      key={transaction.id}
                      transaction={transaction}
                      onEdit={() => setEditing(transaction)}
                      onDelete={() => setDeleting(transaction)}
                    />
                  ))
                )}
              </ul>
              <div className="hidden lg:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <TableHeader />
                {isPending ? (
                  <LoadingRows />
                ) : (
                  visible.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      onEdit={() => setEditing(transaction)}
                      onDelete={() => setDeleting(transaction)}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <FloatingActionButton
        label="Nova transação"
        onClick={() => setIsCreating(true)}
      />
      <TransactionFormDialog
        open={isCreating}
        onOpenChange={setIsCreating}
        defaultType={type}
      />
      <ImportInvoiceDialog open={isImporting} onOpenChange={setIsImporting} />
      <TransactionFormDialog
        key={editing?.id}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        transaction={editing}
      />
      <DeleteTransactionDialog
        transaction={deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
      />
    </AppShell>
  );
}
