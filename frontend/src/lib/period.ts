/**
 * Filtro de período — funções puras (`docs/periodos.md`, PER-1 a PER-7).
 *
 * O período é uma string, a mesma que o backend aceita em `?period=`: `YYYY-MM`,
 * `YYYY`, `6m` ou `all`. Ausente = mês corrente. Nada aqui soma dinheiro.
 */

/** Espelha `PeriodRange` do backend (`GET /periods/range`). */
export interface PeriodRange {
  min_month: string;
  max_month: string;
  current_month: string;
}

/** Espelha `PeriodInfo` do backend; `end` é exclusivo. */
export interface PeriodInfo {
  key: string;
  start: string;
  end: string;
}

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;
// Intervalo entre meses, extremos incluídos (PER-9): `2026-03..2026-08`.
const RANGE_RE = /^(\d{4}-(?:0[1-9]|1[0-2]))\.\.(\d{4}-(?:0[1-9]|1[0-2]))$/;
// Espelha `MAX_RANGE_MONTHS` do backend.
const MAX_RANGE_MONTHS = 120;

// Janelas que terminam no mês corrente (atalhos 3M / 6M / 1A).
const WINDOWS = new Set(["3m", "6m", "12m"]);

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function yearInRange(year: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Valida o `?periodo=` da URL. Valor que o backend recusaria (422) é descartado e
 * a tela volta ao padrão, em vez de ficar presa num erro.
 */
export function parsePeriodParam(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (WINDOWS.has(raw) || raw === "all") return raw;

  const range = rangeBounds(raw);
  if (range) {
    const [first, last] = range;
    const months = monthIndex(last) - monthIndex(first) + 1;
    const inside =
      yearInRange(Number(first.slice(0, 4))) &&
      yearInRange(Number(last.slice(0, 4)));
    return inside && months >= 1 && months <= MAX_RANGE_MONTHS
      ? raw
      : undefined;
  }

  const month = MONTH_RE.exec(raw);
  if (month) return yearInRange(Number(month[1])) ? raw : undefined;

  if (YEAR_RE.test(raw)) return yearInRange(Number(raw)) ? raw : undefined;

  return undefined;
}

function monthIndex(key: string): number {
  const [year, month] = key.split("-");
  return Number(year) * 12 + Number(month) - 1;
}

/** Os extremos de `AAAA-MM..AAAA-MM`; `null` para qualquer outro formato. */
export function rangeBounds(key: string): [string, string] | null {
  const match = RANGE_RE.exec(key);
  return match ? [match[1], match[2]] : null;
}

/** O intervalo entre dois meses, na ordem certa, independente de qual foi clicado primeiro. */
export function rangeKey(a: string, b: string): string {
  return a <= b ? `${a}..${b}` : `${b}..${a}`;
}

export function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** `YYYY-MM` do mês local. O "agora" entra por parâmetro para o teste não depender do relógio. */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKey(now.getFullYear(), now.getMonth() + 1);
}

function splitMonth(key: string): [number, number] {
  const [year, month] = key.split("-");
  return [Number(year), Number(month)];
}

function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = splitMonth(key);
  const index = year * 12 + (month - 1) + delta;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/**
 * Próximo período ao apertar ‹ (`-1`) ou › (`+1`). `null` = a seta fica
 * desligada: chegou ao limite do range, ou o período (`6m`, `all`) não anda.
 */
export function shiftPeriod(
  key: string,
  delta: 1 | -1,
  range: PeriodRange,
): string | null {
  if (MONTH_RE.test(key)) {
    const next = shiftMonthKey(key, delta);
    return next >= range.min_month && next <= range.max_month ? next : null;
  }
  if (YEAR_RE.test(key)) {
    const next = Number(key) + delta;
    const first = splitMonth(range.min_month)[0];
    const last = splitMonth(range.max_month)[0];
    return next >= first && next <= last ? String(next) : null;
  }
  return null;
}

export function periodLabel(key: string): string {
  const range = rangeBounds(key);
  if (range) {
    const [first, last] = range.map(splitMonth);
    const from = MONTH_NAMES[first[1] - 1];
    const to = MONTH_NAMES[last[1] - 1];
    return first[0] === last[0]
      ? `${from} a ${to} de ${last[0]}`
      : `${from} de ${first[0]} a ${to} de ${last[0]}`;
  }
  if (WINDOWS.has(key)) return `Últimos ${key.slice(0, -1)} meses`;
  if (key === "all") return "Todos os meses";
  if (YEAR_RE.test(key)) return `Ano de ${key}`;
  const [year, month] = splitMonth(key);
  return `${MONTH_NAMES[month - 1]} de ${year}`;
}

/** Linha pequena acima do título da página. */
export function periodEyebrow(
  key: string | undefined,
  currentKey: string,
  isProjection: boolean,
): string {
  const effective = key ?? currentKey;
  const base =
    effective === currentKey ? "Mês corrente" : periodLabel(effective);
  return isProjection ? `${base} · Projeção` : base;
}

/** Atalhos de um toque ao lado do botão: as janelas mais usadas, e tudo. */
export function periodShortcuts(): Array<{ value: string; label: string }> {
  return [
    { value: "3m", label: "3M" },
    { value: "6m", label: "6M" },
    { value: "12m", label: "1A" },
    { value: "all", label: "Tudo" },
  ];
}

const SHORT_MONTHS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

/** O texto do botão: `Nov/26` num mês; as janelas e `all` por extenso. */
export function periodTriggerLabel(key: string): string {
  const range = rangeBounds(key);
  if (range) {
    return `${periodTriggerLabel(range[0])} \u2013 ${periodTriggerLabel(range[1])}`;
  }
  if (MONTH_RE.test(key)) {
    const [year, month] = splitMonth(key);
    return `${SHORT_MONTHS[month - 1]}/${String(year).slice(-2)}`;
  }
  if (YEAR_RE.test(key)) return key;
  return periodLabel(key);
}

export interface MonthCell {
  key: string;
  label: string;
  disabled: boolean;
}

/** Os 12 meses de um ano para a grade do seletor; fora do range ficam desligados. */
export function monthGrid(year: number, range: PeriodRange): MonthCell[] {
  return SHORT_MONTHS.map((label, index) => {
    const key = monthKey(year, index + 1);
    return {
      key,
      label,
      disabled: key < range.min_month || key > range.max_month,
    };
  });
}

/** Ano que a grade mostra ao abrir: o do período escolhido, ou o do mês corrente. */
export function gridYear(key: string, currentKey: string): number {
  if (MONTH_RE.test(key) || YEAR_RE.test(key) || RANGE_RE.test(key)) {
    return Number(key.slice(0, 4));
  }
  return Number(currentKey.slice(0, 4));
}

/** O que vai na URL: o mês corrente é o padrão e deixa o parâmetro de fora. */
export function periodSearch(
  key: string,
  currentKey: string,
): string | undefined {
  return key === currentKey ? undefined : key;
}

/** Sufixo da chamada à API. */
export function periodQuery(periodo: string | undefined): string {
  return periodo === undefined ? "" : `?period=${periodo}`;
}

/**
 * O período tem algo para mostrar? Receita ou despesa diferente de zero, ou ao
 * menos um lançamento. Compara a string da API (`"0.00"`): a escala é do contrato
 * e o front não faz conta com dinheiro.
 */
export function periodHasData(summary: {
  revenues: string;
  expenses: string;
  itemCount: number;
}): boolean {
  return (
    summary.revenues !== "0.00" ||
    summary.expenses !== "0.00" ||
    summary.itemCount > 0
  );
}
