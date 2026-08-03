type Tx = {
  title: string;
  category: string;
  amount: number;
  type: "fixa" | "variavel" | "parcelada" | "receita";
  meta?: string;
};

const transactions: Tx[] = [
  { title: "Salário", category: "Receita", amount: 8450, type: "receita" },
  { title: "Aluguel", category: "Moradia", amount: -2100, type: "fixa" },
  { title: "Notebook Pro", category: "Eletrônicos", amount: -450, type: "parcelada", meta: "2/12" },
  { title: "Supermercado", category: "Alimentação", amount: -342.5, type: "variavel" },
  { title: "Uber", category: "Transporte", amount: -28.9, type: "variavel" },
  { title: "Netflix", category: "Lazer", amount: -55.9, type: "fixa" },
  { title: "Curso Online", category: "Educação", amount: -120, type: "parcelada", meta: "3/6" },
];

const typeLabel: Record<Tx["type"], string> = {
  fixa: "Fixa",
  variavel: "Variável",
  parcelada: "Parcelada",
  receita: "Receita",
};

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export function Transactions() {
  return (
    <section className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-medium">Transações Recentes</h2>
        <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Ver todas
        </a>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {transactions.map((tx, i) => {
          const isIncome = tx.amount > 0;
          return (
            <div key={i} className="flex justify-between items-center py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{tx.title}</span>
                <span className="text-xs text-muted-foreground">{tx.category}</span>
              </div>
              <div className="text-right">
                <span
                  className={`text-sm tabular-nums block font-medium ${
                    isIncome ? "text-[oklch(0.55_0.15_155)]" : "text-foreground"
                  }`}
                >
                  {isIncome ? "+" : ""}
                  {formatCurrency(tx.amount)}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {tx.meta ? `${typeLabel[tx.type]} · ${tx.meta}` : typeLabel[tx.type]}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
