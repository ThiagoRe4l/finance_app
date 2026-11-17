/**
 * Máscara de valor "caixa registradora" (T-3, `docs/integracao-frontend.md`).
 *
 * Escrito **antes** da implementação. Os dígitos entram pela direita: `4` →
 * `R$ 0,04`, `40000` → `R$ 400,00`. Tudo em string de dígitos — nada passa por
 * `number`, que reintroduziria o ponto flutuante do `float`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MONEY_DIGITS,
  decimalToMask,
  maskMoney,
  parseMoneyInput,
} from "./money.ts";

test("sem dígito nenhum o campo fica vazio (o placeholder mostra R$ 0,00)", () => {
  assert.equal(maskMoney(""), "");
  assert.equal(maskMoney("abc"), "");
  assert.equal(maskMoney("R$ "), "");
});

test("os dígitos entram pela direita: centavo, dezena, centena", () => {
  assert.equal(maskMoney("4"), "R$ 0,04");
  assert.equal(maskMoney("40"), "R$ 0,40");
  assert.equal(maskMoney("400"), "R$ 4,00");
  assert.equal(maskMoney("40000"), "R$ 400,00");
});

test("milhar e milhão ganham ponto", () => {
  assert.equal(maskMoney("150050"), "R$ 1.500,50");
  assert.equal(maskMoney("123456789"), "R$ 1.234.567,89");
});

test("digitar sobre o texto já mascarado acrescenta o dígito à direita", () => {
  // O onChange recebe o texto do campo com o dígito novo no fim.
  assert.equal(maskMoney("R$ 0,04" + "0"), "R$ 0,40");
  assert.equal(maskMoney("R$ 4,00" + "5"), "R$ 40,05");
});

test("backspace remove o último dígito", () => {
  // O onChange recebe o texto sem o último caractere.
  assert.equal(maskMoney("R$ 1,2"), "R$ 0,12");
  assert.equal(maskMoney("R$ 0,0"), "");
  assert.equal(maskMoney("R$ 0,4"), "R$ 0,04");
});

test("zeros à esquerda não contam", () => {
  assert.equal(maskMoney("0004"), "R$ 0,04");
  assert.equal(maskMoney("000"), "");
});

test("colar texto aproveita só os dígitos", () => {
  assert.equal(maskMoney("R$ 1.500,50"), "R$ 1.500,50");
  assert.equal(maskMoney("  342,50 reais"), "R$ 342,50");
});

test("o teto é o de Numeric(12, 2): 12 dígitos, o 13º é ignorado", () => {
  assert.equal(MAX_MONEY_DIGITS, 12);
  const full = "9".repeat(12);
  assert.equal(maskMoney(full), "R$ 9.999.999.999,99");
  assert.equal(maskMoney(full + "1"), "R$ 9.999.999.999,99");
});

test("decimalToMask: o decimal canônico da API vira texto mascarado", () => {
  assert.equal(decimalToMask("1500.50"), "R$ 1.500,50");
  assert.equal(decimalToMask("450.00"), "R$ 450,00");
  assert.equal(decimalToMask("0.04"), "R$ 0,04");
  // Sem casas decimais ou com uma só: completa com zeros à direita.
  assert.equal(decimalToMask("12"), "R$ 12,00");
  assert.equal(decimalToMask("12.5"), "R$ 12,50");
  // Zero é campo vazio: "Orçamento 0" mostra o placeholder.
  assert.equal(decimalToMask("0.00"), "");
});

test("ida e volta sem número no meio: máscara → parseMoneyInput → decimal", () => {
  assert.equal(parseMoneyInput(maskMoney("40000")), "400.00");
  assert.equal(parseMoneyInput(maskMoney("150050")), "1500.50");
  assert.equal(parseMoneyInput(maskMoney("4")), "0.04");
  assert.equal(parseMoneyInput(maskMoney("123456789")), "1234567.89");
  // E o caminho de edição devolve o mesmo valor.
  assert.equal(parseMoneyInput(decimalToMask("1500.50")), "1500.50");
  // 0,10 + 0,20 não é problema aqui: nenhum `number` participa.
  assert.equal(parseMoneyInput(maskMoney("10")), "0.10");
});

test("campo vazio continua sendo null: obrigatório em branco vira erro de validação", () => {
  assert.equal(parseMoneyInput(maskMoney("")), null);
});
