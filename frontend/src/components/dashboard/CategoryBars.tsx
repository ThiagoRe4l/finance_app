import { formatBRL } from "@/lib/money";
import { toDistribution, type CategorySummary } from "@/lib/dashboard";

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
}: {
  categories: CategorySummary[];
  totalExpenses: string;
}) {
  const rows = toDistribution(categories, totalExpenses);

  return (
    <section className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-medium">Distribuição de Gastos</h2>
        <span className="text-xs text-muted-foreground">Mês corrente</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nenhuma despesa registrada neste mês.
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
                <span className="tabular-nums text-muted-foreground">{formatBRL(row.spent)}</span>
              </div>
              <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${row.percent}%`, backgroundColor: row.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
