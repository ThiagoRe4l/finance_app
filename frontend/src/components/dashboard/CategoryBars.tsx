import { useState } from "react";

import { PanelTitle } from "@/components/dashboard/PanelTitle";
import { formatBRL } from "@/lib/money";
import {
  toDistribution,
  topDistribution,
  type CategorySummary,
} from "@/lib/dashboard";

/*
 * Apresentacional. O `percent` não vem da API — é derivado em
 * `toDistribution`, que também filtra categoria zerada e ordena por grandeza.
 *
 * O mock antigo trazia um `percent` fixo e internamente inconsistente (67, 40,
 * 25… que não fecham com fórmula nenhuma): número de cenografia do Lovable, não
 * spec. Ver o CLAUDE.md.
 */
export function CategoryBars({
  categories,
  totalExpenses,
  periodLabel,
}: {
  categories: CategorySummary[];
  totalExpenses: string;
  /** O período da distribuição, já por extenso (ex.: `Dezembro de 2026`). */
  periodLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const all = toDistribution(categories, totalExpenses);
  // Máx. 5 itens por bloco (Hick/Miller, docs/ux-leis.md Q4); o resto fica a um toque.
  const { top, rest } = topDistribution(all);
  const rows = expanded ? all : top;

  return (
    <section className="bg-card p-6 rounded-2xl border border-border shadow-sm">
      <div className="mb-6">
        <PanelTitle title="Distribuição de gastos" subtitle={periodLabel} />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nenhuma despesa registrada neste período.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {rows.map((row) => (
            <div key={row.id} className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-foreground">{row.name}</span>
                {/*
                  O mock usava `value.toLocaleString("pt-BR")`. Com a string da
                  API isso vira no-op silencioso — `String.prototype.toLocaleString`
                  ignora os argumentos e devolve "2100.00" cru na tela.
                */}
                <span className="tabular-nums text-muted-foreground">
                  {formatBRL(row.spent)}
                  <span className="ml-2 text-xs">
                    {Math.round(row.percent)}%
                  </span>
                </span>
              </div>
              <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${row.percent}%`,
                    backgroundColor: row.color,
                  }}
                />
              </div>
            </div>
          ))}
          {rest.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="min-h-11 lg:min-h-0 self-start rounded-lg px-2 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? "Ver menos" : `Ver mais ${rest.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
