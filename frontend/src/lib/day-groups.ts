/**
 * Agrupamento das transações por dia (Caderno, `docs/tema.md`, D-Cad-7).
 *
 * A lista chega ordenada (mais nova primeiro, `sortNewestFirst`) e sai na mesma
 * ordem, em grupos de datas consecutivas iguais. O rótulo é o do canvas:
 * "Hoje · 18 nov", "Ontem · 17 nov", senão o dia da semana; o ano só quando
 * não é o de hoje.
 *
 * **Sem total do dia:** seria soma de dinheiro no cliente (backlog, "Total do
 * dia nos grupos de Transações").
 *
 * As datas são lidas por componente e montadas com `new Date(ano, mês, dia)`,
 * no fuso local — `new Date("2026-11-18")` é meia-noite UTC e cai no dia
 * anterior em fuso negativo (ver `date.ts`).
 */

export type DayGroup<T> = { key: string; label: string; items: T[] };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

const MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

function localDate(iso: string): Date {
  const match = typeof iso === "string" ? ISO_DATE.exec(iso) : null;
  if (!match) throw new TypeError(`data inválida: ${JSON.stringify(iso)}`);
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayLabel(iso: string, today: Date): string {
  const date = localDate(iso);
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  const prefix = sameDay(date, today)
    ? "Hoje"
    : sameDay(date, yesterday)
      ? "Ontem"
      : WEEKDAYS[date.getDay()];
  const year =
    date.getFullYear() === today.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${prefix} · ${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

export function groupByDay<T extends { date: string }>(
  items: T[],
  today: string,
): DayGroup<T>[] {
  const now = localDate(today);
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.key === item.date) {
      last.items.push(item);
    } else {
      groups.push({
        key: item.date,
        label: dayLabel(item.date, now),
        items: [item],
      });
    }
  }
  return groups;
}
