import { TrendingDown, TrendingUp, Minus } from "lucide-react";

import { formatBRL } from "@/lib/money";
import {
  formatDelta,
  spendRatio,
  toneFromDelta,
  trendFromDelta,
  type Tone,
} from "@/lib/dashboard";

const toneClasses: Record<Tone, string> = {
  neutral: "text-foreground",
  positive: "text-income",
  negative: "text-destructive",
};

/**
 * Cartão-herói da Visão Geral (`docs/ux-leis.md`, Q1/Q8): responde "quanto
 * sobrou este mês?" em primeiro plano. Só usa campos que a API já devolve; a
 * barra é a proporção saiu ÷ entrou (`spendRatio`), sem somar dinheiro. O
 * enquadramento é descritivo ("Entraram X · saíram Y"), sem culpa.
 *
 * Caderno (`docs/tema.md`, D-Cad-6): à direita, a partir de `md`, as linhas de
 * extrato que chegam como `children` (Entradas, Saídas, Saldo atual).
 */
export function SavingsHero({
  savings,
  revenues,
  expenses,
  savingsPct,
  children,
}: {
  savings: string;
  revenues: string;
  expenses: string;
  /** `savings_pct_of_revenue`, number da API ou `null`. */
  savingsPct: number | null;
  children?: React.ReactNode;
}) {
  const ratio = spendRatio(expenses, revenues);
  const over = ratio !== null && ratio > 100;
  const width = ratio === null ? 0 : Math.min(100, Math.max(0, ratio));
  const delta = formatDelta(savingsPct, "das entradas");
  const trend = trendFromDelta(savingsPct);
  const Trend =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <section
      aria-label="Quanto sobrou no mês"
      className="mb-4 md:mb-6 flex flex-col rounded-2xl border border-border bg-card shadow-sm md:flex-row"
    >
      <div className="min-w-0 p-6 md:flex-[3] md:p-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Sobrou no mês
        </p>
        <p
          className={`mt-2 font-display text-4xl font-semibold tabular-nums whitespace-nowrap md:text-5xl ${
            toneClasses[toneFromDelta(savingsPct, "higher-is-better")]
          }`}
        >
          {formatBRL(savings)}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Entraram{" "}
          <span className="whitespace-nowrap tabular-nums font-medium text-foreground">
            {formatBRL(revenues)}
          </span>{" "}
          · saíram{" "}
          <span className="whitespace-nowrap tabular-nums font-medium text-foreground">
            {formatBRL(expenses)}
          </span>
        </p>
        {ratio !== null && (
          <div className="mt-4">
            <div
              role="img"
              aria-label={`Saiu ${Math.round(ratio)}% do que entrou`}
              className="h-2 w-full overflow-hidden rounded-full bg-secondary"
            >
              <div
                className={`h-full rounded-full transition-all ${
                  over ? "bg-destructive" : "bg-expense"
                }`}
                style={{ width: `${width}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {over ? "Saiu mais do que entrou: " : "Saiu "}
              {Math.round(ratio)}% do que entrou
            </p>
          </div>
        )}
        {delta && (
          <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
            <Trend className="h-3 w-3" />
            <span>{delta}</span>
          </div>
        )}
      </div>
      {children && (
        <div className="flex min-w-0 flex-col justify-center gap-4 rounded-b-2xl border-t border-border bg-background/60 p-6 md:flex-[2] md:rounded-none md:rounded-r-2xl md:border-t-0 md:border-l md:p-8">
          {children}
        </div>
      )}
    </section>
  );
}
