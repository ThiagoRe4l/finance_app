/**
 * Filtro de período — funções puras (`docs/periodos.md`, PER-1 a PER-7; fatia 2).
 *
 * Escrito **antes** da implementação (13/11/2026). Hoje fica vermelho porque
 * `lib/period.ts` não existe (`ERR_MODULE_NOT_FOUND`).
 *
 * Relógio: nada aqui lê a hora; o "agora" entra por parâmetro, como em `date.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  currentMonthKey,
  parsePeriodParam,
  gridYear,
  monthGrid,
  periodEyebrow,
  periodLabel,
  periodQuery,
  periodHasData,
  periodShortcuts,
  periodSearch,
  periodTriggerLabel,
  shiftPeriod,
  type PeriodRange,
} from "./period.ts";

const RANGE: PeriodRange = {
  min_month: "2026-03",
  max_month: "2027-11",
  current_month: "2026-11",
};

// --- parsePeriodParam: o que a URL pode trazer -----------------------------

test("parsePeriodParam aceita mês, ano, 6m e all", () => {
  assert.equal(parsePeriodParam("2026-12"), "2026-12");
  assert.equal(parsePeriodParam("2026"), "2026");
  assert.equal(parsePeriodParam("3m"), "3m");
  assert.equal(parsePeriodParam("6m"), "6m");
  assert.equal(parsePeriodParam("12m"), "12m");
  assert.equal(parsePeriodParam("all"), "all");
});

test("parsePeriodParam descarta o que o backend recusaria (volta ao padrão)", () => {
  const bad = [
    "2026-13",
    "2026-00",
    "banana",
    "26-11",
    "2026-1",
    "",
    "2026-11-01",
    "5m",
    "13m",
    "6M",
    "1899-05",
    "2201",
    2026,
    null,
    undefined,
    {},
  ];
  for (const value of bad) {
    assert.equal(
      parsePeriodParam(value),
      undefined,
      `deveria descartar ${JSON.stringify(value)}`,
    );
  }
});

// --- currentMonthKey ---------------------------------------------------------

test("currentMonthKey usa o mês local, com zero à esquerda", () => {
  assert.equal(currentMonthKey(new Date(2026, 10, 13)), "2026-11");
  assert.equal(currentMonthKey(new Date(2027, 0, 1)), "2027-01");
  assert.equal(currentMonthKey(new Date(2026, 11, 31, 23, 59)), "2026-12");
});

// --- shiftPeriod: setas ‹ › --------------------------------------------------

test("shiftPeriod anda um mês, atravessando o ano", () => {
  assert.equal(shiftPeriod("2026-11", 1, RANGE), "2026-12");
  assert.equal(shiftPeriod("2026-12", 1, RANGE), "2027-01");
  assert.equal(shiftPeriod("2027-01", -1, RANGE), "2026-12");
});

test("shiftPeriod para nos limites do range (null = seta desligada)", () => {
  assert.equal(shiftPeriod("2026-03", -1, RANGE), null);
  assert.equal(shiftPeriod("2027-11", 1, RANGE), null);
  assert.equal(shiftPeriod("2026-03", 1, RANGE), "2026-04");
});

test("shiftPeriod em ano anda um ano, dentro dos anos do range", () => {
  assert.equal(shiftPeriod("2026", 1, RANGE), "2027");
  assert.equal(shiftPeriod("2027", 1, RANGE), null);
  assert.equal(shiftPeriod("2026", -1, RANGE), null);
});

test("shiftPeriod não anda nas janelas (3m, 6m, 12m) nem em all", () => {
  assert.equal(shiftPeriod("3m", 1, RANGE), null);
  assert.equal(shiftPeriod("6m", 1, RANGE), null);
  assert.equal(shiftPeriod("12m", -1, RANGE), null);
  assert.equal(shiftPeriod("all", -1, RANGE), null);
});

// --- rótulos -----------------------------------------------------------------

test("periodLabel", () => {
  assert.equal(periodLabel("2026-11"), "Novembro de 2026");
  assert.equal(periodLabel("2027-03"), "Março de 2027");
  assert.equal(periodLabel("2026"), "Ano de 2026");
  assert.equal(periodLabel("3m"), "Últimos 3 meses");
  assert.equal(periodLabel("6m"), "Últimos 6 meses");
  assert.equal(periodLabel("12m"), "Últimos 12 meses");
  assert.equal(periodLabel("all"), "Todos os meses");
});

test("periodEyebrow: mês corrente, outro mês e projeção", () => {
  assert.equal(periodEyebrow(undefined, "2026-11", false), "Mês corrente");
  assert.equal(periodEyebrow("2026-11", "2026-11", false), "Mês corrente");
  assert.equal(periodEyebrow("2026-09", "2026-11", false), "Setembro de 2026");
  assert.equal(
    periodEyebrow("2026-12", "2026-11", true),
    "Dezembro de 2026 · Projeção",
  );
  assert.equal(periodEyebrow("6m", "2026-11", false), "Últimos 6 meses");
});

// --- botão e grade de meses --------------------------------------------------

test("periodTriggerLabel: Mmm/AA no botão; janelas por extenso", () => {
  assert.equal(periodTriggerLabel("2026-11"), "Nov/26");
  assert.equal(periodTriggerLabel("2027-01"), "Jan/27");
  assert.equal(periodTriggerLabel("2026"), "2026");
  assert.equal(periodTriggerLabel("3m"), "Últimos 3 meses");
  assert.equal(periodTriggerLabel("12m"), "Últimos 12 meses");
  assert.equal(periodTriggerLabel("all"), "Todos os meses");
});

test("monthGrid: 12 meses do ano, desligando os fora do range", () => {
  const grid = monthGrid(2026, RANGE); // range 2026-03 .. 2027-11
  assert.equal(grid.length, 12);
  assert.deepEqual(
    grid.map((m) => m.label),
    [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ],
  );
  assert.equal(grid[0].key, "2026-01");
  assert.equal(grid[0].disabled, true); // antes do min
  assert.equal(grid[1].disabled, true);
  assert.equal(grid[2].disabled, false); // 2026-03 é o min
  assert.equal(grid[11].disabled, false);
});

test("monthGrid do último ano desliga o que passa do max", () => {
  const grid = monthGrid(2027, RANGE);
  assert.equal(grid[10].key, "2027-11");
  assert.equal(grid[10].disabled, false);
  assert.equal(grid[11].disabled, true); // 2027-12 passa do max
});

test("gridYear: o ano do mês ou do ano escolhido; nas janelas, o do mês corrente", () => {
  assert.equal(gridYear("2027-03", "2026-11"), 2027);
  assert.equal(gridYear("2025", "2026-11"), 2025);
  assert.equal(gridYear("6m", "2026-11"), 2026);
  assert.equal(gridYear("all", "2026-11"), 2026);
});

// --- URL e API ---------------------------------------------------------------

test("periodSearch: o mês atual deixa a URL limpa", () => {
  assert.equal(periodSearch("2026-11", "2026-11"), undefined);
  assert.equal(periodSearch("2026-12", "2026-11"), "2026-12");
  assert.equal(periodSearch("all", "2026-11"), "all");
});

test("periodQuery: sem período não manda parâmetro; com período, manda", () => {
  assert.equal(periodQuery(undefined), "");
  assert.equal(periodQuery("2026-12"), "?period=2026-12");
  assert.equal(periodQuery("6m"), "?period=6m");
});

test("periodShortcuts: 3M, 6M, 1A e Tudo (valores únicos)", () => {
  const shortcuts = periodShortcuts();
  assert.deepEqual(
    shortcuts.map((x) => x.value),
    ["3m", "6m", "12m", "all"],
  );
  assert.deepEqual(
    shortcuts.map((x) => x.label),
    ["3M", "6M", "1A", "Tudo"],
  );
});

test("periodHasData: só dinheiro movimentado ou lançamento conta como dado", () => {
  const zero = { revenues: "0.00", expenses: "0.00", itemCount: 0 };
  assert.equal(periodHasData(zero), false);
  assert.equal(periodHasData({ ...zero, revenues: "10.00" }), true);
  assert.equal(periodHasData({ ...zero, expenses: "49.90" }), true);
  assert.equal(periodHasData({ ...zero, itemCount: 1 }), true);
});
