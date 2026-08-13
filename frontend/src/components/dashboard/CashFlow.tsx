import { parseMoney } from "@/lib/money";

export interface MonthlyFlow {
  month: string;
  income: string;
  outcome: string;
}

/*
 * Apresentacional: recebe `monthly_flow` do dashboard pronto. A API já devolve
 * exatamente 6 meses, na ordem, com os meses vazios preenchidos com "0.00" —
 * não há o que completar aqui.
 */
export function CashFlow({ months }: { months: MonthlyFlow[] }) {
  const bars = months.map((m) => ({
    month: m.month,
    income: parseMoney(m.income),
    outcome: parseMoney(m.outcome),
  }));

  // `Math.max` sobre as strings da API funcionaria por coerção, mas altura de
  // barra a partir de coerção implícita em campo monetário é justamente o que
  // se evita desde a migração para `Decimal`. O parse é explícito acima.
  const max = Math.max(...bars.flatMap((b) => [b.income, b.outcome]), 0);

  return (
    <section className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-sm font-medium">Fluxo Mensal</h2>
          <p className="text-xs text-muted-foreground mt-1">Últimos 6 meses</p>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" /> Entradas
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-border" /> Saídas
          </span>
        </div>
      </div>
      <div className="flex items-end gap-6 h-48">
        {bars.map((bar, i) => (
          <div key={`${bar.month}-${i}`} className="flex-1 flex flex-col items-center gap-2">
            <div className="flex items-end gap-1 h-40 w-full justify-center">
              <div
                className="w-3 rounded-t bg-primary transition-all"
                style={{ height: max > 0 ? `${(bar.income / max) * 100}%` : "0%" }}
              />
              <div
                className="w-3 rounded-t bg-border transition-all"
                style={{ height: max > 0 ? `${(bar.outcome / max) * 100}%` : "0%" }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{bar.month}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
