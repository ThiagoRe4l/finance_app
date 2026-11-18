import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Leader } from "@/components/shared/Leader";
import type { Tone, Trend } from "@/lib/dashboard";

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  /** Julgamento: controla **só a cor** do valor. */
  tone?: Tone;
  /** Direção real da variação: controla **só a seta**. */
  trend?: Trend;
  /**
   * `card` (padrão): o cartão de sempre. `ledger`: linha de extrato — nome,
   * pontilhado e valor —, como no "Sobrou no mês" do Caderno (D-Cad-6).
   */
  variant?: "card" | "ledger";
}

const toneClasses: Record<Tone, string> = {
  neutral: "text-foreground",
  positive: "text-income",
  negative: "text-destructive",
};

/*
 * `trend` e `tone` são independentes de propósito.
 *
 * Antes o ícone saía de `tone`, que codifica bom/ruim. Nos cards de saldo e
 * economia isso coincide com a direção; em Despesas não — gasto subindo é ruim,
 * e "+325,8%" exibia seta para baixo. O mock nunca expôs a diferença, porque
 * trazia despesa em queda (`-7.1%`) marcada como negativa, onde "para baixo" e
 * "ruim" batiam por acidente.
 */
const TrendIcon = ({ trend }: { trend: Trend }) => {
  if (trend === "up") return <TrendingUp className="h-3 w-3" />;
  if (trend === "down") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
};

export function MetricCard({
  label,
  value,
  delta,
  tone = "neutral",
  trend = "flat",
  variant = "card",
}: MetricCardProps) {
  // O cartão vem primeiro: os testes da M-13 leem o primeiro valor do arquivo.
  if (variant === "card") {
    return (
      <div className="bg-card p-6 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow">
        <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">
          {label}
        </p>
        <p
          className={`text-2xl font-display font-semibold tabular-nums whitespace-nowrap ${toneClasses[tone]}`}
        >
          {value}
        </p>
        {delta && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <TrendIcon trend={trend} />
            <span>{delta}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
        <span className="shrink-0">{label}</span>
        <Leader />
        <span
          className={`ml-auto shrink-0 font-display text-xl tabular-nums whitespace-nowrap ${toneClasses[tone]}`}
        >
          {value}
        </span>
      </div>
      {delta && (
        <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
          <TrendIcon trend={trend} />
          <span>{delta}</span>
        </div>
      )}
    </div>
  );
}
