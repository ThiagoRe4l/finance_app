import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CategoryBars } from "@/components/dashboard/CategoryBars";
import { Transactions } from "@/components/dashboard/Transactions";
import { CashFlow } from "@/components/dashboard/CashFlow";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Outubro · 2025
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Visão Geral</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Acompanhe seu fluxo, categorias e parcelamentos em um só lugar.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <Search className="h-4 w-4" />
              Buscar
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="h-4 w-4" />
              Nova transação
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
          <MetricCard label="Saldo Total" value="R$ 24.892,12" delta="+3.2% vs mês anterior" tone="positive" />
          <MetricCard label="Receitas" value="R$ 8.450,00" delta="Salário + extras" tone="neutral" />
          <MetricCard label="Despesas" value="R$ 3.120,50" delta="-7.1% vs mês anterior" tone="negative" />
          <MetricCard label="Economia" value="R$ 5.329,50" delta="63% das receitas" tone="positive" />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <CashFlow />
          </div>
          <Transactions />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <CategoryBars />
          </div>
          <div className="bg-card p-8 rounded-2xl border border-border shadow-sm flex flex-col">
            <h2 className="text-sm font-medium mb-6">Fixas vs Variáveis</h2>
            <div className="flex-1 flex flex-col justify-center gap-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Fixas</span>
                  <span className="tabular-nums font-medium">R$ 2.205,90</span>
                </div>
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary w-[71%]" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">71% das despesas</p>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Variáveis</span>
                  <span className="tabular-nums font-medium">R$ 914,60</span>
                </div>
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-[oklch(0.6_0.15_155)] w-[29%]" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">29% das despesas</p>
              </div>
              <div className="pt-4 border-t border-border">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Parcelamentos ativos</span>
                  <span className="tabular-nums font-medium">3</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Comprometido</span>
                  <span className="tabular-nums font-medium">R$ 625,00/mês</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
