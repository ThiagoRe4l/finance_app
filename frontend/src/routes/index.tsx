import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RotateCw } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { SavingsHero } from "@/components/dashboard/SavingsHero";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { CategoryBars } from "@/components/dashboard/CategoryBars";
import { RecurringCard } from "@/components/dashboard/RecurringCard";
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
import { EmptyPeriod } from "@/components/shared/EmptyPeriod";
import { PeriodFilter } from "@/components/shared/PeriodFilter";
import {
  currentMonthKey,
  parsePeriodParam,
  periodEyebrow,
  periodHasData,
  periodLabel,
  periodQuery,
  periodSearch,
  type PeriodInfo,
} from "@/lib/period";

export const Route = createFileRoute("/")({
  // O período vai na URL (`?periodo=`), como a aba de /recorrencias. Valor que o
  // backend recusaria é descartado e a tela volta ao mês corrente.
  validateSearch: (search: Record<string, unknown>): { periodo?: string } => {
    const periodo = parsePeriodParam(search.periodo);
    return periodo === undefined ? {} : { periodo };
  },
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
  active_subscriptions_count: number;
  monthly_subscriptions_amount: string;
  monthly_recurring_amount: string;
  balance_change_pct: number | null;
  expenses_change_pct: number | null;
  savings_pct_of_revenue: number | null;
  period: PeriodInfo;
  projected_expenses: string;
  is_projection: boolean;
}

function LoadingState() {
  return (
    <>
      {/* O herói já traz Entradas, Saídas e Saldo atual (D-Cad-6). */}
      <Skeleton className="mb-4 md:mb-6 h-80 md:h-56 rounded-2xl" />
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Skeleton className="lg:col-span-2 h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

  return (
    <>
      <SavingsHero
        savings={data.total_savings}
        revenues={data.total_revenues}
        expenses={data.total_expenses}
        savingsPct={data.savings_pct_of_revenue}
      >
        {/*
          Linhas de extrato do Caderno (docs/tema.md, D-Cad-6).
          `tone` = julgamento (cor), `trend` = direção real (seta). São passados
          de forma independente: acoplar os dois foi o que fez "+325,8%" em
          Despesas exibir seta para baixo.
        */}
        <MetricCard
          variant="ledger"
          label="Entradas"
          value={formatBRL(data.total_revenues)}
          tone="neutral"
        />
        <MetricCard
          variant="ledger"
          label="Saídas"
          value={formatBRL(data.total_expenses)}
          delta={expensesDelta ?? undefined}
          // Único card em que julgamento e direção divergem: gasto subindo é
          // ruim, então o tom inverte — mas a seta continua acompanhando o sinal.
          tone={toneFromDelta(data.expenses_change_pct, "lower-is-better")}
          trend={trendFromDelta(data.expenses_change_pct)}
        />
        <MetricCard
          variant="ledger"
          label="Saldo atual"
          value={formatBRL(data.total_balance)}
          delta={balanceDelta ?? undefined}
          tone={toneFromDelta(data.balance_change_pct, "higher-is-better")}
          trend={trendFromDelta(data.balance_change_pct)}
        />
      </SavingsHero>
      {data.projected_expenses !== "0.00" && (
        <p className="mb-6 text-xs text-muted-foreground">
          As saídas incluem {formatBRL(data.projected_expenses)} previstos em
          cobranças de assinatura que ainda não aconteceram.
        </p>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <CashFlow months={data.monthly_flow} />
        </div>
        <RecurringCard
          installmentsCount={data.active_installments_count}
          subscriptionsCount={data.active_subscriptions_count}
          monthlyAmount={data.monthly_recurring_amount}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5">
          <CategoryBars
            categories={data.category_distribution}
            totalExpenses={data.total_expenses}
            periodLabel={periodLabel(data.period.key)}
          />
        </div>
        <div className="lg:col-span-7">
          <Transactions transactions={data.recent_transactions} />
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
  const body = periodHasData({
    revenues: data.total_revenues,
    expenses: data.total_expenses,
    itemCount: data.recent_transactions.length,
  }) ? (
    <Summary data={data} />
  ) : (
    <EmptyPeriod label={periodLabel(data.period.key)} />
  );
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
        {body}
      </>
    );
  }
  return body;
}

function Index() {
  const { periodo } = Route.useSearch();
  const navigate = Route.useNavigate();
  const currentKey = currentMonthKey();

  const { data, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "summary", periodo ?? ""],
    queryFn: () =>
      api.get<DashboardSummary>(`${SUMMARY_ENDPOINT}${periodQuery(periodo)}`),
    // Trocar de mês não pisca o esqueleto: os números antigos ficam até os novos chegarem.
    placeholderData: (previous) => previous,
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow={periodEyebrow(
          periodo,
          currentKey,
          data?.is_projection ?? false,
        )}
        title="Visão Geral"
        description="Acompanhe seu fluxo, categorias e parcelamentos em um só lugar."
      />

      <PeriodFilter
        value={periodo ?? currentKey}
        onChange={(key) =>
          navigate({
            search: { periodo: periodSearch(key, currentKey) },
            replace: true,
          })
        }
      />

      <DashboardBody
        data={data}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    </AppShell>
  );
}
