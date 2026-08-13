import { formatBRL } from "@/lib/money";
import { deriveTransactionLabel, signedAmount, type Transaction } from "@/lib/transactions";

/*
 * Apresentacional: recebe `recent_transactions` do payload do dashboard — o
 * mesmo shape de `GET /api/transactions/`, já com a categoria aninhada e o
 * progresso da parcela.
 *
 * O rótulo vem de `deriveTransactionLabel`, compartilhado com a tela cheia.
 * Antes este arquivo tinha o próprio type `Tx` com slug minúsculo sem acento e
 * uma tabela `typeLabel` própria — a mesma regra escrita duas vezes, com casing
 * diferente.
 */
export function Transactions({ transactions }: { transactions: Transaction[] }) {
  return (
    <section className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-medium">Transações Recentes</h2>
        <a
          href="/transacoes"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver todas
        </a>
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nenhuma transação registrada ainda.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {transactions.map((transaction) => {
            const { label, meta } = deriveTransactionLabel(transaction);
            const amount = signedAmount(transaction);
            const isIncome = amount > 0;

            return (
              <div
                key={transaction.id}
                className="flex justify-between items-center py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{transaction.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {transaction.category.name}
                  </span>
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
      )}
    </section>
  );
}
