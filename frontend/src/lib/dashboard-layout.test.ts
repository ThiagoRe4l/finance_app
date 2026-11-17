/**
 * Estrutura do Dashboard e dos cards, conforme a proposta de design
 * (`docs/tema.md`, D-Tema-7 e D-Tema-8). Escrito **antes** da implementação.
 *
 * Teste sobre arquivo: ordem das linhas, quem divide cada linha e o cabeçalho
 * único de cartão. A aparência (cor, espaçamento) fica com a conferência visual.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fn, tagAt, classesIn } from "./jsx-source.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const DASHBOARD = "../routes/index.tsx";
const summary = () => fn(read(DASHBOARD), "Summary");

// ── Indicadores ──────────────────────────────────────────────────────────

// Q1 (docs/ux-leis.md): "Economia" virou o cartão-herói (SavingsHero) e os
// três indicadores restantes ficam em segundo plano.
test("os três indicadores secundários, na ordem e com os nomes da proposta", () => {
  const labels = [
    ...summary().matchAll(/<MetricCard\b[^>]*?label="([^"]+)"/gs),
  ].map((m) => m[1]);
  assert.deepEqual(labels, ["Entradas", "Saídas", "Saldo atual"]);
});

test("o aviso de projeção fala em saídas, não em despesas", () => {
  assert.match(summary(), /As saídas incluem/);
  assert.doesNotMatch(summary(), /As despesas incluem/);
});

// ── Linhas ───────────────────────────────────────────────────────────────

/** A ordem em que os componentes aparecem no `Summary`. */
function order(): string[] {
  const src = summary();
  return [
    "<MetricCard",
    "<CashFlow",
    "<RecurringCard",
    "<CategoryBars",
    "<Transactions",
  ]
    .map((tag) => [tag, src.indexOf(tag)] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([tag, at]) => {
      assert.ok(at >= 0, `sem ${tag} no Summary`);
      return tag;
    });
}

test("ordem: indicadores → Fluxo → Recorrências → Distribuição → Movimentações", () => {
  assert.deepEqual(order(), [
    "<MetricCard",
    "<CashFlow",
    "<RecurringCard",
    "<CategoryBars",
    "<Transactions",
  ]);
});

/** A tag `<section …>` que contém o componente. */
function sectionOf(src: string, tag: string) {
  const at = src.indexOf(tag);
  assert.ok(at >= 0, `sem ${tag}`);
  return tagAt(src, src.lastIndexOf("<section", at));
}

/** A tag `<div …>` que envolve o componente. */
function wrapperOf(src: string, tag: string) {
  const at = src.indexOf(tag);
  assert.ok(at >= 0, `sem ${tag}`);
  return tagAt(src, src.lastIndexOf("<div", at));
}

test("linha 2: Fluxo (2/3) e Recorrências (1/3), em lg:grid-cols-3", () => {
  const src = summary();
  const section = sectionOf(src, "<CashFlow");
  assert.ok(classesIn(section).includes("lg:grid-cols-3"), section);
  assert.equal(section, sectionOf(src, "<RecurringCard"));
  const wrap = wrapperOf(src, "<CashFlow");
  assert.ok(classesIn(wrap).includes("lg:col-span-2"), wrap);
});

test("linha 3: Distribuição (5/12) e Movimentações (7/12), em lg:grid-cols-12", () => {
  const src = summary();
  const section = sectionOf(src, "<CategoryBars");
  assert.ok(classesIn(section).includes("lg:grid-cols-12"), section);
  assert.equal(section, sectionOf(src, "<Transactions"));
  assert.ok(
    classesIn(wrapperOf(src, "<CategoryBars")).includes("lg:col-span-5"),
  );
  assert.ok(
    classesIn(wrapperOf(src, "<Transactions")).includes("lg:col-span-7"),
  );
});

// ── Recorrências em componente próprio ───────────────────────────────────

test("RecurringCard: parcelamentos, assinaturas e o comprometido do mês em destaque", () => {
  const src = read("../components/dashboard/RecurringCard.tsx");
  assert.match(src, /export function RecurringCard\b/);
  assert.match(src, /<PanelTitle/);
  for (const word of ["Parcelamentos", "Assinaturas", "Comprometido"]) {
    assert.ok(src.includes(word), `sem ${word}`);
  }
  // O destaque laranja: texto escuro sobre laranja suave, nunca laranja puro.
  assert.match(src, /bg-expense\/20/);
  assert.match(src, /text-expense-text/);
  // Dinheiro não quebra nem é cortado (M-13) e vem pronto do backend.
  assert.match(src, /whitespace-nowrap/);
  assert.doesNotMatch(src, /parseMoney|\+\s*Number/);
});

test("o Dashboard não escreve mais o cartão de Recorrências à mão", () => {
  assert.doesNotMatch(read(DASHBOARD), /<h2[^>]*>Recorrências<\/h2>/);
});

// ── Cabeçalho único de cartão ────────────────────────────────────────────

test("PanelTitle: título 15 px semibold e subtítulo 13 px de apoio", () => {
  const src = read("../components/dashboard/PanelTitle.tsx");
  assert.match(src, /export function PanelTitle\b/);
  const h2 = tagAt(src, src.indexOf("<h2"));
  assert.ok(classesIn(h2).includes("text-[15px]"), h2);
  assert.ok(classesIn(h2).includes("font-semibold"), h2);
  const p = tagAt(src, src.indexOf("<p"));
  assert.ok(classesIn(p).includes("text-[13px]"), p);
  assert.ok(classesIn(p).includes("text-muted-foreground"), p);
});

const CARDS = [
  "../components/dashboard/CashFlow.tsx",
  "../components/dashboard/CategoryBars.tsx",
  "../components/dashboard/Transactions.tsx",
  "../components/dashboard/RecurringCard.tsx",
];

for (const file of CARDS) {
  test(`${file.split("/").pop()}: usa PanelTitle e padding p-6`, () => {
    const src = read(file);
    assert.match(
      src,
      /import \{ PanelTitle \} from "@\/components\/dashboard\/PanelTitle";/,
    );
    assert.match(src, /<PanelTitle\b/);
    assert.match(src, /<section className="[^"]*\bp-6\b/);
    assert.doesNotMatch(src, /<section className="[^"]*\bp-8\b/);
    // O título antigo, escrito à mão em cada cartão, não volta.
    assert.doesNotMatch(src, /<h2 className="text-sm font-medium"/);
  });
}

test("Movimentações: Entradas e Saídas lado a lado a partir de md, uma coluna no celular", () => {
  const src = read("../components/dashboard/Transactions.tsx");
  const grids = [...src.matchAll(/<div className="([^"]*grid[^"]*)"/g)].map(
    (m) => m[1],
  );
  assert.ok(
    grids.some(
      (c) => /\bgrid-cols-1\b/.test(c) && /\bmd:grid-cols-2\b/.test(c),
    ),
    `sem grid-cols-1 md:grid-cols-2: ${grids.join(" | ")}`,
  );
  assert.match(src, /title="Últimas movimentações"/);
});

test("títulos novos: Entradas e saídas, Distribuição de gastos", () => {
  assert.match(read(CARDS[0]), /title="Entradas e saídas"/);
  assert.match(read(CARDS[1]), /title="Distribuição de gastos"/);
});
