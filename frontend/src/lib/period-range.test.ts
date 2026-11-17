/**
 * Intervalo entre meses no filtro de período (`docs/periodos.md`, PER-9):
 * `AAAA-MM..AAAA-MM`, extremos incluídos. Escrito antes da implementação.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as period from "./period.ts";

test("parsePeriodParam aceita um intervalo válido", () => {
  assert.equal(period.parsePeriodParam("2026-03..2026-08"), "2026-03..2026-08");
  assert.equal(period.parsePeriodParam("2025-11..2026-02"), "2025-11..2026-02");
  assert.equal(period.parsePeriodParam("2026-03..2026-03"), "2026-03..2026-03");
});

test("parsePeriodParam descarta intervalo que o backend recusaria", () => {
  for (const bad of [
    "2026-08..2026-03",
    "2026-03..",
    "..2026-03",
    "2026-03..2026-13",
    "2026..2027",
    "2000-01..2026-11",
  ]) {
    assert.equal(period.parsePeriodParam(bad), undefined, bad);
  }
});

test("rangeKey ordena os extremos", () => {
  assert.equal(period.rangeKey("2026-08", "2026-03"), "2026-03..2026-08");
  assert.equal(period.rangeKey("2026-03", "2026-08"), "2026-03..2026-08");
});

test("rangeBounds lê os extremos (e é null fora de intervalo)", () => {
  assert.deepEqual(period.rangeBounds("2026-03..2026-08"), [
    "2026-03",
    "2026-08",
  ]);
  assert.equal(period.rangeBounds("2026-03"), null);
  assert.equal(period.rangeBounds("6m"), null);
});

test("rótulo por extenso: mesmo ano e anos diferentes", () => {
  assert.equal(
    period.periodLabel("2026-03..2026-08"),
    "Março a Agosto de 2026",
  );
  assert.equal(
    period.periodLabel("2025-11..2026-02"),
    "Novembro de 2025 a Fevereiro de 2026",
  );
});

test("rótulo do botão: curto, com travessão", () => {
  assert.equal(
    period.periodTriggerLabel("2026-03..2026-08"),
    "Mar/26 – Ago/26",
  );
});

test("a grade abre no ano em que o intervalo começa", () => {
  assert.equal(period.gridYear("2025-11..2026-02", "2026-11"), 2025);
});
