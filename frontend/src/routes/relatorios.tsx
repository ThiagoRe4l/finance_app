import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, AlertCircle, RotateCw } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBRL, parseMoney } from "@/lib/money";
import { buildReportInsights, type ReportOverview } from "@/lib/reports";
import type { InstallmentsSummary } from "@/lib/installments";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Fisco" },
      { name: "description", content: "Análises e tendências das suas finanças." },
    ],
  }),
  component: RelatoriosPage,
});

// `/reports/overview` é rota específica (sem barra); `/installments/summary`
// idem. Coleção é que precisa da barra — ver CLAUDE.md.
const OVERVIEW_ENDPOINT = "/reports/overview";
const INSTALLMENTS_SUMMARY_ENDPOINT = "/installments/summary";

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
          <p className="text-sm font-medium text-foreground">Não foi possível carregar os relatórios</p>
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

function LoadingState() {
  return (
    <>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <Skeleton className="h-3 w-32 mb-3" />
            <Skeleton className="h-7 w-32" />
          </div>
        ))}
      </section>
      <Skeleton className="h-96 rounded-2xl mb-8" />
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </section>
    </>
  );
}

function TotalCard({ label, value, className = "" }: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${className}`}>{value}</p>
    </div>
  );
}

function MonthlyComparison({ months }: { months: ReportOverview["monthly_comparative"] }) {
  const bars = months.map((m) => ({
    month: m.month,
    income: parseMoney(m.income),
    outcome: parseMoney(m.outcome),
  }));
  // Parse explícito antes do `Math.max`: a coerção de string funcionaria, mas
  // altura de barra a partir de campo monetário implícito é o que se evita
  // desde a migração para `Decimal`.
  const max = Math.max(...bars.flatMap((b) => [b.income, b.outcome]), 0);

  return (
    <section className="bg-card p-8 rounded-2xl border border-border shadow-sm mb-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-sm font-medium">Comparativo Mensal</h2>
          <p className="text-xs text-muted-foreground mt-1">Entradas vs Saídas</p>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" /> Entradas
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-border" /> Saídas
          </span>
        </div>
      </div>
      <div className="flex items-end gap-6 h-64">
        {bars.map((bar, i) => (
          <div key={`${bar.month}-${i}`} className="flex-1 flex flex-col items-center gap-2">
            <div className="flex items-end gap-1.5 h-56 w-full justify-center">
              <div
                className="w-5 rounded-t bg-primary transition-all"
                style={{ height: max > 0 ? `${(bar.income / max) * 100}%` : "0%" }}
              />
              <div
                className="w-5 rounded-t bg-border transition-all"
                style={{ height: max > 0 ? `${(bar.outcome / max) * 100}%` : "0%" }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{bar.month}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TopCategories({ categories }: { categories: ReportOverview["top_categories"] }) {
  const rows = categories.map((c) => ({ name: c.name, value: parseMoney(c.value) }));
  // Proporção relativa à maior — o ranking já vem ordenado do backend.
  const largest = rows.length > 0 ? rows[0].value : 0;

  return (
    <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <h2 className="text-sm font-medium mb-6">Maiores categorias</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nenhuma despesa registrada no período.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.name}>
              <div className="flex justify-between text-sm mb-2">
                <span>{row.name}</span>
                <span className="tabular-nums text-muted-foreground">{formatBRL(row.value)}</span>
              </div>
              <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: largest > 0 ? `${(row.value / largest) * 100}%` : "0%" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Insights({ items }: { items: string[] }) {
  /*
   * O mock tinha quatro itens; três eram decoração sem dado por trás
   * ("economia cresceu +18%", "despesas fixas 71%", "Alimentação 17% acima da
   * média trimestral") e o quarto tinha o número fixo em "3 parcelamentos".
   *
   * `buildReportInsights` devolve só o que tem lastro. Lista vazia esconde a
   * seção inteira, em vez de desenhar um card sem conteúdo.
   */
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <h2 className="text-sm font-medium mb-6">Insights</h2>
      <ul className="space-y-4 text-sm">
        {items.map((insight) => (
          <li key={insight} className="flex gap-3">
            <span className="h-2 w-2 mt-1.5 rounded-full bg-primary shrink-0" />
            <span>{insight}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelatoriosPage() {
  const overview = useQuery({
    queryKey: ["reports", "overview"],
    queryFn: () => api.get<ReportOverview>(OVERVIEW_ENDPOINT),
  });
  const installments = useQuery({
    queryKey: ["installments", "summary"],
    queryFn: () => api.get<InstallmentsSummary>(INSTALLMENTS_SUMMARY_ENDPOINT),
  });

  const isPending = overview.isPending || installments.isPending;
  const isError = overview.isError || installments.isError;
  const error = overview.error ?? installments.error;
  const isFetching = overview.isFetching || installments.isFetching;

  const retry = () => {
    overview.refetch();
    installments.refetch();
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        <PageHeader
          eyebrow="Últimos 6 meses"
          title="Relatórios"
          description="Tendências e comparativos para entender seu comportamento financeiro."
          action={
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <Download className="h-4 w-4" /> Exportar
            </button>
          }
        />

        {isError ? (
          <ErrorBanner
            message={error instanceof Error ? error.message : "Erro desconhecido."}
            onRetry={retry}
            isRetrying={isFetching}
          />
        ) : isPending ? (
          <LoadingState />
        ) : (
          <>
            {/* Os três totais vêm prontos — o mock somava os 6 meses no cliente. */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <TotalCard
                label="Total de Receitas"
                value={formatBRL(overview.data.total_revenues)}
                className="text-[oklch(0.55_0.15_155)]"
              />
              <TotalCard
                label="Total de Despesas"
                value={formatBRL(overview.data.total_expenses)}
                className="text-destructive"
              />
              <TotalCard
                label="Economia média"
                value={formatBRL(overview.data.average_savings)}
              />
            </section>

            <MonthlyComparison months={overview.data.monthly_comparative} />

            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <TopCategories categories={overview.data.top_categories} />
              <Insights
                items={buildReportInsights({
                  activeCount: installments.data.active_count,
                  monthlyCommitted: installments.data.monthly_committed_amount,
                })}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
