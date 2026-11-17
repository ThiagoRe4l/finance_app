/**
 * Ligação dos tooltips nos gráficos (`docs/periodos.md`, fatia 3).
 *
 * Escrito **antes** da implementação (13/11/2026). Teste sobre arquivo: prova que
 * os dois gráficos de meses usam `MonthColumn` e que o Dashboard passa o período
 * à distribuição de gastos. O comportamento do tooltip é do teste de componente.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const CASHFLOW = "../components/dashboard/CashFlow.tsx";
const DASHBOARD = "../routes/index.tsx";
const COLUMN = "../components/shared/MonthColumn.tsx";

test("MonthColumn é botão (foco e toque) e abre em portal (o scroller não corta)", () => {
  const src = read(COLUMN);
  assert.match(src, /<button\b/);
  assert.match(src, /type="button"/);
  assert.match(src, /PopoverContent/);
});

test("Fluxo Mensal e Comparativo usam MonthColumn, uma por mês", () => {
  assert.match(read(CASHFLOW), /<MonthColumn\b/);
});

test("as colunas não são mais div solta com a altura da trilha", () => {
  // A chave agora é o `month_key`, único mesmo com vários anos (`all`).
  assert.match(read(CASHFLOW), /key=\{[^}]*month_key/);
});

test("o Dashboard passa o período à distribuição de gastos", () => {
  const src = read(DASHBOARD);
  const at = src.indexOf("<CategoryBars");
  assert.ok(at >= 0, "sem <CategoryBars>");
  const tag = src.slice(at, src.indexOf("/>", at));
  assert.match(tag, /periodLabel=/);
});
