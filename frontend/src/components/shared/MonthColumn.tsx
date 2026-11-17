import { useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatBRL } from "@/lib/money";
import {
  monthColumnLabel,
  monthTooltipTitle,
  type MonthPoint,
} from "@/lib/month-tooltip";
import { currentMonthKey } from "@/lib/period";

/**
 * Uma coluna de gráfico de meses com tooltip (`docs/periodos.md`, fatia 3).
 *
 * É um botão: o foco e o toque funcionam sem hover, que o celular não tem.
 * Abre com o mouse por cima, com clique/toque e com Enter, e fecha ao tirar o
 * mouse, com novo clique, Esc ou toque fora. O conteúdo vai num portal, então a
 * rolagem horizontal do `MonthScroller` não o corta.
 *
 * `Popover` e não `Tooltip` do Radix: o `Tooltip` não abre por toque.
 */
export function MonthColumn({
  point,
  className,
  currentKey = currentMonthKey(),
  children,
}: {
  point: MonthPoint;
  className?: string;
  /** Mês corrente (`YYYY-MM`); parâmetro para o teste não depender do relógio. */
  currentKey?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // O mouse chega por cima (abre) e só depois clica. Sem isto o clique, que
  // alterna, fecharia o tooltip que o próprio hover acabou de abrir.
  const openedByHover = useRef(false);

  // Só o mouse abre por hover. No toque, `pointerenter` vem junto do toque e
  // seria seguido do clique, que fecharia de volta.
  const hoverOpens = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") {
      openedByHover.current = true;
      setOpen(true);
    }
  };
  const hoverCloses = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") {
      openedByHover.current = false;
      setOpen(false);
    }
  };
  const keepOpenAfterHover = (event: React.MouseEvent) => {
    if (openedByHover.current) {
      openedByHover.current = false;
      event.preventDefault(); // impede o toggle do Radix
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={monthColumnLabel(point, currentKey)}
          onPointerEnter={hoverOpens}
          onPointerLeave={hoverCloses}
          onClick={keepOpenAfterHover}
          className={`rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-auto min-w-44 p-3 text-xs"
        // O foco fica na coluna: com ele no conteúdo, Esc e Tab saltariam.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p className="font-medium text-foreground">
          {monthTooltipTitle(point.month_key, currentKey)}
        </p>
        <dl className="mt-2 space-y-1">
          <div className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-income" />
              Entradas
            </dt>
            <dd className="tabular-nums whitespace-nowrap">
              {formatBRL(point.income)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-expense" />
              Saídas
            </dt>
            <dd className="tabular-nums whitespace-nowrap">
              {formatBRL(point.outcome)}
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
