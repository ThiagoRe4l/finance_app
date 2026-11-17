/**
 * Texto dos tooltips dos gráficos de meses (`docs/periodos.md`, fatia 3).
 *
 * Só formata o que a API mandou. Nada aqui soma dinheiro: um "saldo do mês"
 * (entradas − saídas) seria aritmética monetária no cliente.
 */

import { formatBRL } from "./money.ts";
import { periodLabel } from "./period.ts";

/** O ponto de um gráfico de meses; é o `MonthlyFlow` da API. */
export interface MonthPoint {
  month: string;
  month_key: string;
  income: string;
  outcome: string;
}

/** `"Novembro de 2026"`; mês depois do corrente leva `" · Projeção"`. */
export function monthTooltipTitle(
  monthKey: string,
  currentKey: string,
): string {
  const label = periodLabel(monthKey);
  return monthKey > currentKey ? `${label} · Projeção` : label;
}

/** Nome acessível da coluna: o mesmo que o tooltip mostra, em uma frase. */
export function monthColumnLabel(
  point: MonthPoint,
  currentKey: string,
): string {
  return `${monthTooltipTitle(point.month_key, currentKey)}: entradas ${formatBRL(point.income)}, saídas ${formatBRL(point.outcome)}`;
}
