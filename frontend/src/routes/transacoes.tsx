import { createFileRoute } from "@tanstack/react-router";
import { Plus, Filter, Search } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PageHeader } from "@/components/dashboard/PageHeader";

export const Route = createFileRoute("/transacoes")({
  head: () => ({
    meta: [
      { title: "Transações — Fisco" },
      { name: "description", content: "Gerencie suas entradas e saídas, fixas e variáveis." },
    ],
  }),
  component: TransacoesPage,
});

type Tx = {
  date: string;
  title: string;
  category: string;
  amount: number;
  type: "Fixa" | "Variável" | "Parcelada" | "Receita";
  meta?: string;
};

const all: Tx[] = [
  { date: "05/10", title: "Salário", category: "Receita", amount: 8450, type: "Receita" },
  { date: "05/10", title: "Aluguel", category: "Moradia", amount: -2100, type: "Fixa" },
  { date: "07/10", title: "Notebook Pro", category: "Eletrônicos", amount: -450, type: "Parcelada", meta: "2/12" },
  { date: "08/10", title: "Supermercado Extra", category: "Alimentação", amount: -342.5, type: "Variável" },
  { date: "10/10", title: "Uber", category: "Transporte", amount: -28.9, type: "Variável" },
  { date: "10/10", title: "Netflix", category: "Lazer", amount: -55.9, type: "Fixa" },
  { date: "12/10", title: "Curso Online", category: "Educação", amount: -120, type: "Parcelada", meta: "3/6" },
  { date: "14/10", title: "Freelance Design", category: "Receita", amount: 1200, type: "Receita" },
  { date: "15/10", title: "Internet", category: "Moradia", amount: -119.9, type: "Fixa" },
  { date: "18/10", title: "Restaurante", category: "Alimentação", amount: -86.4, type: "Variável" },
  { date: "20/10", title: "Academia", category: "Saúde", amount: -89, type: "Fixa" },
  { date: "22/10", title: "Farmácia", category: "Saúde", amount: -54.2, type: "Variável" },
];

const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

const typeColor: Record<Tx["type"], string> = {
  Fixa: "bg-secondary text-foreground",
  Variável: "bg-[oklch(0.94_0.04_50)] text-[oklch(0.45_0.15_50)]",
  Parcelada: "bg-[oklch(0.94_0.04_300)] text-[oklch(0.45_0.18_300)]",
  Receita: "bg-[oklch(0.94_0.06_155)] text-[oklch(0.45_0.15_155)]",
};

function TransacoesPage() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        <PageHeader
          eyebrow="Outubro · 2025"
          title="Transações"
          description="Histórico completo de entradas e saídas do mês."
          action={
            <>
              <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <Filter className="h-4 w-4" /> Filtrar
              </button>
              <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
                <Plus className="h-4 w-4" /> Nova
              </button>
            </>
          }
        />

        <div className="mb-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar transação..."
            className="w-full md:w-96 pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <div className="col-span-1">Data</div>
            <div className="col-span-4">Descrição</div>
            <div className="col-span-2">Categoria</div>
            <div className="col-span-2">Tipo</div>
            <div className="col-span-3 text-right">Valor</div>
          </div>
          {all.map((tx, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-border last:border-0 items-center hover:bg-secondary/40 transition-colors"
            >
              <div className="col-span-1 text-sm text-muted-foreground tabular-nums">{tx.date}</div>
              <div className="col-span-4 text-sm font-medium">{tx.title}</div>
              <div className="col-span-2 text-sm text-muted-foreground">{tx.category}</div>
              <div className="col-span-2">
                <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${typeColor[tx.type]}`}>
                  {tx.type}{tx.meta ? ` ${tx.meta}` : ""}
                </span>
              </div>
              <div
                className={`col-span-3 text-right text-sm font-medium tabular-nums ${
                  tx.amount > 0 ? "text-[oklch(0.55_0.15_155)]" : "text-foreground"
                }`}
              >
                {tx.amount > 0 ? "+" : ""}{formatBRL(tx.amount)}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
