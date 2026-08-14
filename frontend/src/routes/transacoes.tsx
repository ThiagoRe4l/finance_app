import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Search, AlertCircle, RotateCw, Pencil, Trash2 } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import { formatShortDate } from "@/lib/date";
import {
  deriveTransactionLabel,
  signedAmount,
  type Transaction,
  type TransactionLabel,
} from "@/lib/transactions";
import { TransactionFormDialog } from "@/components/transactions/TransactionFormDialog";
import { DeleteTransactionDialog } from "@/components/transactions/DeleteTransactionDialog";

export const Route = createFileRoute("/transacoes")({
  head: () => ({
    meta: [
      { title: "Transações — Fisco" },
      { name: "description", content: "Gerencie suas entradas e saídas, fixas e variáveis." },
    ],
  }),
  component: TransacoesPage,
});

const typeColor: Record<TransactionLabel, string> = {
  Fixa: "bg-secondary text-foreground",
  Variável: "bg-[oklch(0.94_0.04_50)] text-[oklch(0.45_0.15_50)]",
  Parcelada: "bg-[oklch(0.94_0.04_300)] text-[oklch(0.45_0.18_300)]",
  Receita: "bg-[oklch(0.94_0.06_155)] text-[oklch(0.45_0.15_155)]",
};

// A barra final evita o 307 do FastAPI: a rota registrada é `/transactions/`,
// e sem ela toda listagem custa dois round-trips.
const TRANSACTIONS_ENDPOINT = "/transactions/";

const COLUMNS = "grid grid-cols-12 gap-4 px-6 py-4 border-b border-border last:border-0 items-center";

function TableHeader() {
  return (
    <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
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

function ErrorBanner({ message, onRetry, isRetrying }: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Não foi possível carregar as transações</p>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm hover:bg-secondary transition-colors disabled:opacity-60 shrink-0"
      >
        <RotateCw className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
        {isRetrying ? "Tentando..." : "Tentar novamente"}
      </button>
    </div>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        {hasSearch
          ? "Nenhuma transação corresponde à busca."
          : "Nenhuma transação registrada ainda."}
      </p>
    </div>
  );
}

function TransactionRow({ transaction, onEdit, onDelete }: {
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
      <div className="col-span-2 text-sm text-muted-foreground">{transaction.category.name}</div>
      <div className="col-span-2">
        <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${typeColor[label]}`}>
          {meta ? `${label} ${meta}` : label}
        </span>
      </div>
      <div
        className={`col-span-2 text-right text-sm font-medium tabular-nums ${
          isIncome ? "text-[oklch(0.55_0.15_155)]" : "text-foreground"
        }`}
      >
        {isIncome ? "+" : ""}
        {formatBRL(amount)}
      </div>
      {/*
        Coluna própria, ao contrário dos cards de Categorias: numa tabela há
        onde pôr os controles sem sobrepor conteúdo. Continuam no hover para
        não poluir a leitura, com `focus-within` para o teclado.
      */}
      <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${transaction.title}`}
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir ${transaction.title}`}
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function TransacoesPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [deleting, setDeleting] = useState<Transaction | undefined>();
  const [search, setSearch] = useState("");

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => api.get<Transaction[]>(TRANSACTIONS_ENDPOINT),
  });

  /*
   * Busca client-side sobre o que já foi carregado: `GET /transactions/`
   * devolve tudo, sem paginação, então filtrar aqui não custa round-trip.
   * ⚠️ Vira dívida com volume — ver "sem paginação" no CLAUDE.md.
   */
  const term = search.trim().toLowerCase();
  const visible = (data ?? []).filter(
    (t) =>
      term === "" ||
      t.title.toLowerCase().includes(term) ||
      t.category.name.toLowerCase().includes(term),
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        <PageHeader
          eyebrow="Histórico"
          title="Transações"
          description="Histórico completo de entradas e saídas."
          action={
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Nova
            </button>
          }
        />

        <div className="mb-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por descrição ou categoria..."
            className="w-full md:w-96 pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {isError ? (
          <ErrorBanner
            message={error instanceof Error ? error.message : "Erro desconhecido."}
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : (
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <TableHeader />
            {isPending ? (
              <LoadingRows />
            ) : visible.length === 0 ? (
              <EmptyState hasSearch={search.trim() !== ""} />
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
        )}

        <TransactionFormDialog open={isCreating} onOpenChange={setIsCreating} />
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
      </main>
    </div>
  );
}
