/**
 * Leis da UX no Dashboard (`docs/ux-leis.md`: Q1, Q2, Q4, Q8).
 *
 * Escrito **antes** da implementação — vermelho de propósito. Import por
 * namespace: cada teste falha sozinho com "não é uma função", em vez de um erro
 * de link derrubar o arquivo inteiro.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as dashboard from "./dashboard.ts";

// --- spendRatio (Q1, Q8): "saiu X de Y que entrou" --------------------------

test("spendRatio: R$ 2.500 de R$ 10.000 é 25", () => {
  assert.equal(dashboard.spendRatio("2500.00", "10000.00"), 25);
});

test("spendRatio: sem saída é 0", () => {
  assert.equal(dashboard.spendRatio("0.00", "10000.00"), 0);
});

test("spendRatio: sem entrada não há proporção (null, não Infinity)", () => {
  assert.equal(dashboard.spendRatio("300.00", "0.00"), null);
});

test("spendRatio: gastar mais do que entrou passa de 100, sem clamp", () => {
  // Mesma postura de `toDistribution`: o número errado tem que aparecer.
  assert.equal(dashboard.spendRatio("15000.00", "10000.00"), 150);
});

test("spendRatio: valor inválido lança, como o resto do money.ts", () => {
  // A mensagem importa: chamar função inexistente também lança TypeError.
  assert.throws(
    () => dashboard.spendRatio("", "10.00"),
    /valor monetário inválido/,
  );
});

// --- topDistribution (Q4): máx. 5 itens no bloco -----------------------------

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Cat ${i + 1}`,
    color: "#000000",
    spent: 1000 - i * 10,
    percent: 10,
  }));
}

test("topDistribution: 7 categorias viram 5 + 2, na mesma ordem", () => {
  const { top, rest } = dashboard.topDistribution(rows(7));
  assert.deepEqual(
    top.map((r: { id: number }) => r.id),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    rest.map((r: { id: number }) => r.id),
    [6, 7],
  );
});

test("topDistribution: 5 ou menos não tem resto", () => {
  assert.equal(dashboard.topDistribution(rows(5)).rest.length, 0);
  assert.equal(dashboard.topDistribution(rows(2)).top.length, 2);
  assert.equal(dashboard.topDistribution([]).top.length, 0);
});

test("topDistribution: o limite é parâmetro e a entrada não é mutada", () => {
  const input = rows(4);
  const { top, rest } = dashboard.topDistribution(input, 3);
  assert.equal(top.length, 3);
  assert.equal(rest.length, 1);
  assert.equal(input.length, 4);
});

// --- Q2: navegação interna sem recarregar a SPA -------------------------------

test("Transactions.tsx não usa <a href> para rota interna", () => {
  const source = readFileSync(
    new URL("../components/dashboard/Transactions.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /<a\s[^>]*href="\/transacoes"/);
  assert.match(source, /<Link\b/);
});
