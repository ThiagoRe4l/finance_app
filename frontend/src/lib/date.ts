/**
 * Conversão entre a data da API (ISO `YYYY-MM-DD`) e o `Date` do date picker.
 *
 * ⚠️ As duas conversões ingênuas erram em **hemisférios opostos**, que é por
 * que nenhuma aparece testando do Brasil:
 *
 *     new Date("2026-08-07")            -> dia 6 em fuso NEGATIVO
 *     date.toISOString().slice(0, 10)   -> dia 6 em fuso POSITIVO
 *
 * Verificado em America/Sao_Paulo, Asia/Tokyo e Pacific/Kiritimati. O
 * `parseISO`/`format` do `date-fns` acerta os dois sentidos, e todo o
 * conhecimento de fuso do projeto fica neste módulo.
 */

import { format, parseISO } from "date-fns";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `"2026-08-07"` → `"07/08"`.
 *
 * O parse é manual de propósito. `new Date("2026-08-07")` é interpretado como
 * meia-noite **UTC**, então em qualquer fuso negativo — o do Brasil incluído —
 * `getDate()` devolve o dia anterior. Passar pelo `Date` erraria a data de
 * toda transação da tela, e erraria de forma plausível: o número existe, só
 * está um dia atrás. Ver `date.test.ts`.
 */
export function formatShortDate(value: string): string {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) {
    throw new TypeError(`data inválida: ${JSON.stringify(value)}`);
  }

  const [, , month, day] = match;
  return `${day}/${month}`;
}


/**
 * ISO da API → `Date` local, para o `selected` do `Calendar`.
 *
 * `parseISO` monta a data a partir dos componentes, sem passar por UTC — ao
 * contrário de `new Date(iso)`, que é meia-noite UTC e volta um dia em fuso
 * negativo.
 */
export function parseISODate(value: string): Date {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new TypeError(`data inválida: ${JSON.stringify(value)}`);
  }
  return parseISO(value);
}

/**
 * `Date` do picker → ISO para o payload.
 *
 * `format` usa os componentes **locais**. `toISOString()` converteria para UTC
 * antes de cortar, e meia-noite local em fuso positivo vira o dia anterior.
 */
export function toISODate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`data inválida: ${String(date)}`);
  }
  return format(date, "yyyy-MM-dd");
}

/**
 * `"2026-08-07"` → `"07/08/2026"`, para o botão do date picker.
 *
 * `formatShortDate` (`"07/08"`) continua servindo à tabela, onde a coluna é
 * estreita e o ano é redundante; no formulário o ano importa.
 */
export function formatFullDate(value: string): string {
  return format(parseISODate(value), "dd/MM/yyyy");
}
