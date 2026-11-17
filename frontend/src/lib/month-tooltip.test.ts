/**
 * Texto dos tooltips dos gráficos de meses (`docs/periodos.md`, fatia 3).
 *
 * Escrito **antes** da implementação (13/11/2026). Hoje fica vermelho porque
 * `lib/month-tooltip.ts` não existe (`ERR_MODULE_NOT_FOUND`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatBRL } from "./money.ts";
import { monthColumnLabel, monthTooltipTitle } from "./month-tooltip.ts";

const NOV = {
  month: "Nov",
  month_key: "2026-11",
  income: "1000.00",
  outcome: "250.50",
};

test("monthTooltipTitle: o mês por extenso, com o ano", () => {
  assert.equal(monthTooltipTitle("2026-11", "2026-11"), "Novembro de 2026");
  assert.equal(monthTooltipTitle("2026-03", "2026-11"), "Março de 2026");
});

test("monthTooltipTitle: mês depois do corrente é projeção", () => {
  assert.equal(
    monthTooltipTitle("2026-12", "2026-11"),
    "Dezembro de 2026 · Projeção",
  );
  assert.equal(
    monthTooltipTitle("2027-01", "2026-11"),
    "Janeiro de 2027 · Projeção",
  );
});

test("monthTooltipTitle: o ano decide, não só o mês (2026-12 vs 2027-01)", () => {
  assert.equal(monthTooltipTitle("2025-12", "2026-01"), "Dezembro de 2025");
});

test("monthColumnLabel resume o mês para leitor de tela, com o dinheiro formatado", () => {
  assert.equal(
    monthColumnLabel(NOV, "2026-11"),
    `Novembro de 2026: entradas ${formatBRL("1000.00")}, saídas ${formatBRL("250.50")}`,
  );
});

test("monthColumnLabel de projeção diz que é projeção", () => {
  const dec = { ...NOV, month: "Dez", month_key: "2026-12" };
  assert.match(monthColumnLabel(dec, "2026-11"), /Projeção/);
});
