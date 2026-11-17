import { CalendarX } from "lucide-react";

/**
 * Período sem nenhum lançamento. Aparece no lugar do corpo da tela, com o filtro
 * ainda à mão para trocar de período.
 */
export function EmptyPeriod({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center"
    >
      <CalendarX className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">Sem dados neste período</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Não há lançamentos em {label}. Escolha outro período no filtro acima.
      </p>
    </div>
  );
}
