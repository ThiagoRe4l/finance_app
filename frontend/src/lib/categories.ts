/**
 * Progresso de orçamento por categoria.
 *
 * `spent / budget` só faz sentido porque as duas pontas são do **mês corrente**
 * desde a fatia de 10/08/2026 — antes `spent` era acumulado de todos os tempos
 * contra um orçamento mensal, e a barra só crescia.
 */

import { parseMoney } from "./money.ts";

/** Acima deste uso do orçamento a UI pinta em tom de alerta. */
const ALERT_THRESHOLD = 90;

export interface CategoryProgress {
  spent: number;
  budget: number;
  /** `false` quando não há orçamento definido (`budget <= 0`). */
  hasBudget: boolean;
  /**
   * Uso real do orçamento. **Pode passar de 100** — é o número exibido.
   * `null` quando não há orçamento contra o que comparar.
   */
  percent: number | null;
  /** Largura da barra, sempre entre 0 e 100. */
  width: number;
  /** Uso >= 90%. Escolha de apresentação; não vem da API. */
  isAlert: boolean;
}

export function categoryProgress(spent: string, budget: string): CategoryProgress {
  const spentValue = parseMoney(spent);
  const budgetValue = parseMoney(budget);

  // `budget <= 0` cobre o zero do seed (categoria "Receita") e o negativo, que
  // o schema não impede. Sem esta guarda a divisão daria `NaN` (0/0) ou
  // `Infinity`, e qualquer um dos dois vai direto para `style={{ width }}`.
  if (budgetValue <= 0) {
    return {
      spent: spentValue,
      budget: budgetValue,
      hasBudget: false,
      percent: null,
      width: 0,
      isAlert: false,
    };
  }

  const percent = (spentValue / budgetValue) * 100;

  return {
    spent: spentValue,
    budget: budgetValue,
    hasBudget: true,
    // Percentual e largura são valores distintos de propósito: o mock clampava
    // os dois, então uma categoria em 120% aparecia como exatamente "100%" e o
    // estouro sumia justo no caso em que importa.
    percent,
    width: Math.min(100, Math.max(0, percent)),
    isAlert: percent >= ALERT_THRESHOLD,
  };
}
