import { PanelTitle } from "@/components/dashboard/PanelTitle";
import { formatBRL } from "@/lib/money";

/**
 * Parcelamentos + assinaturas (R-7). O total vem pronto do backend: o front não
 * soma dinheiro. O valor não quebra nem é cortado (M-13).
 *
 * Ocupa na proposta de design o lugar ao lado do gráfico (`docs/tema.md`,
 * D-Tema-7); o "Comprometido por mês" vai em destaque laranja suave, com texto
 * escuro (laranja puro não é texto sobre creme, D-Tema-2).
 */
export function RecurringCard({
  installmentsCount,
  subscriptionsCount,
  monthlyAmount,
}: {
  installmentsCount: number;
  subscriptionsCount: number;
  /** `monthly_recurring_amount`, decimal em string. */
  monthlyAmount: string;
}) {
  return (
    <section className="bg-card p-6 rounded-2xl border border-border shadow-sm flex flex-col gap-6">
      <PanelTitle
        title="Recorrências"
        subtitle="Assinaturas e parcelas ativas"
      />
      <div className="flex flex-col gap-4">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Parcelamentos</span>
          <span className="tabular-nums font-medium">{installmentsCount}</span>
        </div>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Assinaturas</span>
          <span className="tabular-nums font-medium">{subscriptionsCount}</span>
        </div>
      </div>
      <div className="mt-auto rounded-lg bg-expense/20 p-4 text-expense-text">
        <p className="text-xs">Comprometido por mês</p>
        <p className="mt-1 font-display text-xl font-semibold tabular-nums whitespace-nowrap">
          {formatBRL(monthlyAmount)}
        </p>
      </div>
    </section>
  );
}
