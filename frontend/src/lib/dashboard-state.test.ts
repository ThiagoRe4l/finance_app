/**
 * Dois defeitos do Dashboard registrados em `docs/backlog.md`:
 *
 * * **E — cor do valor com percentual `null`.** `(pct ?? 0) < 0` trata
 *   "sem percentual" como 0 e pinta o valor de verde, sem seta nem número que
 *   o justifique. Agora a escolha do tom é `toneFromDelta`, função pura, e
 *   `null` dá `"neutral"`.
 * * **F — `refetch` que falha esconde o Dashboard já carregado.** O TanStack
 *   mantém `data` e liga `isError`; a rota testava `isError` primeiro. Agora a
 *   decisão é `dashboardView`, e com dado em memória o resumo continua na tela,
 *   com o aviso em cima.
 *
 * Escrito **antes** da implementação (11/11/2026). A aprovação dos testes foi
 * delegada pelo usuário nesta data ("siga implementando todas as fases").
 *
 * A ligação no JSX é verificada sobre o arquivo, como nas fatias mobile: é ali
 * que o bug da seta nasceu, e componente React não tem teste neste runner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dashboardView, toneFromDelta } from "./dashboard.ts";

// --- E: toneFromDelta ------------------------------------------------------

test("E: sem percentual o tom é neutro, nas duas polaridades", () => {
  for (const pct of [null, undefined, Number.NaN, Infinity]) {
    assert.equal(toneFromDelta(pct, "higher-is-better"), "neutral");
    assert.equal(toneFromDelta(pct, "lower-is-better"), "neutral");
  }
});

test("E: saldo e economia — subir é bom", () => {
  assert.equal(toneFromDelta(12.5, "higher-is-better"), "positive");
  assert.equal(toneFromDelta(-3, "higher-is-better"), "negative");
});

test("E: despesas — subir é ruim (polaridade invertida)", () => {
  assert.equal(toneFromDelta(325.8, "lower-is-better"), "negative");
  assert.equal(toneFromDelta(-7.1, "lower-is-better"), "positive");
});

test("E: zero mantém o comportamento anterior (positivo), só null mudou", () => {
  assert.equal(toneFromDelta(0, "higher-is-better"), "positive");
  assert.equal(toneFromDelta(0, "lower-is-better"), "positive");
  assert.equal(toneFromDelta(-0, "higher-is-better"), "positive");
});

// --- F: dashboardView ------------------------------------------------------

test("F: primeiro carregamento sem dado mostra o esqueleto", () => {
  assert.equal(dashboardView({ hasData: false, isError: false }), "loading");
});

test("F: erro sem dado em memória mostra só o banner", () => {
  assert.equal(dashboardView({ hasData: false, isError: true }), "error");
});

test("F: dado carregado mostra o resumo", () => {
  assert.equal(dashboardView({ hasData: true, isError: false }), "summary");
});

test("F: refetch que falha com dado em memória mantém o resumo, com aviso", () => {
  assert.equal(
    dashboardView({ hasData: true, isError: true }),
    "stale-summary",
  );
});

// --- Ligação no JSX (teste sobre arquivo) ----------------------------------

const index = readFileSync(
  fileURLToPath(new URL("../routes/index.tsx", import.meta.url)),
  "utf8",
);

test("E: nenhum tom do Dashboard trata null como 0", () => {
  assert.doesNotMatch(index, /tone=\{\s*\(data\.\w+ \?\? 0\)/);
});

test("E: os três cards com percentual usam toneFromDelta com a polaridade certa", () => {
  for (const [field, polarity] of [
    ["balance_change_pct", "higher-is-better"],
    ["expenses_change_pct", "lower-is-better"],
    ["savings_pct_of_revenue", "higher-is-better"],
  ]) {
    const re = new RegExp(
      `tone=\\{\\s*toneFromDelta\\(\\s*data\\.${field},\\s*"${polarity}",?\\s*\\)\\s*\\}`,
    );
    assert.match(index, re, `${field} sem toneFromDelta(..., "${polarity}")`);
  }
});

test("F: a rota decide o que mostrar por dashboardView, não por isError primeiro", () => {
  assert.match(index, /dashboardView\(/);
  assert.doesNotMatch(index, /\{isError \?/);
});

test("F: no estado stale-summary o resumo é renderizado junto do aviso", () => {
  const at = index.indexOf('"stale-summary"');
  assert.ok(at >= 0, "a rota não trata stale-summary");
  const branch = index.slice(at, at + 600);
  assert.match(branch, /<ErrorBanner/);
  assert.match(branch, /<Summary/);
});
