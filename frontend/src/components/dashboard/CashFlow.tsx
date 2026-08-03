const months = [
  { m: "Mai", in: 7800, out: 4200 },
  { m: "Jun", in: 8100, out: 3850 },
  { m: "Jul", in: 7950, out: 4500 },
  { m: "Ago", in: 8300, out: 3200 },
  { m: "Set", in: 8200, out: 3400 },
  { m: "Out", in: 8450, out: 3120 },
];

export function CashFlow() {
  const max = Math.max(...months.flatMap((m) => [m.in, m.out]));
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
        {months.map((mo) => (
          <div key={mo.m} className="flex-1 flex flex-col items-center gap-2">
            <div className="flex items-end gap-1 h-40 w-full justify-center">
              <div
                className="w-3 rounded-t bg-primary transition-all"
                style={{ height: `${(mo.in / max) * 100}%` }}
              />
              <div
                className="w-3 rounded-t bg-border transition-all"
                style={{ height: `${(mo.out / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{mo.m}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
