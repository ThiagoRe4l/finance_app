/**
 * `dashboard.ts` — derivações puras da tela de Visão Geral.
 *
 * Escrito **antes** da implementação. Roda com `npm run test`.
 *
 * Duas funções, cada uma fechando um gap do mapeamento:
 *
 * * `formatDelta` — a API devolve `balance_change_pct: 24.018042657676403`
 *   (JSON **number**: percentual continuou `float` na migração para `Decimal`).
 *   O `MetricCard` espera `delta?: string` já pronto. É formatação, não cálculo:
 *   os três percentuais chegam calculados desde o realinhamento do dia 3.
 * * `toDistribution` — o mock do `CategoryBars` trazia um `percent` que a API
 *   não devolve, e cujos valores eram internamente inconsistentes (ver "Os
 *   mocks são cenografia do Lovable" no CLAUDE.md). A fórmula decidida é
 *   participação no total de despesas — uso de orçamento é o papel de
 *   `categorias.tsx`.
 *
 * Sem clamp, de propósito
 * -----------------------
 * Uma versão anterior deste arquivo limitava `percent` a 100, porque `spent`
 * era acumulado de todos os tempos e `total_expenses` era do mês — bases
 * diferentes, que produziam 1000% no widget. **Isso foi corrigido na origem**:
 * `_aggregated_rows` passou a recortar o mês corrente, e o backend tem teste
 * fixando `soma(spent) == total_expenses`.
 *
 * O clamp saiu junto. Ele esconderia a volta da divergência atrás de uma barra
 * saturada em 100%, em vez de deixá-la aparecer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDelta, toDistribution, trendFromDelta } from "./dashboard.ts";
import type { CategorySummary } from "./dashboard.ts";

function category(overrides: Partial<CategorySummary> = {}): CategorySummary {
  return {
    id: 1,
    name: "Moradia",
    icon_name: "Home",
    color: "oklch(0.45 0.04 235)",
    budget: "2500.00",
    spent: "2100.00",
    txs_count: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatDelta
// ---------------------------------------------------------------------------

test("formata percentual positivo com sinal explícito", () => {
  assert.equal(formatDelta(24.018042657676403, "vs mês anterior"), "+24,0% vs mês anterior");
});

test("formata percentual negativo", () => {
  // O sinal já vem do número; não se acrescenta outro.
  assert.equal(formatDelta(-7.14, "vs mês anterior"), "-7,1% vs mês anterior");
});

test("usa vírgula decimal, como o resto da UI", () => {
  assert.equal(formatDelta(70.75266272189349, "das receitas"), "+70,8% das receitas");
});

test("arredonda para uma casa", () => {
  // Uma casa é o que o mock original exibia ("+3.2%", "-7.1%"); o número cru
  // da API tem 15 dígitos e seria ruído na tela.
  assert.equal(formatDelta(3.249, "vs mês anterior"), "+3,2% vs mês anterior");
  assert.equal(formatDelta(3.25, "vs mês anterior"), "+3,3% vs mês anterior");
});

test("zero não ganha sinal negativo", () => {
  assert.equal(formatDelta(0, "vs mês anterior"), "+0,0% vs mês anterior");
});

test("devolve null quando o percentual é null", () => {
  /*
   * `expenses_change_pct` vem `null` quando o mês anterior não teve despesa —
   * o caso comum em banco novo, não a exceção. Decidido: **omite o delta**,
   * mesmo tratamento dos outros percentuais opcionais. `null` deixa o
   * componente passar `undefined` ao `MetricCard`, cujo `delta` é opcional.
   */
  assert.equal(formatDelta(null, "vs mês anterior"), null);
  assert.equal(formatDelta(undefined, "vs mês anterior"), null);
});

test("devolve null em número não finito", () => {
  /*
   * Aqui a postura é diferente da de `money.ts`, que lança: um card sem delta é
   * degradação aceitável, enquanto um throw derrubaria o dashboard inteiro por
   * causa do rodapé de um card.
   */
  assert.equal(formatDelta(Number.NaN, "vs mês anterior"), null);
  assert.equal(formatDelta(Number.POSITIVE_INFINITY, "vs mês anterior"), null);
});

