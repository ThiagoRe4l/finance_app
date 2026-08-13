/**
 * Derivações da tela de Relatórios.
 *
 * O campo `insights` saiu do contrato da API em 13/08/2026: frase pronta em
 * português é apresentação, e apresentação é do front — mesmo padrão que tirou
 * o rótulo Fixa/Variável/Parcelada do backend no dia 3.
 *
 * Dos 4 insights do mock só um tinha lastro (parcelamentos); os outros três
 * eram decoração do Lovable, sem dado por trás. O texto passa a ser montado
 * aqui, a partir de `GET /installments/summary`.
 */

import { formatBRL } from "./money.ts";

/** Espelha `ReportSummary` do backend. Valores monetários são string. */
export interface ReportOverview {
  total_revenues: string;
  total_expenses: string;
  average_savings: number;
  monthly_comparative: Array<{ month: string; income: string; outcome: string }>;
  top_categories: Array<{ name: string; value: string }>;
}

/**
 * O único insight da tela com dado real por trás.
 *
 * Devolve `null` quando não há parcelamento ativo — a tela omite o item em vez
 * de exibir "Você tem 0 parcelamentos ativos". Mesma postura de `formatDelta`.
 *
 * O `formatBRL` aqui não é detalhe: o backend produzia `R$ 1,915.94`, com
 * vírgula de milhar e ponto decimal, porque o `:,.2f` do Python é sempre
 * formato americano. Foi um dos três defeitos que motivaram tirar o texto do
 * servidor.
 */
export function formatInstallmentsInsight(
  activeCount: number,
  monthlyCommitted: string,
): string | null {
  if (activeCount <= 0) {
    return null;
  }

  const plural = activeCount === 1 ? "parcelamento ativo" : "parcelamentos ativos";
  return `Você tem ${activeCount} ${plural} comprometendo ${formatBRL(monthlyCommitted)} por mês.`;
}
