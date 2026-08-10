import { formatBRL } from "@/lib/money";
import { deriveTransactionLabel, signedAmount, type Transaction } from "@/lib/transactions";

/*
 * ⚠️ Ainda mockado — mas agora **no formato real da API**.
 *
 * A tela cheia (`routes/transacoes.tsx`) já consome `GET /api/transactions/`.
 * Este componente vive no dashboard, cujos outros blocos (CashFlow,
 * CategoryBars, métricas) seguem mockados; integrá-lo sozinho deixaria metade
 * do dashboard real e metade fictícia.
 *
 * O que mudou aqui foi a **divergência**: antes este arquivo tinha o próprio
 * type `Tx` com slug minúsculo sem acento (`"variavel"`) e uma tabela
 * `typeLabel` própria para traduzir — a mesma regra de negócio escrita duas
 * vezes, com casing diferente da tela cheia. Agora usa
 * `deriveTransactionLabel`, e o mock tem o shape de `Transaction`, então
 * integrar depois é trocar o array por um `useQuery`.
 */

const CATEGORIES = {
  receita: { id: 1, name: "Receita", color: "oklch(0.6 0.15 155)", icon_name: "TrendingUp" },
  moradia: { id: 2, name: "Moradia", color: "oklch(0.45 0.04 235)", icon_name: "Home" },
  eletronicos: { id: 3, name: "Eletrônicos", color: "oklch(0.55 0.05 250)", icon_name: "Laptop" },
  alimentacao: { id: 4, name: "Alimentação", color: "oklch(0.6 0.15 155)", icon_name: "UtensilsCrossed" },
  transporte: { id: 5, name: "Transporte", color: "oklch(0.65 0.18 50)", icon_name: "Car" },
  lazer: { id: 6, name: "Lazer", color: "oklch(0.6 0.2 300)", icon_name: "Gamepad2" },
  educacao: { id: 7, name: "Educação", color: "oklch(0.55 0.15 200)", icon_name: "GraduationCap" },
} as const;

const base = {
  date: "2026-08-07",
  account_id: 1,
  is_fixed: false,
  installment_id: null,
  installment: null,
} satisfies Partial<Transaction>;

const transactions: Transaction[] = [
  { ...base, id: 1, title: "Salário", type: "ENTRADA", amount: "8450.00", category: CATEGORIES.receita },
  { ...base, id: 2, title: "Aluguel", type: "SAÍDA", amount: "2100.00", category: CATEGORIES.moradia, is_fixed: true },
  {
    ...base, id: 3, title: "Notebook Pro", type: "SAÍDA", amount: "450.00", category: CATEGORIES.eletronicos,
    installment_id: 1, installment: { current_installment: 2, total_installments: 12 },
  },
  { ...base, id: 4, title: "Supermercado", type: "SAÍDA", amount: "342.50", category: CATEGORIES.alimentacao },
  { ...base, id: 5, title: "Uber", type: "SAÍDA", amount: "28.90", category: CATEGORIES.transporte },
  { ...base, id: 6, title: "Netflix", type: "SAÍDA", amount: "55.90", category: CATEGORIES.lazer, is_fixed: true },
  {
    ...base, id: 7, title: "Curso Online", type: "SAÍDA", amount: "120.00", category: CATEGORIES.educacao,
    installment_id: 2, installment: { current_installment: 3, total_installments: 6 },
  },
];

export function Transactions() {
  return (
    <section className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-medium">Transações Recentes</h2>
        <a href="/transacoes" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Ver todas
        </a>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {transactions.map((transaction) => {
          const { label, meta } = deriveTransactionLabel(transaction);
          const amount = signedAmount(transaction);
          const isIncome = amount > 0;

          return (
            <div key={transaction.id} className="flex justify-between items-center py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{transaction.title}</span>
                <span className="text-xs text-muted-foreground">{transaction.category.name}</span>
              </div>
              <div className="text-right">
                <span
                  className={`text-sm tabular-nums block font-medium ${
                    isIncome ? "text-[oklch(0.55_0.15_155)]" : "text-foreground"
                  }`}
                >
                  {isIncome ? "+" : ""}
                  {formatBRL(amount)}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {meta ? `${label} · ${meta}` : label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
