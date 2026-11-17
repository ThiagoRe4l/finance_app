/**
 * Contrato do filtro de período nas telas (`docs/periodos.md`; fatia 2).
 *
 * Escrito **antes** da implementação (13/11/2026). Teste sobre arquivo, como
 * `month-scroller.test.ts`: o runner não renderiza componente, então isto prova
 * as ligações e as classes, não a tela. A conferência visual fica com o usuário.
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

const FILTER = "../components/shared/PeriodFilter.tsx";
const DASHBOARD = "../routes/index.tsx";
const CASHFLOW = "../components/dashboard/CashFlow.tsx";

test("PeriodFilter: botão com o mês, grade de meses e navegação de ano", () => {
  const src = read(FILTER);
  assert.match(src, /\/periods\/range/);
  assert.match(src, /queryKey: \["periods", "range"\]/);
  assert.match(src, /<Popover/);
  assert.match(src, /monthGrid\(/);
  assert.match(src, /periodTriggerLabel\(/);
  assert.match(src, /shiftPeriod\(/);
  assert.match(src, /aria-label="Ano anterior"/);
  assert.match(src, /aria-label="Próximo ano"/);
  assert.match(src, /<ChevronDown/);
});

test("PeriodFilter: atalhos 3M / 6M / 1A como botões com aria-pressed", () => {
  const src = read(FILTER);
  assert.match(src, /periodShortcuts\(/);
  assert.match(src, /aria-pressed=/);
  assert.match(src, /role="group"/);
});

test("PeriodFilter: alvos de 44 px no celular (P4 do contrato mobile)", () => {
  const src = read(FILTER);
  // gatilho, chips, setas de ano e células da grade têm `h-11` base.
  assert.match(src, /const TRIGGER =\s*"[^"]*h-11/);
  assert.match(src, /const CHIP =\s*"[^"]*h-11/);
  assert.match(src, /const CELL =\s*"[^"]*h-11/);
  assert.match(src, /const YEAR_ARROW =\s*"[^"]*h-11/);
});

for (const [name, file] of [["Dashboard", DASHBOARD]] as const) {
  test(`${name}: período na URL, no queryKey e na chamada da API`, () => {
    const src = read(file);
    assert.match(src, /validateSearch/);
    assert.match(src, /parsePeriodParam\(/);
    assert.match(src, /<PeriodFilter/);
    assert.match(src, /periodQuery\(/);
    assert.match(src, /queryKey: \[[^\]]*periodo[^\]]*\]/);
  });
}

test("Dashboard não fixa mais o rótulo do período", () => {
  assert.doesNotMatch(read(DASHBOARD), /eyebrow="Mês corrente"/);
  assert.match(read(DASHBOARD), /periodEyebrow\(/);
});

test("os tipos do front espelham os campos novos do backend", () => {
  const dash = read(DASHBOARD);
  assert.match(dash, /is_projection: boolean/);
  assert.match(dash, /projected_expenses: string/);
  assert.match(read(CASHFLOW), /month_key: string/);
});

test("a tela avisa quando há valor projetado (não some em silêncio)", () => {
  assert.match(read(DASHBOARD), /projected_expenses/);
  assert.match(read(DASHBOARD), /previst/i);
});

test("Dashboard mostra a mensagem de período sem dados", () => {
  for (const file of [DASHBOARD]) {
    const src = read(file);
    assert.match(src, /periodHasData\(/);
    assert.match(src, /<EmptyPeriod/);
  }
  assert.match(read("../components/shared/EmptyPeriod.tsx"), /Sem dados/);
});
