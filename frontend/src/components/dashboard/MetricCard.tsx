import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type Tone = "neutral" | "positive" | "negative";

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  neutral: "text-foreground",
  positive: "text-[oklch(0.55_0.15_155)]",
  negative: "text-destructive",
};

const TrendIcon = ({ tone }: { tone: Tone }) => {
  if (tone === "positive") return <TrendingUp className="h-3 w-3" />;
  if (tone === "negative") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
};

export function MetricCard({ label, value, delta, tone = "neutral" }: MetricCardProps) {
  return (
    <div className="bg-card p-6 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${toneClasses[tone]}`}>{value}</p>
      {delta && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <TrendIcon tone={tone} />
          <span>{delta}</span>
        </div>
      )}
    </div>
  );
}
