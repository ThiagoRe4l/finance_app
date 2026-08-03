import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PageHeader } from "@/components/dashboard/PageHeader";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Fisco" },
      { name: "description", content: "Análises e tendências das suas finanças." },
    ],
  }),
  component: RelatoriosPage,
});

const months = [
  { m: "Mai", in: 7800, out: 4200 },
  { m: "Jun", in: 8100, out: 3850 },
  { m: "Jul", in: 7950, out: 4500 },
  { m: "Ago", in: 8300, out: 3200 },
  { m: "Set", in: 8200, out: 3400 },
  { m: "Out", in: 8450, out: 3120 },
];

const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

function RelatoriosPage() {
  const max = Math.max(...months.flatMap((m) => [m.in, m.out]));
  const totalIn = months.reduce((s, m) => s + m.in, 0);
  const totalOut = months.reduce((s, m) => s + m.out, 0);
  const avgSaving = (totalIn - totalOut) / months.length;

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

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Total de Receitas</p>
            <p className="text-2xl font-semibold tabular-nums text-[oklch(0.55_0.15_155)]">{formatBRL(totalIn)}</p>
          </div>
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Total de Despesas</p>
            <p className="text-2xl font-semibold tabular-nums text-destructive">{formatBRL(totalOut)}</p>
          </div>
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Economia média</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(avgSaving)}</p>
          </div>
        </section>

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
            {months.map((mo) => (
              <div key={mo.m} className="flex-1 flex flex-col items-center gap-2">
                <div className="flex items-end gap-1.5 h-56 w-full justify-center">
                  <div className="w-5 rounded-t bg-primary transition-all" style={{ height: `${(mo.in / max) * 100}%` }} />
                  <div className="w-5 rounded-t bg-border transition-all" style={{ height: `${(mo.out / max) * 100}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{mo.m}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
            <h2 className="text-sm font-medium mb-6">Maiores categorias</h2>
            <div className="space-y-4">
              {[
                { name: "Moradia", value: 13320 },
                { name: "Alimentação", value: 7440 },
                { name: "Transporte", value: 2880 },
                { name: "Lazer", value: 1920 },
              ].map((c, i, arr) => {
                const pct = (c.value / arr[0].value) * 100;
                return (
                  <div key={c.name}>
                    <div className="flex justify-between text-sm mb-2">
                      <span>{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">{formatBRL(c.value)}</span>
                    </div>
                    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-card p-8 rounded-2xl border border-border shadow-sm">
            <h2 className="text-sm font-medium mb-6">Insights</h2>
            <ul className="space-y-4 text-sm">
              <li className="flex gap-3">
                <span className="h-2 w-2 mt-1.5 rounded-full bg-[oklch(0.55_0.15_155)] shrink-0" />
                <span>Sua economia cresceu <strong className="tabular-nums">+18%</strong> nos últimos 3 meses.</span>
              </li>
              <li className="flex gap-3">
                <span className="h-2 w-2 mt-1.5 rounded-full bg-primary shrink-0" />
                <span>Despesas fixas representam <strong>71%</strong> do total de gastos.</span>
              </li>
              <li className="flex gap-3">
                <span className="h-2 w-2 mt-1.5 rounded-full bg-[oklch(0.65_0.18_50)] shrink-0" />
                <span>Categoria <strong>Alimentação</strong> está <strong>17%</strong> acima da média trimestral.</span>
              </li>
              <li className="flex gap-3">
                <span className="h-2 w-2 mt-1.5 rounded-full bg-destructive shrink-0" />
                <span>Você possui <strong>3 parcelamentos</strong> ativos comprometendo <strong className="tabular-nums">R$ 625/mês</strong>.</span>
              </li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
