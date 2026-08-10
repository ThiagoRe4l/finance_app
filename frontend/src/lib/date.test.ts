/**
 * `date.ts` — formatação das datas devolvidas pela API.
 *
 * Escrito **antes** da implementação. A API devolve `date` em ISO
 * (`"2026-08-07"`) e a tela de Transações exibe `dd/MM` (`"07/08"`), como no
 * mock original.
 *
 * Por que isso não é um `toLocaleDateString` e pronto
 * ---------------------------------------------------
 * `new Date("2026-08-07")` é interpretado como **meia-noite UTC**. Em qualquer
 * fuso negativo — inclusive o do Brasil — isso volta um dia:
 *
 *     TZ=America/Sao_Paulo node -e 'console.log(new Date("2026-08-07").getDate())'
 *     6
 *
 * Ou seja, a implementação ingênua erra a data de **toda** transação da tela, e
 * erra de um jeito plausível: o número existe, só está errado. Estes testes
 * fixam o parse manual.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatShortDate } from "./date.ts";

test("formata a data ISO como dd/MM", () => {
  assert.equal(formatShortDate("2026-08-07"), "07/08");
});

test("preserva o dia em fuso negativo — a armadilha do new Date(ISO)", () => {
  /*
   * O teste roda no TZ do ambiente, mas o parse não pode depender dele: a
   * implementação correta nunca constrói um `Date` a partir da string ISO.
   */
  const original = process.env.TZ;
  try {
    process.env.TZ = "America/Sao_Paulo";
    assert.equal(formatShortDate("2026-08-07"), "07/08");
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14, o outro extremo
    assert.equal(formatShortDate("2026-08-07"), "07/08");
  } finally {
    process.env.TZ = original;
  }
});

test("preenche dia e mês com zero à esquerda", () => {
  assert.equal(formatShortDate("2026-01-05"), "05/01");
});

test("aceita o primeiro e o último dia do ano", () => {
  assert.equal(formatShortDate("2026-01-01"), "01/01");
  assert.equal(formatShortDate("2026-12-31"), "31/12");
});

test("rejeita entrada que não é uma data ISO", () => {
  // Mesma postura de `parseMoney`: falha visível em vez de "NaN/NaN" na tela.
  assert.throws(() => formatShortDate("07/08/2026"), /data inválida/i);
  assert.throws(() => formatShortDate(""), /data inválida/i);
  assert.throws(() => formatShortDate(null as unknown as string), /data inválida/i);
});
