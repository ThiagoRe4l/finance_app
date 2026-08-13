/**
 * `categories.ts` — progresso de orçamento por categoria.
 *
 * Escrito **antes** da implementação. Roda com `npm run test`.
 *
 * `spent / budget` só passou a fazer sentido depois da fatia de 10/08/2026:
 * antes `spent` era acumulado de todos os tempos e `budget` é mensal, então a
 * barra só crescia e toda categoria acabava permanentemente estourada. Agora as
 * duas pontas são do mês corrente.
 *
 * Três decisões desta tela estão fixadas aqui:
 *
 * 1. **`budget = 0` é "sem orçamento definido"**, não 0% e não motivo para
 *    esconder a categoria. O seed tem esse caso (`Receita`), e o mock não
 *    tinha — dividir por zero daria `Infinity` direto no `style={{ width }}`.
 * 2. **Percentual real e largura da barra são valores diferentes.** O mock
 *    usava `Math.min(100, …)` para os dois, então uma categoria em 120%
 *    aparecia como exatamente "100%" — o estouro sumia justamente no caso em
 *    que ele importa.
 * 3. **Limiar de atenção em 90%** é escolha de UI, não vem da API. Mantido do
 *    mock por ser decisão de apresentação legítima, diferente dos números
 *    decorativos do Lovable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { categoryProgress } from "./categories.ts";

// ---------------------------------------------------------------------------
// Caminho normal
// ---------------------------------------------------------------------------

test("percentual é o uso do orçamento", () => {
  const p = categoryProgress("2100.00", "2500.00");

  assert.equal(p.hasBudget, true);
  assert.equal(p.percent, 84);
  assert.equal(p.width, 84);
});

test("expõe os valores já parseados para o componente formatar", () => {
  const p = categoryProgress("2128.90", "2500.00");

  assert.equal(p.spent, 2128.9);
  assert.equal(p.budget, 2500);
});

test("gasto zero é 0%", () => {
  const p = categoryProgress("0.00", "2500.00");

  assert.equal(p.percent, 0);
  assert.equal(p.width, 0);
  assert.equal(p.isAlert, false);
});

test("preserva a fração — quem arredonda é a exibição", () => {
  // 1240 / 1500 = 82,666…%. Guardar arredondado aqui impediria o componente de
  // escolher a precisão.
  const p = categoryProgress("1240.00", "1500.00");

  assert.ok(Math.abs(p.percent! - 82.6666666) < 1e-4, `veio ${p.percent}`);
});

// ---------------------------------------------------------------------------
// Estouro: percentual real ≠ largura da barra
// ---------------------------------------------------------------------------

test("estouro de orçamento mantém o percentual real", () => {
  /*
   * O caso que o mock escondia: `Math.min(100, …)` alimentava texto **e**
   * largura, então 120% aparecia como "100%" e a categoria parecia estar
   * exatamente no limite.
   */
  const p = categoryProgress("3000.00", "2500.00");

  assert.equal(p.percent, 120);
  assert.equal(p.width, 100);
});

test("largura nunca passa de 100, por maior que seja o estouro", () => {
  const p = categoryProgress("25000.00", "2500.00");

  assert.equal(p.percent, 1000);
  assert.equal(p.width, 100);
});

test("exatamente no orçamento é 100% nos dois", () => {
  const p = categoryProgress("2500.00", "2500.00");

  assert.equal(p.percent, 100);
  assert.equal(p.width, 100);
});

// ---------------------------------------------------------------------------
// Limiar de atenção
// ---------------------------------------------------------------------------

test("90% já é atenção — a fronteira é inclusiva", () => {
  assert.equal(categoryProgress("2250.00", "2500.00").isAlert, true);
});

test("logo abaixo de 90% ainda não é atenção", () => {
  assert.equal(categoryProgress("2249.00", "2500.00").isAlert, false);
});

test("estouro continua em atenção", () => {
  assert.equal(categoryProgress("3000.00", "2500.00").isAlert, true);
});

// ---------------------------------------------------------------------------
// Sem orçamento definido
// ---------------------------------------------------------------------------

test("budget zero é 'sem orçamento', não 0%", () => {
  /*
   * `Receita` no seed vem com `budget: "0.00"`. Sem esta guarda,
   * `spent / budget` daria `NaN` (0/0) ou `Infinity`, e qualquer um dos dois
   * vai direto para `style={{ width }}`.
   *
   * `percent: null` é o que permite o componente escolher rótulo em vez de
   * número — a decisão foi mostrar "sem orçamento definido", não esconder a
   * categoria nem exibir 0%.
   */
  const p = categoryProgress("0.00", "0.00");

  assert.equal(p.hasBudget, false);
  assert.equal(p.percent, null);
  assert.equal(p.width, 0);
  assert.equal(p.isAlert, false);
});

test("gasto sem orçamento definido não vira Infinity", () => {
  const p = categoryProgress("500.00", "0.00");

  assert.equal(p.hasBudget, false);
  assert.equal(p.percent, null);
  assert.equal(p.width, 0);
  // O gasto continua disponível: a categoria aparece com o valor, só não tem
  // barra de progresso contra o que comparar.
  assert.equal(p.spent, 500);
});

test("orçamento negativo também conta como sem orçamento", () => {
  // Não deveria existir, mas o schema não impede. Melhor cair no caminho
  // conhecido do que gerar percentual negativo e barra invertida.
  const p = categoryProgress("100.00", "-50.00");

  assert.equal(p.hasBudget, false);
  assert.equal(p.percent, null);
});

// ---------------------------------------------------------------------------
// Entrada inválida
// ---------------------------------------------------------------------------

test("valor monetário inválido falha visível", () => {
  // Propaga o throw de `parseMoney`: melhor derrubar o card do que desenhar
  // uma barra de largura `NaN%`.
  assert.throws(() => categoryProgress("abc", "2500.00"), /valor monetário/i);
  assert.throws(() => categoryProgress("100.00", "xyz"), /valor monetário/i);
});
