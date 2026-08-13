/**
 * `installments.ts` — derivações da tela de parcelamentos.
 *
 * Escrito **antes** da implementação. Roda com `npm run test`.
 *
 * Sobrou pouco para o front nesta tela: `remaining_amount` por item e os três
 * totais do topo agora vêm prontos do backend (`GET /installments/summary`,
 * fatia de 13/08/2026). O que resta é o progresso do card — e é justamente
 * onde o mock estava errado.
 *
 * O bug que isto corrige
 * ----------------------
 * O mock calculava, no mesmo card:
 *
 *     percent   = current / total                       // "17% pago" em 2/12
 *     remaining = parcela × (total - current + 1)       // 11 parcelas
 *
 * Os dois discordam sobre o que `current` significa: o primeiro assume as
 * `current` parcelas já pagas, o segundo assume que a `current` ainda vai ser
 * paga. Pela D13 a segunda leitura é a correta — `current == total` é a última
 * parcela, ainda a pagar. Então `percent` estava adiantado em uma parcela.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { installmentProgress } from "./installments.ts";

// ---------------------------------------------------------------------------
// Percentual pago
// ---------------------------------------------------------------------------

test("nenhuma parcela paga na primeira", () => {
  /*
   * 1/12: a primeira parcela ainda vai ser paga, então 0% pago. O mock dizia
   * 8% — uma parcela que ninguém pagou.
   */
  const p = installmentProgress(1, 12);

  assert.equal(p.paidCount, 0);
  assert.equal(p.percent, 0);
});

test("2/12 é uma parcela paga, não duas", () => {
  const p = installmentProgress(2, 12);

  assert.equal(p.paidCount, 1);
  assert.ok(Math.abs(p.percent - 8.3333) < 1e-3, `veio ${p.percent}`);
});

test("última parcela ainda não está paga", () => {
  /*
   * 12/12 é a última parcela, ainda a pagar — a mesma fronteira que o 4.3
   * trava no backend. 11 de 12 pagas, não 12.
   */
  const p = installmentProgress(12, 12);

  assert.equal(p.paidCount, 11);
  assert.ok(Math.abs(p.percent - 91.6666) < 1e-3, `veio ${p.percent}`);
  assert.equal(p.isPaidOff, false);
});

test("quitado é 100% e nem uma parcela a mais", () => {
  const p = installmentProgress(13, 12);

  assert.equal(p.paidCount, 12);
  assert.equal(p.percent, 100);
  assert.equal(p.isPaidOff, true);
});

test("muito além do fim continua em 100%", () => {
  // 20/12 daria 19 parcelas pagas de 12. O teto evita barra estourada e
  // "158% pago".
  const p = installmentProgress(20, 12);

  assert.equal(p.paidCount, 12);
  assert.equal(p.percent, 100);
  assert.equal(p.isPaidOff, true);
});

test("current abaixo de 1 não gera percentual negativo", () => {
  // Estado que o schema não impede. Piso em zero.
  const p = installmentProgress(0, 12);

  assert.equal(p.paidCount, 0);
  assert.equal(p.percent, 0);
});

// ---------------------------------------------------------------------------
// Quitado — o marcador da tela
// ---------------------------------------------------------------------------

test("quitado começa exatamente em total + 1", () => {
  /*
   * A fronteira, do lado do front desta vez. Decidido que o card quitado
   * **aparece** na listagem com marcador, em vez de ser filtrado — cada card é
   * informação discreta, diferente do widget de distribuição do Dashboard.
   */
  assert.equal(installmentProgress(12, 12).isPaidOff, false);
  assert.equal(installmentProgress(13, 12).isPaidOff, true);
});

// ---------------------------------------------------------------------------
// Casos degenerados
// ---------------------------------------------------------------------------

test("total zero não gera divisão por zero", () => {
  /*
   * Não deveria existir — nenhuma tela cria parcelamento sem parcelas —, mas o
   * schema não impede, e `NaN%` iria direto para `style={{ width }}`.
   */
  const p = installmentProgress(1, 0);

  assert.equal(p.percent, 0);
  assert.equal(p.paidCount, 0);
});

test("percentual nunca sai do intervalo 0–100", () => {
  const casos: Array<[number, number]> = [
    [1, 12], [2, 12], [12, 12], [13, 12], [20, 12], [0, 12], [1, 0], [-5, 12],
  ];

  for (const [current, total] of casos) {
    const { percent } = installmentProgress(current, total);
    assert.ok(
      percent >= 0 && percent <= 100,
      `${current}/${total} devolveu ${percent}, fora do intervalo`,
    );
  }
});
