import { PanelTitle } from "@/components/dashboard/PanelTitle";
import { Leader } from "@/components/shared/Leader";
import { formatBRL } from "@/lib/money";

/**
 * Parcelamentos + assinaturas (R-7). O total vem pronto do backend: o front não
 * soma dinheiro. O valor não quebra nem é cortado (M-13).
 *
 * Ocupa o lugar ao lado do gráfico (`docs/tema.md`, D-Tema-7). No Caderno
 * (D-Cad-6) as contagens são linhas de extrato e o "Comprometido por mês" vai
 * num bloco ardósia, com o texto papel da ação principal.
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
      <div className="flex flex-col gap-3 text-[15px]">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0">Parcelamentos</span>
          <Leader />
          <span className="shrink-0 tabular-nums font-semibold">
            {installmentsCount}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="shrink-0">Assinaturas</span>
          <Leader />
          <span className="shrink-0 tabular-nums font-semibold">
            {subscriptionsCount}
          </span>
        </div>
      </div>
      <div className="mt-auto rounded-xl bg-primary p-4 text-primary-foreground">
        <p className="text-xs text-primary-foreground/80">
          Comprometido por mês
        </p>
        <p className="mt-1 font-display text-2xl tabular-nums whitespace-nowrap">
          {formatBRL(monthlyAmount)}
        </p>
      </div>
    </section>
  );
}
