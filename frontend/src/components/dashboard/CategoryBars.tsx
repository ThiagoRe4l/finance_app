const categories = [
  { name: "Moradia", value: 2100, percent: 67, color: "oklch(0.45 0.04 235)" },
  { name: "Alimentação", value: 1240, percent: 40, color: "oklch(0.6 0.15 155)" },
  { name: "Transporte", value: 480, percent: 25, color: "oklch(0.65 0.18 50)" },
  { name: "Lazer", value: 320, percent: 18, color: "oklch(0.6 0.2 300)" },
  { name: "Saúde", value: 180, percent: 12, color: "oklch(0.6 0.2 25)" },
  { name: "Outros", value: 95, percent: 6, color: "oklch(0.55 0.05 250)" },
];

export function CategoryBars() {
  return (
    <section className="bg-card p-8 rounded-2xl border border-border shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-medium">Distribuição de Gastos</h2>
        <span className="text-xs text-muted-foreground">Outubro 2025</span>
      </div>
      <div className="flex flex-col gap-6">
        {categories.map((cat) => (
          <div key={cat.name} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-foreground">{cat.name}</span>
              <span className="tabular-nums text-muted-foreground">
                R$ {cat.value.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
