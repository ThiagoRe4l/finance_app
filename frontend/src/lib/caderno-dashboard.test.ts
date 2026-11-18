/**
 * Caderno, fatia C2 — Visão Geral (`docs/tema.md`, D-Cad-6).
 *
 * Escrito **antes** da implementação (aprovação delegada pelo usuário em
 * 18/11/2026). Teste sobre arquivo, como o resto do Dashboard: trava a
 * estrutura e as classes; a aparência fica com a conferência visual.
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
const LEADER = "../components/shared/Leader.tsx";
const METRIC_CARD = "../components/dashboard/MetricCard.tsx";
const HERO = "../components/dashboard/SavingsHero.tsx";
const PANEL_TITLE = "../components/dashboard/PanelTitle.tsx";
const RECURRING = "../components/dashboard/RecurringCard.tsx";

const CLIPPING = [
  "truncate",
  "overflow-hidden",
  "text-ellipsis",
  "line-clamp-1",
];

/** A tag de abertura mais próxima antes de `index`. */
function openingBefore(src: string, index: number, tag: string): string {
  return tagAt(src, src.lastIndexOf(`<${tag}`, index));
}

// ── Pontilhado ───────────────────────────────────────────────────────────

test("Leader: pontilhado decorativo, escondido do leitor de tela", () => {
  const src = read(LEADER);
  assert.match(src, /export function Leader\b/);
  assert.match(src, /aria-hidden="true"/);
  const span = openingBefore(src, src.indexOf('aria-hidden="true"'), "span");
  for (const t of ["flex-1", "border-b", "border-dotted"]) {
    assert.ok(classesIn(span).includes(t), `${t} fora de ${span}`);
  }
});

// ── MetricCard em linha de extrato ───────────────────────────────────────

test("MetricCard: variante ledger, e o cartão continua o padrão", () => {
  const src = read(METRIC_CARD);
  assert.match(src, /variant\?: "card" \| "ledger"/);
  assert.match(src, /variant = "card"/);
  assert.match(src, /<Leader \/>/);
  // O cartão vem primeiro no arquivo: os testes da M-13 leem o primeiro {value}.
  const first = src.indexOf("{value}");
  const last = src.lastIndexOf("{value}");
  assert.ok(
    first >= 0 && last > first,
    "o valor precisa aparecer nas duas variantes",
  );
  assert.ok(
    src.indexOf("bg-card p-6") < first,
    "a variante card deixou de vir primeiro",
  );
});

test("MetricCard ledger: o valor em Fraunces, numa linha só, sem corte", () => {
  const src = read(METRIC_CARD);
  const value = openingBefore(src, src.lastIndexOf("{value}"), "span");
  for (const t of [
    "font-display",
    "tabular-nums",
    "whitespace-nowrap",
    "shrink-0",
  ]) {
    assert.ok(classesIn(value).includes(t), `${t} fora de ${value}`);
  }
  for (const t of CLIPPING) {
    assert.ok(!classesIn(value).includes(t), `${t} corta o valor: ${value}`);
  }
  assert.match(
    value,
    /toneClasses\[tone\]/,
    "a cor do valor continua vindo do tone",
  );
});

test("MetricCard ledger: sem espaço (320 px), o valor desce inteiro para a linha de baixo", () => {
  // Achado na revisão final do Caderno: "Saldo atual" + R$ 24.318,40 em
  // text-xl passa dos ~224 px do painel a 320 e transbordaria o documento (M-11).
  const src = read(METRIC_CARD);
  const row = openingBefore(src, src.indexOf("<Leader"), "div");
  assert.ok(classesIn(row).includes("flex-wrap"), row);
  const value = openingBefore(src, src.lastIndexOf("{value}"), "span");
  assert.ok(classesIn(value).includes("ml-auto"), value);
});

test("MetricCard ledger: a seta continua vindo do trend, separada do tone", () => {
  const src = read(METRIC_CARD);
  const ledger = src.slice(src.indexOf("<Leader"));
  assert.match(ledger, /<TrendIcon trend=\{trend\} \/>/);
});

// ── Dashboard ────────────────────────────────────────────────────────────

const summary = () => fn(read(DASHBOARD), "Summary");

test("Summary: os três indicadores são linhas de extrato dentro do SavingsHero", () => {
  const src = summary();
  const open = src.indexOf("<SavingsHero");
  const close = src.indexOf("</SavingsHero>");
  assert.ok(open >= 0 && close > open, "SavingsHero sem children");
  const inside = src.slice(open, close);
  const cards = [...inside.matchAll(/<MetricCard\b/g)];
  assert.equal(cards.length, 3, `${cards.length} <MetricCard> dentro do herói`);
  for (const m of cards) {
    assert.match(tagAt(inside, m.index ?? 0), /variant="ledger"/);
  }
  assert.equal(
    [...src.matchAll(/<MetricCard\b/g)].length,
    3,
    "sobrou <MetricCard> fora do herói",
  );
});

for (const name of ["Summary", "LoadingState"]) {
  test(`${name}: a grade de cartões de métrica saiu`, () => {
    const src = fn(read(DASHBOARD), name);
    assert.doesNotMatch(src, /sm:grid-cols-2 xl:grid-cols-3/);
  });
}

test("SavingsHero: recebe as linhas como children, num painel à direita a partir de md", () => {
  const src = read(HERO);
  assert.match(src, /children\??: React\.ReactNode|children\??: ReactNode/);
  assert.match(src, /\{children\}/);
  assert.match(src, /md:flex-row/);
});

// ── Cabeçalho dos cartões e Recorrências ─────────────────────────────────

test("PanelTitle: título em Fraunces, text-xl font-medium; subtítulo de 13 px", () => {
  const src = read(PANEL_TITLE);
  const h2 = tagAt(src, src.indexOf("<h2"));
  for (const t of ["font-display", "text-xl", "font-medium"]) {
    assert.ok(classesIn(h2).includes(t), `${t} fora de ${h2}`);
  }
  const p = tagAt(src, src.indexOf("<p"));
  assert.ok(classesIn(p).includes("text-[13px]"), p);
});

test("RecurringCard: linhas de extrato e o comprometido num bloco ardósia", () => {
  const src = read(RECURRING);
  assert.match(src, /<Leader \/>/);
  assert.match(src, /bg-primary/);
  assert.match(src, /text-primary-foreground/);
  assert.doesNotMatch(src, /bg-expense\/20/);
});