// ---------------------------------------------------------------------------
// trendFromDelta — direção da seta, separada do julgamento de cor
// ---------------------------------------------------------------------------
//
// Bug encontrado na validação visual do Dashboard: "Despesas +325,8%" exibia
// seta ↘.
//
// Causa: `MetricCard` decidia o ícone a partir de `tone`, e `tone` codifica
// **bom/ruim**, não **subiu/desceu**. Nos outros três cards os dois coincidem
// (saldo subindo é bom e é ↗); em Despesas divergem, porque gasto subindo é
// ruim. O mock nunca expôs isso: passava `tone="negative"` com delta `-7.1%`,
// onde "para baixo" e "ruim" coincidiam por acidente do dado fictício.
//
// A direção passa a sair daqui, do **sinal numérico** do percentual — nunca da
// string já formatada, que perderia precisão no arredondamento.

test("percentual positivo é alta", () => {
  assert.equal(trendFromDelta(325.8), "up");
  assert.equal(trendFromDelta(0.5), "up");
});

test("percentual negativo é queda", () => {
  assert.equal(trendFromDelta(-7.14), "down");
});

test("zero é estável", () => {
  assert.equal(trendFromDelta(0), "flat");
});

test("zero negativo é estável, não queda", () => {
  // `-0 < 0` é falso em JS, mas convém fixar: `-0` pode surgir de subtração
  // exata e não deve virar seta para baixo.
  assert.equal(trendFromDelta(-0), "flat");
});

test("sem percentual é estável", () => {
  /*
   * `expenses_change_pct` vem `null` quando o mês anterior não teve despesa.
   * Nesse caso `formatDelta` também devolve `null` e o rodapé some inteiro —
   * mas a prop precisa de um valor definido, e "flat" é o único honesto: não
   * há comparação a fazer.
   */
  assert.equal(trendFromDelta(null), "flat");
  assert.equal(trendFromDelta(undefined), "flat");
});

test("número não finito é estável", () => {
  assert.equal(trendFromDelta(Number.NaN), "flat");
  assert.equal(trendFromDelta(Number.POSITIVE_INFINITY), "flat");
});

test("⚠️ a seta segue o sinal cru, não o valor exibido", () => {
  /*
   * `formatDelta(0.04)` exibe "+0,0%" — arredondado para uma casa —, mas a
   * seta aponta para cima, porque o número **é** positivo.
   *
   * Decidido assim de propósito: a direção vem do sinal numérico, não da
   * string formatada. O efeito colateral é este caso, em que o texto mostra
   * "0,0%" ao lado de uma seta de alta. Se algum dia isso incomodar, a saída é
   * um limiar mínimo aqui — não inferir a direção do texto.
   */
  assert.equal(trendFromDelta(0.04), "up");
  assert.equal(formatDelta(0.04, "vs mês anterior"), "+0,0% vs mês anterior");
});

test("trend e tone são independentes — o caso que originou o bug", () => {
  /*
   * O card de Despesas: gasto subiu 325,8%. A seta tem que apontar para cima
   * (a direção real) enquanto a cor fica vermelha (o julgamento). Este teste
   * cobre só a metade que é função pura; o acoplamento das duas props vive em
   * `index.tsx`, que não tem cobertura — ver a decisão em aberto sobre Vitest.
   */
  const expensesChange = 325.8;

  assert.equal(trendFromDelta(expensesChange), "up");
  assert.equal(formatDelta(expensesChange, "vs mês anterior"), "+325,8% vs mês anterior");
});

// ---------------------------------------------------------------------------
// toDistribution
// ---------------------------------------------------------------------------

test("percent é a participação no total de despesas", () => {
  // Total = 2100 + 700 + 200 = 3000.
  const rows = toDistribution(
    [
      category({ id: 1, name: "Moradia", spent: "2100.00" }),
      category({ id: 2, name: "Alimentação", spent: "700.00" }),
      category({ id: 3, name: "Transporte", spent: "200.00" }),
    ],
    "3000.00",
  );

  assert.deepEqual(
    rows.map((r) => [r.name, Math.round(r.percent * 100) / 100]),
    [
      ["Moradia", 70],
      ["Alimentação", 23.33],
      ["Transporte", 6.67],
    ],
  );
});

