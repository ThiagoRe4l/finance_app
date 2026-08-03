import { createFileRoute } from "@tanstack/react-router";
import { Plus, CreditCard } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PageHeader } from "@/components/dashboard/PageHeader";

export const Route = createFileRoute("/parcelamentos")({
  head: () => ({
    meta: [
      { title: "Parcelamentos — Fisco" },
      { name: "description", content: "Acompanhe parcelas em aberto e o valor comprometido por mês." },
    ],
  }),
  component: ParcelamentosPage,
});

const items = [
  { title: "Notebook Pro", category: "Eletrônicos", total: 5400, installment: 450, current: 2, total_installments: 12, end: "Ago/2026" },
  { title: "Curso Online", category: "Educação", total: 720, installment: 120, current: 3, total_installments: 6, end: "Jan/2026" },
  { title: "Sofá Retrátil", category: "Móveis", total: 660, installment: 55, current: 5, total_installments: 12, end: "Mai/2026" },
];

const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

function ParcelamentosPage() {
  const monthlyTotal = items.reduce((s, i) => s + i.installment, 0);
  const remainingTotal = items.reduce((s, i) => s + i.installment * (i.total_installments - i.current + 1), 0);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        <PageHeader
          eyebrow="Outubro · 2025"
          title="Parcelamentos"
          description="Compras parceladas em aberto e impacto mensal no orçamento."
          action={
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
              <Plus className="h-4 w-4" /> Novo parcelamento
            </button>
          }
        />

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Comprometido/mês</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(monthlyTotal)}</p>
          </div>
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Saldo a pagar</p>
            <p className="text-2xl font-semibold tabular-nums">{formatBRL(remainingTotal)}</p>
          </div>
          <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Parcelamentos ativos</p>
            <p className="text-2xl font-semibold tabular-nums">{items.length}</p>
          </div>
        </section>

        <div className="space-y-4">
          {items.map((it) => {
            const percent = (it.current / it.total_installments) * 100;
            const remaining = it.installment * (it.total_installments - it.current + 1);
            return (
              <div key={it.title} className="bg-card p-6 rounded-2xl border border-border shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                      <CreditCard className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{it.title}</p>
                      <p className="text-xs text-muted-foreground">{it.category} · termina em {it.end}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Parcela</p>
                      <p className="text-sm font-medium tabular-nums">{formatBRL(it.installment)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Restante</p>
                      <p className="text-sm font-medium tabular-nums">{formatBRL(remaining)}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                    <span>Parcela {it.current} de {it.total_installments}</span>
                    <span>{percent.toFixed(0)}% pago</span>
                  </div>
                  <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
