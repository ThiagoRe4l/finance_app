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


export interface InstallmentsTotals {
  activeCount: number;
  monthlyCommitted: string;
}

/**
 * Os insights que a tela exibe — hoje, no máximo um.
 *
 * Devolver uma lista (e não um valor único) é o que permite ao componente
 * esconder a seção inteira com `length === 0`, em vez de desenhar um card
 * vazio. A decisão de mostrar/esconder fica aqui, em função pura: no JSX ela
 * ficaria fora do alcance do runner de testes — que foi exatamente onde nasceu
 * o bug do `tone`/`trend` no `MetricCard`.
 *
 * O mock tinha quatro itens; três eram decoração sem dado por trás. Quando o
 * "Fixas vs Variáveis" ganhar backend (item 0 do backlog), ele entra nesta
 * lista e nada mais precisa mudar no componente.
 */
export function buildReportInsights(totals: InstallmentsTotals): string[] {
  const insights = [
    formatInstallmentsInsight(totals.activeCount, totals.monthlyCommitted),
  ];

  return insights.filter((insight): insight is string => insight !== null);
}