test("os percentuais somam 100%", () => {
  /*
   * A invariante que substitui o clamp removido.
   *
   * Ela só vale porque o backend garante `soma(spent) == total_expenses` — as
   * duas pontas recortam o mesmo mês desde a fatia de 10/08/2026
   * (`test_monthly_scope.py::test_category_distribution_sums_to_total_expenses`).
   * Se aquela igualdade regredir, este teste é o que denuncia do lado do front.
   */
  const rows = toDistribution(
    [
      category({ id: 1, name: "Moradia", spent: "2100.00" }),
      category({ id: 2, name: "Alimentação", spent: "700.00" }),
      category({ id: 3, name: "Transporte", spent: "200.00" }),
    ],
    "3000.00",
  );

  const total = rows.reduce((sum, r) => sum + r.percent, 0);
  assert.ok(Math.abs(total - 100) < 1e-9, `esperado 100, veio ${total}`);
});

test("filtra categorias sem gasto", () => {
  /*
   * Decidido: no widget de distribuição, categoria zerada não aparece. É o
   * oposto de `categorias.tsx`, que mostra todas — lá a categoria zerada é
   * informação (orçamento não usado), aqui seria barra vazia sem sentido.
   *
   * A API devolve todas de propósito: o join em `list_categories` é OUTER, e
   * num banco recém-criado são 7 categorias de seed com `spent: "0.00"`.
   */
  const rows = toDistribution(
    [
      category({ id: 1, name: "Moradia", spent: "2100.00" }),
      category({ id: 2, name: "Lazer", spent: "0.00" }),
      category({ id: 3, name: "Saúde", spent: "0.00" }),
    ],
    "2100.00",
  );

  assert.deepEqual(rows.map((r) => r.name), ["Moradia"]);
});

test("ordena do maior gasto para o menor", () => {
  // A API ordena por `Category.id`; o gráfico precisa de ordem de grandeza.
  const rows = toDistribution(
    [
      category({ id: 1, name: "Transporte", spent: "200.00" }),
      category({ id: 2, name: "Moradia", spent: "2100.00" }),
      category({ id: 3, name: "Alimentação", spent: "700.00" }),
    ],
    "3000.00",
  );

  assert.deepEqual(rows.map((r) => r.name), ["Moradia", "Alimentação", "Transporte"]);
});

test("preserva id, nome e cor para o componente pintar a barra", () => {
  const [row] = toDistribution([category({ spent: "2100.00" })], "2100.00");

  assert.equal(row.id, 1);
  assert.equal(row.name, "Moradia");
  assert.equal(row.color, "oklch(0.45 0.04 235)");
  assert.equal(row.spent, 2100);
});

test("categoria única concentra 100%", () => {
  const [row] = toDistribution([category({ spent: "2100.00" })], "2100.00");

  assert.equal(row.percent, 100);
});

test("total de despesas zero não gera divisão por zero", () => {
  /*
   * Banco novo: nenhuma transação, `total_expenses: "0.00"`. O filtro de
   * `spent > 0` já esvazia a lista, mas a implementação não pode chegar a
   * dividir por zero e devolver `Infinity`/`NaN` no caminho.
   */
  const rows = toDistribution(
    [category({ spent: "0.00" }), category({ id: 2, name: "Lazer", spent: "0.00" })],
    "0.00",
  );

  assert.deepEqual(rows, []);
});

test("lista vazia devolve lista vazia", () => {
  assert.deepEqual(toDistribution([], "0.00"), []);
});

test("valor monetário inválido falha visível", () => {
  /*
   * `toDistribution` parseia via `parseMoney`, que lança. Um `spent` que não
   * seja número indica contrato quebrado, e é melhor derrubar o widget do que
   * desenhar uma barra de largura `NaN%`.
   */
  assert.throws(
    () => toDistribution([category({ spent: "abc" })], "100.00"),
    /valor monetário/i,
  );
});
