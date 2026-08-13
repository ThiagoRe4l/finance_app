/**
 * `reports.ts` — o único insight da tela de Relatórios que tem lastro.
 *
 * Escrito **antes** da implementação. Roda com `npm run test`.
 *
 * Contexto
 * --------
 * O mock tinha 4 "Insights" em texto corrido; a API devolvia 3 outros, e o
 * front ignorava o campo. Dos 4 do mock, só um tinha dado real por trás — o de
 * parcelamentos. Os outros três eram decoração do Lovable:
 *
 * * "economia cresceu +18% nos últimos 3 meses" — não existe janela de 3 meses;
 * * "despesas fixas representam 71%" — é o "Fixas vs Variáveis" já removido do
 *   Dashboard e registrado no backlog;
 * * "Alimentação 17% acima da média trimestral" — não existe média trimestral
 *   por categoria.
 *
 * `insights` saiu do contrato da API na mesma fatia: frase pronta em português
 * é apresentação, e apresentação é do front — o mesmo padrão que tirou o rótulo
 * Fixa/Variável/Parcelada do backend no dia 3.
 *
 * O texto passa a ser montado aqui, a partir de `GET /installments/summary`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatInstallmentsInsight } from "./reports.ts";

const NBSP = " ";  // espaço não-quebrável — o que o Intl usa

test("monta a frase com contagem e valor formatado", () => {
  assert.equal(
    formatInstallmentsInsight(3, "625.00"),
    `Você tem 3 parcelamentos ativos comprometendo R$${NBSP}625,00 por mês.`,
  );
});

test("usa singular com um parcelamento", () => {
  /*
   * O mock dizia sempre "3 parcelamentos"; com dado real a contagem varia, e
   * "1 parcelamentos ativos" é o tipo de detalhe que denuncia texto montado
   * sem cuidado.
   */
  assert.equal(
    formatInstallmentsInsight(1, "450.00"),
    `Você tem 1 parcelamento ativo comprometendo R$${NBSP}450,00 por mês.`,
  );
});

test("sem parcelamento ativo não há insight", () => {
  /*
   * `null` em vez de "Você tem 0 parcelamentos ativos": a tela omite o item da
   * lista. Mesma postura de `formatDelta`, que devolve `null` quando não há
   * percentual a exibir.
   */
  assert.equal(formatInstallmentsInsight(0, "0.00"), null);
});

test("contagem negativa também não gera insight", () => {
  // Não deveria acontecer, mas cair no caminho conhecido é melhor que exibir
  // "Você tem -1 parcelamentos".
  assert.equal(formatInstallmentsInsight(-1, "0.00"), null);
});

test("formata milhares na convenção pt-BR", () => {
  /*
   * O backend produzia `R$ 1,915.94` — vírgula de milhar e ponto decimal,
   * formato americano, num app em português. Foi um dos três defeitos que
   * motivaram tirar o texto do servidor.
   */
  assert.equal(
    formatInstallmentsInsight(4, "1915.94"),
    `Você tem 4 parcelamentos ativos comprometendo R$${NBSP}1.915,94 por mês.`,
  );
});

test("valor monetário inválido falha visível", () => {
  // Propaga o throw de `parseMoney`, como o resto do front.
  assert.throws(() => formatInstallmentsInsight(2, "abc"), /valor monetário/i);
});
