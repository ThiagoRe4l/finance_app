/**
 * Derivações puras da tela de Visão Geral.
 *
 * Nada aqui calcula dinheiro: os três percentuais do `MetricCard` já chegam
 * prontos da API (`balance_change_pct`, `expenses_change_pct`,
 * `savings_pct_of_revenue`, todos JSON number), e o total de despesas também.
 * O que falta é formatação e a participação por categoria, que a API não
 * devolve.
 */

import { parseMoney } from "./money.ts";

/** Espelha `CategoryResponse` do backend. Valores monetários são string. */
export interface CategorySummary {
  id: number;
  name: string;
  icon_name: string;
  color: string;
  budget: string;
  spent: string;
  txs_count: number;
}

export interface DistributionRow {
  id: number;
  name: string;
  color: string;
  spent: number;
  /** Participação no total de despesas do mês, em 0–100. */
  percent: number;
}

/**
 * Percentual da API → texto do rodapé do `MetricCard`.
 *
 * Devolve `null` — e não lança — quando não há percentual. `expenses_change_pct`
 * vem `null` sempre que o mês anterior não teve despesa, que é o caso comum em
 * banco novo. Um card sem delta é degradação aceitável; um throw derrubaria o
 * dashboard inteiro por causa do rodapé de um card. É a diferença de postura em
 * relação a `money.ts`, que lança de propósito.
 */
export function formatDelta(
  percentage: number | null | undefined,
  suffix: string,
): string | null {
  if (percentage === null || percentage === undefined || !Number.isFinite(percentage)) {
    return null;
  }

  // `toFixed` já traz o "-"; o "+" é acrescentado para o positivo e para o
  // zero. `-0 < 0` é falso, então zero negativo também cai no "+".
  const sign = percentage < 0 ? "" : "+";
  return `${sign}${percentage.toFixed(1).replace(".", ",")}% ${suffix}`;
}

export type Trend = "up" | "down" | "flat";

/**
 * Direção da variação, a partir do **sinal numérico** do percentual.
 *
 * Existe porque `MetricCard` decidia o ícone a partir de `tone`, e `tone`
 * codifica *bom/ruim*, não *subiu/desceu*. Nos cards de saldo e economia os
 * dois coincidem; em Despesas divergem, porque gasto subindo é ruim — e
 * "+325,8%" acabava exibindo seta para baixo.
 *
 * São duas informações diferentes e ambas corretas ao mesmo tempo: a seta
 * reflete a direção real, a cor reflete o julgamento.
 *
 * O sinal vem do número, nunca da string já formatada — que perde precisão no
 * arredondamento. O efeito colateral está fixado em teste: uma alta de 0,04%
 * exibe "+0,0%" ao lado de uma seta de alta. Se um dia incomodar, a saída é um
 * limiar mínimo aqui, não inferir direção de texto.
 */
export function trendFromDelta(percentage: number | null | undefined): Trend {
  if (percentage === null || percentage === undefined || !Number.isFinite(percentage)) {
    return "flat";
  }
  if (percentage > 0) return "up";
  if (percentage < 0) return "down";
  // Cobre `0` e `-0`: nenhum dos dois é queda.
  return "flat";
}

/**
 * Categorias da API → linhas do gráfico de distribuição.
 *
 * `percent` é a **participação no total de despesas**, não o uso do orçamento —
 * este é o papel de `categorias.tsx`. A conta só faz sentido porque as duas
 * pontas recortam o mesmo mês: `_aggregated_rows` passou a filtrar o mês
 * corrente, e o backend fixa `soma(spent) == total_expenses` em teste. Antes
 * disso `spent` era acumulado e a participação chegava a 1000%.
 *
 * Sem clamp de propósito. Se aquela igualdade regredir, o número tem que
 * aparecer errado em vez de saturar em 100% e esconder a regressão.
 */
export function toDistribution(
  categories: CategorySummary[],
  totalExpenses: string,
): DistributionRow[] {
  const total = parseMoney(totalExpenses);

  return categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      spent: parseMoney(category.spent),
    }))
    // Categoria zerada vira barra vazia sem informação. A API devolve todas
    // porque o join é OUTER — num banco novo são as 7 categorias de seed.
    .filter((row) => row.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .map((row) => ({
      ...row,
      // `total > 0` guarda a divisão: com a lista já filtrada este ramo não é
      // alcançável hoje, mas deixá-lo implícito convidaria um `Infinity` para
      // dentro do `style={{ width }}`.
      percent: total > 0 ? (row.spent / total) * 100 : 0,
    }));
}
