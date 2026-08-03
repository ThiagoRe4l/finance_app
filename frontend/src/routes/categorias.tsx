import { createFileRoute } from "@tanstack/react-router";
import { Plus, Home, UtensilsCrossed, Car, Gamepad2, HeartPulse, GraduationCap, ShoppingBag } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PageHeader } from "@/components/dashboard/PageHeader";

export const Route = createFileRoute("/categorias")({
  head: () => ({
    meta: [
      { title: "Categorias — Fisco" },
      { name: "description", content: "Organize seus gastos por categorias e acompanhe o orçamento." },
    ],
  }),
  component: CategoriasPage,
});

const categories = [
  { name: "Moradia", icon: Home, spent: 2219.9, budget: 2500, color: "oklch(0.45 0.04 235)", txs: 4 },
  { name: "Alimentação", icon: UtensilsCrossed, spent: 1240, budget: 1500, color: "oklch(0.6 0.15 155)", txs: 12 },
  { name: "Transporte", icon: Car, spent: 480, budget: 600, color: "oklch(0.65 0.18 50)", txs: 8 },
  { name: "Lazer", icon: Gamepad2, spent: 320, budget: 400, color: "oklch(0.6 0.2 300)", txs: 5 },
  { name: "Saúde", icon: HeartPulse, spent: 180, budget: 300, color: "oklch(0.6 0.2 25)", txs: 3 },
  { name: "Educação", icon: GraduationCap, spent: 240, budget: 250, color: "oklch(0.55 0.15 200)", txs: 2 },
  { name: "Compras", icon: ShoppingBag, spent: 95, budget: 200, color: "oklch(0.55 0.05 250)", txs: 2 },
];

const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

function CategoriasPage() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        <PageHeader
          eyebrow="Outubro · 2025"
          title="Categorias"
          description="Acompanhe o uso do orçamento de cada categoria."
          action={
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
              <Plus className="h-4 w-4" /> Nova categoria
            </button>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((cat) => {
            const percent = Math.min(100, (cat.spent / cat.budget) * 100);
            const over = percent >= 90;
            return (
              <div
                key={cat.name}
                className="bg-card p-6 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `color-mix(in oklab, ${cat.color} 15%, transparent)` }}
                    >
                      <cat.icon className="h-5 w-5" style={{ color: cat.color }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{cat.name}</p>
                      <p className="text-xs text-muted-foreground">{cat.txs} transações</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
                    {percent.toFixed(0)}%
                  </span>
                </div>

                <div className="space-y-2 mb-3">
                  <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${percent}%`,
                        backgroundColor: over ? "oklch(0.6 0.2 25)" : cat.color,
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-semibold tabular-nums">{formatBRL(cat.spent)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    de {formatBRL(cat.budget)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
