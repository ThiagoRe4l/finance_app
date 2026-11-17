import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/lib/api";
import {
  currentMonthKey,
  gridYear,
  monthGrid,
  periodShortcuts,
  periodTriggerLabel,
  rangeBounds,
  rangeKey,
  shiftPeriod,
  type PeriodRange,
} from "@/lib/period";

// Rota específica, sem barra final (CLAUDE.md, "Common Hurdles").
const RANGE_ENDPOINT = "/periods/range";

const TRIGGER =
  "inline-flex h-11 lg:h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const CHIP =
  "inline-flex h-11 lg:h-9 min-w-12 items-center justify-center rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ON = "border-primary bg-primary text-primary-foreground";
const CHIP_OFF =
  "border-transparent bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground";

const MODE =
  "inline-flex h-11 lg:h-8 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const YEAR_ARROW =
  "inline-flex h-11 w-11 lg:h-9 lg:w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

const CELL =
  "inline-flex h-11 lg:h-10 items-center justify-center rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/40";

type Mode = "month" | "range";

/**
 * Filtro de período de uma página (`docs/periodos.md`, PER-1 e PER-9).
 * Controlado: quem usa guarda o valor na URL. `value` é a chave efetiva
 * (`2026-11`, `2026`, `2026-03..2026-08`, `3m`, `6m`, `12m` ou `all`), nunca vazia.
 *
 * Um só botão (`Nov/26 ⌄`) abre o popup. Nele, **Mês** escolhe um mês com um
 * toque e **Intervalo** escolhe o mês inicial e o final (dois toques, em
 * qualquer ordem); os atalhos `3M · 6M · 1A · Tudo` ficam no rodapé do popup,
 * não na tela. Meses fora do range (`GET /periods/range`) ficam desligados.
 * Se a chamada falhar, o range cai para o mês corrente e a tela segue usável.
 */
export function PeriodFilter({
  value,
  onChange,
  bare = false,
}: {
  value: string;
  onChange: (key: string) => void;
  /** Sem a margem de baixo própria: quem usa decide o espaçamento. */
  bare?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ["periods", "range"],
    queryFn: () => api.get<PeriodRange>(RANGE_ENDPOINT),
  });

  const current = currentMonthKey();
  const range: PeriodRange = data ?? {
    min_month: current,
    max_month: current,
    current_month: current,
  };

  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => gridYear(value, current));
  const [mode, setMode] = useState<Mode>("month");
  // Primeiro extremo já escolhido no modo Intervalo; `null` = nenhum ainda.
  const [anchor, setAnchor] = useState<string | null>(null);

  // A grade abre no ano do período em vigor, mesmo se foi trocado por fora.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setYear(gridYear(value, current));
      setMode(rangeBounds(value) ? "range" : "month");
      setAnchor(null);
    }
    setOpen(next);
  };
  const previousYear = shiftPeriod(String(year), -1, range);
  const nextYear = shiftPeriod(String(year), 1, range);

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  const chooseMonth = (key: string) => {
    if (mode === "month") return pick(key);
    if (anchor === null) return setAnchor(key);
    setAnchor(null);
    pick(rangeKey(anchor, key));
  };

  const activeRange = rangeBounds(value);
  const isSelected = (key: string) => {
    if (mode === "month") return key === value;
    if (anchor !== null) return key === anchor;
    return (
      activeRange !== null && key >= activeRange[0] && key <= activeRange[1]
    );
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-3 ${bare ? "" : "mb-8"}`}
    >
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Escolher período"
            aria-haspopup="dialog"
            className={TRIGGER}
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="tabular-nums">{periodTriggerLabel(value)}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <div
            role="group"
            aria-label="Tipo de escolha"
            className="mb-3 flex gap-1 rounded-xl bg-secondary p-1"
          >
            {(
              [
                ["month", "Mês"],
                ["range", "Intervalo"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => {
                  setMode(id);
                  setAnchor(null);
                }}
                className={`${MODE} ${
                  mode === id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Ano anterior"
              disabled={previousYear === null}
              onClick={() =>
                previousYear !== null && setYear(Number(previousYear))
              }
              className={YEAR_ARROW}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tabular-nums">{year}</span>
            <button
              type="button"
              aria-label="Próximo ano"
              disabled={nextYear === null}
              onClick={() => nextYear !== null && setYear(Number(nextYear))}
              className={YEAR_ARROW}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {monthGrid(year, range).map((cell) => {
              const selected = isSelected(cell.key);
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={cell.disabled}
                  aria-pressed={selected}
                  onClick={() => chooseMonth(cell.key)}
                  className={`${CELL} ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : cell.key === current
                        ? "text-foreground ring-1 ring-border hover:bg-secondary"
                        : "text-foreground hover:bg-secondary"
                  }`}
                >
                  {cell.label}
                </button>
              );
            })}
          </div>
          {mode === "range" && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {anchor === null
                ? "Escolha o mês inicial e depois o final."
                : `Início em ${periodTriggerLabel(anchor)}. Escolha o mês final.`}
            </p>
          )}
          <div
            role="group"
            aria-label="Atalhos de período"
            className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-3"
          >
            {periodShortcuts().map((shortcut) => {
              const active = shortcut.value === value;
              return (
                <button
                  key={shortcut.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pick(shortcut.value)}
                  className={`${CHIP} ${active ? CHIP_ON : CHIP_OFF}`}
                >
                  {shortcut.label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
