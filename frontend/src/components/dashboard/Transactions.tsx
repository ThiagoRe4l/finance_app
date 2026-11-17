import { Link } from "@tanstack/react-router";
import { PanelTitle } from "@/components/dashboard/PanelTitle";
import { formatBRL } from "@/lib/money";
import {
  deriveTransactionLabel,
  directionOf,
  signedAmount,
  type Transaction,
} from "@/lib/transactions";

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
function Rows({ transactions }: { transactions: Transaction[] }) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {transactions.map((transaction) => {
        const { label, meta } = deriveTransactionLabel(transaction);
        const amount = signedAmount(transaction);
        const isIncome = amount > 0;

        return (
          <div
            key={transaction.id}
            className="flex justify-between items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {transaction.title}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {transaction.category.name}
              </span>
            </div>
            <div className="shrink-0 text-right">
              <span
                className={`text-sm tabular-nums block whitespace-nowrap font-medium ${
                  isIncome ? "text-income" : "text-foreground"
                }`}
              >
                <span className="sr-only">
                  {directionOf(transaction.type).srLabel}:{" "}
                </span>
                {directionOf(transaction.type).sign}
                {formatBRL(Math.abs(amount))}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {meta ? `${label} · ${meta}` : label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Uma das duas listas: título, e as linhas ou "nenhuma" (T-5). */
function Group({
  title,
  empty,
  transactions,
}: {
  title: string;
  empty: string;
  transactions: Transaction[];
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Rows transactions={transactions} />
      )}
    </div>
  );
}

/*
 * As recentes saem separadas por tipo (T-5): Entradas e Saídas, cada uma com o
 * que couber nas últimas transações do payload. Sem soma: só `type` decide o
 * grupo.
 */
export function Transactions({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const incomes = transactions.filter((t) => t.type === "ENTRADA");
  const expenses = transactions.filter((t) => t.type === "SAÍDA");

  return (
    <section className="bg-card p-6 rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <PanelTitle
          title="Últimas movimentações"
          subtitle="Entradas e saídas separadas"
        />
        <Link
          to="/transacoes"
          className="inline-flex min-h-11 items-center lg:min-h-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver todas
        </Link>
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nenhuma transação registrada ainda.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-6">
          <Group
            title="Entradas"
            empty="Nenhuma entrada recente."
            transactions={incomes}
          />
          <Group
            title="Saídas"
            empty="Nenhuma saída recente."
            transactions={expenses}
          />
        </div>
      )}
    </section>
  );
}
