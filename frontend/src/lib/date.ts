/**
 * Formatação das datas devolvidas pela API (ISO `YYYY-MM-DD`).
 */

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
