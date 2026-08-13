import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import type { Trend } from "@/lib/dashboard";

type Tone = "neutral" | "positive" | "negative";

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  /** Julgamento: controla **só a cor** do valor. */
  tone?: Tone;
  /** Direção real da variação: controla **só a seta**. */
  trend?: Trend;
}

const toneClasses: Record<Tone, string> = {
  neutral: "text-foreground",
  positive: "text-[oklch(0.55_0.15_155)]",
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
}: MetricCardProps) {
  return (
    <div className="bg-card p-6 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${toneClasses[tone]}`}>{value}</p>
      {delta && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <TrendIcon trend={trend} />
          <span>{delta}</span>
        </div>
      )}
    </div>
  );
}
