/**
 * Relatórios unificado ao Dashboard (U-1, `docs/integracao-frontend.md`).
 *
 * Escrito **antes** da implementação. Os dados de Relatórios já estão no
 * Dashboard: receitas e despesas (cartões), comparativo mensal (Fluxo Mensal),
 * maiores categorias (Distribuição de gastos) e o insight de parcelamentos
 * (cartão Recorrências). A tela sai; a rota antiga só redireciona.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS } from "./navigation.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");

test("a navegação não tem mais Relatórios", () => {
  assert.equal(NAV_ITEMS.length, 4);
  assert.ok(!NAV_ITEMS.some((i) => String(i.to) === "/relatorios"));
  assert.doesNotMatch(read("./navigation.ts"), /relatorios/i);
  assert.doesNotMatch(read("../components/layout/nav-icons.ts"), /relatorios/i);
});

test("/relatorios só redireciona para o Dashboard, levando o período", () => {
  const src = read("../routes/relatorios.tsx");
  assert.match(src, /redirect\(/);
  assert.match(src, /to: "\/"/);
  assert.match(src, /periodo/);
  // Nada da tela antiga sobrou na rota.
  for (const gone of [
    "AppShell",
    "useQuery",
    "MonthlyComparison",
    "TopCategories",
    "Insights",
    "buildReportInsights",
  ]) {
    assert.ok(!src.includes(gone), `relatorios.tsx ainda tem ${gone}`);
  }
});

test("o helper de insights, sem uso, saiu", () => {
  assert.ok(!existsSync(path("./reports.ts")));
  assert.ok(!existsSync(path("./reports.test.ts")));
});

test("✅ o Dashboard segue com o que Relatórios mostrava", () => {
  // Regressão: já passa hoje — é o motivo de a tela poder sair.
  const src = read("../routes/index.tsx");
  for (const piece of [
    "<CashFlow",
    "<CategoryBars",
    'label="Entradas"',
    'label="Saídas"',
    "monthly_recurring_amount",
  ]) {
    assert.ok(src.includes(piece), `Dashboard sem ${piece}`);
  }
});
