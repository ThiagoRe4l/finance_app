import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, AlertCircle, RotateCw } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { CategoryBars } from "@/components/dashboard/CategoryBars";
import { Transactions } from "@/components/dashboard/Transactions";
import { CashFlow, type MonthlyFlow } from "@/components/dashboard/CashFlow";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import {
  dashboardView,
  formatDelta,
  toneFromDelta,
  trendFromDelta,
  type CategorySummary,
} from "@/lib/dashboard";
import type { Transaction } from "@/lib/transactions";
import { TransactionFormDialog } from "@/components/transactions/TransactionFormDialog";
import { FloatingActionButton } from "@/components/shared/FloatingActionButton";

export const Route = createFileRoute("/")({
  component: Index,
});

// Sem barra final: a rota é `@router.get("/summary")`, e com a barra o FastAPI
// responde 307. É o oposto das coleções (`/transactions/`) — ver CLAUDE.md.
const SUMMARY_ENDPOINT = "/dashboard/summary";

interface DashboardSummary {
  total_balance: string;
  total_revenues: string;
  total_expenses: string;
  total_savings: string;
  monthly_flow: MonthlyFlow[];
  recent_transactions: Transaction[];
  category_distribution: CategorySummary[];
  active_installments_count: number;
  monthly_committed_amount: string;
  balance_change_pct: number | null;
  expenses_change_pct: number | null;
  savings_pct_of_revenue: number | null;
}

function LoadingState() {
  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4 md:gap-6 mb-8">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="bg-card p-6 rounded-2xl border border-border shadow-sm"
          >
            <Skeleton className="h-3 w-24 mb-3" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-28 mt-3" />
          </div>
        ))}
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Skeleton className="lg:col-span-2 h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-16 lg:pb-0">
        <Skeleton className="lg:col-span-2 h-72 rounded-2xl" />
      </section>
    </>
  );
}

function ErrorBanner({
  title = "Não foi possível carregar o resumo",
  message,
  onRetry,
  isRetrying,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
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

function Summary({ data }: { data: DashboardSummary }) {
  /*
   * Os três percentuais chegam calculados da API — objetivo dos campos
   * `*_change_pct` desde o realinhamento do dia 3. Aqui só se formata.
   * `formatDelta` devolve `null` quando o percentual é `null`, e `MetricCard`
   * omite o rodapé nesse caso.
   *
   * O card de Receitas não tem delta: o mock trazia "Salário + extras", texto
   * decorativo sem equivalente na API.
   */
  const balanceDelta = formatDelta(data.balance_change_pct, "vs mês anterior");
  const expensesDelta = formatDelta(
    data.expenses_change_pct,
    "vs mês anterior",
  );
  const savingsDelta = formatDelta(data.savings_pct_of_revenue, "das receitas");

  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4 md:gap-6 mb-8">
        {/*
          `tone` = julgamento (cor), `trend` = direção real (seta). São passados
          de forma independente: acoplar os dois foi o que fez "+325,8%" em
          Despesas exibir seta para baixo.
        */}
        <MetricCard
          label="Saldo Total"
          value={formatBRL(data.total_balance)}
          delta={balanceDelta ?? undefined}
          tone={toneFromDelta(data.balance_change_pct, "higher-is-better")}
          trend={trendFromDelta(data.balance_change_pct)}
        />
        <MetricCard
          label="Receitas"
          value={formatBRL(data.total_revenues)}
          tone="neutral"
        />
        <MetricCard
          label="Despesas"
          value={formatBRL(data.total_expenses)}
          delta={expensesDelta ?? undefined}
          // Único card em que julgamento e direção divergem: gasto subindo é
          // ruim, então o tom inverte — mas a seta continua acompanhando o sinal.
          tone={toneFromDelta(data.expenses_change_pct, "lower-is-better")}
          trend={trendFromDelta(data.expenses_change_pct)}
        />
        <MetricCard
          label="Economia"
          value={formatBRL(data.total_savings)}
          delta={savingsDelta ?? undefined}
          tone={toneFromDelta(data.savings_pct_of_revenue, "higher-is-better")}
          trend={trendFromDelta(data.savings_pct_of_revenue)}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <CashFlow months={data.monthly_flow} />
        </div>
        <Transactions transactions={data.recent_transactions} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 pb-16 lg:pb-0">
        <div className="lg:col-span-2">
          <CategoryBars
            categories={data.category_distribution}
            totalExpenses={data.total_expenses}
          />
        </div>
        <div className="bg-card p-8 rounded-2xl border border-border shadow-sm flex flex-col">
          <h2 className="text-sm font-medium mb-6">Parcelamentos</h2>
          <div className="flex-1 flex flex-col justify-center gap-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Ativos</span>
              <span className="tabular-nums font-medium">
                {data.active_installments_count}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Comprometido</span>
              <span className="tabular-nums font-medium">
                {formatBRL(data.monthly_committed_amount)}/mês
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Dado em memória vence o erro: um `refetch` que falha não esconde o resumo já
 * carregado (`dashboardView`; docs/backlog.md, "Banner de erro sobre o
 * Dashboard já carregado").
 */
function DashboardBody({
  data,
  isError,
  error,
  onRetry,
  isRetrying,
}: {
  data: DashboardSummary | undefined;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const message = error instanceof Error ? error.message : "Erro desconhecido.";
  const view = dashboardView({ hasData: data !== undefined, isError });

  if (view === "loading") return <LoadingState />;
  if (data === undefined) {
    return (
      <ErrorBanner
        message={message}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }
  if (view === "stale-summary") {
    return (
      <>
        <div className="mb-6">
          <ErrorBanner
            title="Não foi possível atualizar — exibindo os últimos dados"
            message={message}
            onRetry={onRetry}
            isRetrying={isRetrying}
          />
        </div>
        <Summary data={data} />
      </>
    );
  }
  return <Summary data={data} />;
}

function Index() {
  const [isCreating, setIsCreating] = useState(false);

  const { data, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api.get<DashboardSummary>(SUMMARY_ENDPOINT),
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow="Mês corrente"
        title="Visão Geral"
        description="Acompanhe seu fluxo, categorias e parcelamentos em um só lugar."
        actionClassName="hidden lg:flex"
        action={
          /*
              "Buscar" removido: era botão sem campo e sem estado, e o Dashboard
              não tem lista para filtrar — são agregados e 7 transações
              recentes. Mesma lógica do "Filtrar" de Transações: inerte ao lado
              de ações que funcionam é pior que ausente.
            */
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Nova transação
          </button>
        }
      />

      <DashboardBody
        data={data}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />

      <FloatingActionButton
        label="Nova transação"
        onClick={() => setIsCreating(true)}
      />

      {/* Mesmo diálogo da tela de Transações — modo criação é o default. */}
      <TransactionFormDialog open={isCreating} onOpenChange={setIsCreating} />
    </AppShell>
  );
}
