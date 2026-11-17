import { PanelTitle } from "@/components/dashboard/PanelTitle";
import { MonthColumn } from "@/components/shared/MonthColumn";
import { MonthScroller } from "@/components/shared/MonthScroller";
import { parseMoney } from "@/lib/money";

export interface MonthlyFlow {
  month: string;
  // "2026-11": o rótulo curto é ambíguo entre anos (`all`, ano).
  month_key: string;
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
    month_key: m.month_key,
    income: parseMoney(m.income),
    outcome: parseMoney(m.outcome),
  }));

  // `Math.max` sobre as strings da API funcionaria por coerção, mas altura de
  // barra a partir de coerção implícita em campo monetário é justamente o que
  // se evita desde a migração para `Decimal`. O parse é explícito acima.
  const max = Math.max(...bars.flatMap((b) => [b.income, b.outcome]), 0);

  return (
    <section className="bg-card p-6 rounded-2xl border border-border shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-8">
        <PanelTitle
          title="Entradas e saídas"
          subtitle={
            months.length === 1 ? "1 mês" : `Últimos ${months.length} meses`
          }
        />
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-income" /> Entradas
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-expense" /> Saídas
          </span>
        </div>
      </div>
      {/*
        Rolagem dentro do gráfico no celular (M-11). A coluna tem largura fixa
        (`w-10` ≥ as duas barras `w-3` + `gap-1`) e só cresce a partir de `md`.
        A altura que a trilha tinha (`h-48`) passou para a coluna.
      */}
      <MonthScroller label="Fluxo mensal" count={months.length}>
        {bars.map((bar, i) => (
          <MonthColumn
            key={bar.month_key}
            point={months[i]}
            className="flex w-10 flex-none md:flex-1 flex-col items-center justify-end gap-2 h-48"
          >
            <div className="flex items-end gap-1 h-40 w-full justify-center">
              <div
                className="w-3 rounded-t bg-income transition-all"
                style={{
                  height: max > 0 ? `${(bar.income / max) * 100}%` : "0%",
                }}
              />
              <div
                className="w-3 rounded-t bg-expense transition-all"
                style={{
                  height: max > 0 ? `${(bar.outcome / max) * 100}%` : "0%",
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{bar.month}</span>
          </MonthColumn>
        ))}
      </MonthScroller>
    </section>
  );
}
