/**
 * Contrato do Dashboard no celular — fatia 3a da reforma mobile-first
 * (`docs/mobile-first.md` → M-13).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md. Teste
 * sobre arquivo, como as fatias anteriores: componente React não tem teste
 * neste container. Largura real do valor e alvos ficam com a conferência no
 * DevTools.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  tagAt,
  elementEnd,
  classesIn,
  assertTokens,
  assertNoTokens,
  fn,
  elements,
  headerActionProblems,
  type Element,
} from "./jsx-source.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const DASHBOARD = "../routes/index.tsx";
const METRIC_CARD = "../components/dashboard/MetricCard.tsx";
const RECENT = "../components/dashboard/Transactions.tsx";

/** Os elementos com `className` que contêm `index`, do mais externo ao mais interno. */
function ancestors(source: string, index: number): Element[] {
  return elements(source)
    .filter((e) => e.start < index && index < e.end)
    .sort((a, b) => a.start - b.start);
}

/** Tokens que cortam o conteúdo: dinheiro nunca é cortado (M-13). */
const CLIPPING = [
  "truncate",
  "overflow-hidden",
  "text-ellipsis",
  "line-clamp-1",
  "line-clamp-2",
];

// ── Cartões de métrica ───────────────────────────────────────────────────

/**
 * A grade dos cartões, por extenso: coluna única abaixo de `sm`, duas até
 * 1535 px e quatro só a partir de `2xl` (M-15, 12/11/2026: medido, o valor
 * vazava do cartão em 4 colunas até ~1390 px). O espaçamento é o de antes.
 */
const METRIC_GRID =
  "grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4 md:gap-6 mb-8".split(
    " ",
  );

for (const name of ["Summary", "LoadingState"]) {
  test(`${name}: grade dos cartões em coluna única abaixo de sm, 4 colunas só em 2xl`, () => {
    const src = fn(read(DASHBOARD), name);
    const grid = tagAt(src, src.indexOf("<section"));
    assert.deepEqual(classesIn(grid), METRIC_GRID);
  });
}

test("MetricCard: o valor não quebra e não é cortado", () => {
  const src = read(METRIC_CARD);
  const at = src.indexOf("{value}");
  assert.ok(at >= 0, "sem {value}");
  const chain = ancestors(src, at);
  const value = chain[chain.length - 1];
  assertTokens(value.tag, [
    "text-2xl",
    "font-semibold",
    "tabular-nums",
    "whitespace-nowrap",
  ]);
  // Nem o valor nem o cartão em volta cortam o número.
  for (const e of chain) assertNoTokens(e.tag, CLIPPING);
});

test("✅ MetricCard: o cartão mantém o p-6 e as classes de hoje", () => {
  // Regressão: já passa hoje. A M-13 mantém 24 px e `p-6`.
  const src = read(METRIC_CARD);
  const card = tagAt(src, src.indexOf("<div"));
  assert.deepEqual(
    classesIn(card),
    "bg-card p-6 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow".split(
      " ",
    ),
  );
});

test("✅ MetricCard: o valor é um elemento só, com sinal e número juntos", () => {
  // Regressão: já passa hoje. O `formatBRL` devolve sinal e número numa string
  // só; o `<p>` do valor não tem outro filho, e as quatro ligações passam o
  // `formatBRL` direto, sem separar o sinal.
  const src = read(METRIC_CARD);
  const at = src.indexOf("{value}");
  const chain = ancestors(src, at);
  const value = chain[chain.length - 1];
  const inner = src
    .slice(value.start + value.tag.length, value.end)
    .replace(/<\/\w+>$/, "")
    .trim();
  assert.equal(inner, "{value}");

  const dashboard = read(DASHBOARD);
  const cards = [...dashboard.matchAll(/<MetricCard\b/g)].map((m) =>
    tagAt(dashboard, m.index ?? 0),
  );
  assert.equal(cards.length, 4, `${cards.length} <MetricCard>`);
  for (const card of cards) {
    assert.match(card, /value=\{formatBRL\(data\.\w+\)\}/, card);
  }
});

// ── Transações recentes ──────────────────────────────────────────────────

/** A linha de cada transação: o elemento com `key={transaction.id}`. */
function recentRow(src: string): Element {
  const at = src.indexOf("key={transaction.id}");
  assert.ok(at >= 0, "sem a linha com key={transaction.id}");
  const start = src.lastIndexOf("<", at);
  return { start, end: elementEnd(src, start), tag: tagAt(src, start) };
}

test("recentes: a linha tem gap-3 entre nome e valor", () => {
  const row = recentRow(read(RECENT));
  assertTokens(row.tag, ["flex", "items-center", "justify-between", "gap-3"]);
});

/** Os elementos dentro da linha que contêm `text`, do mais externo ao mais interno. */
function chainInRow(src: string, row: Element, text: string): Element[] {
  const at = src.indexOf(text, row.start);
  assert.ok(at >= 0 && at < row.end, `sem ${text} na linha`);
  return ancestors(src, at).filter((e) => e.start > row.start);
}

const LEFT_TEXTS = ["{transaction.title}", "{transaction.category.name}"];

test("recentes: título e categoria truncados", () => {
  const src = read(RECENT);
  const row = recentRow(src);
  for (const text of LEFT_TEXTS) {
    const chain = chainInRow(src, row, text);
    assertTokens(chain[chain.length - 1].tag, ["truncate"]);
  }
});

test("recentes: o contêiner da esquerda tem min-w-0 flex-1", () => {
  // Sem `min-w-0` o item de flex não encolhe abaixo do texto, e o `truncate`
  // não corta nada.
  const src = read(RECENT);
  const row = recentRow(src);
  for (const text of LEFT_TEXTS) {
    const chain = chainInRow(src, row, text);
    assertTokens(chain[0].tag, ["min-w-0", "flex-1"]);
  }
});

test("recentes: o valor não encolhe nem quebra, e não é cortado", () => {
  const src = read(RECENT);
  const row = recentRow(src);
  const at = src.indexOf("formatBRL(amount)", row.start);
  assert.ok(at >= 0 && at < row.end, "sem formatBRL(amount) na linha");
  const chain = ancestors(src, at).filter((e) => e.start > row.start);
  // O filho da linha que leva o valor não encolhe; o valor não quebra.
  assertTokens(chain[0].tag, ["shrink-0"]);
  assert.ok(
    chain.some((e) => classesIn(e.tag).includes("whitespace-nowrap")),
    "valor sem whitespace-nowrap",
  );
  for (const e of chain) assertNoTokens(e.tag, CLIPPING);
});

test('recentes: "Ver todas" continua <a> e tem 44 px abaixo de lg', () => {
  const src = read(RECENT);
  const at = src.search(/>\s*Ver todas\s*</);
  assert.ok(at >= 0, "sem Ver todas");
  const link = tagAt(src, src.lastIndexOf("<", at));
  assert.match(link, /^<a\b/, `não é <a>: ${link}`);
  assert.match(link, /href="\/transacoes"/);
  assertTokens(link, ["inline-flex", "min-h-11", "items-center", "lg:min-h-0"]);
});

// ── Botão flutuante e folga ──────────────────────────────────────────────

test("Dashboard usa o flutuante para abrir o formulário de criação", () => {
  const src = read(DASHBOARD);
  assert.ok(
    src.includes(
      'import { FloatingActionButton } from "@/components/shared/FloatingActionButton";',
    ),
    "sem o import do FloatingActionButton em routes/index.tsx",
  );
  const tags = [...src.matchAll(/<FloatingActionButton\b/g)];
  assert.equal(tags.length, 1, `${tags.length} <FloatingActionButton>`);
  const tag = tagAt(src, tags[0].index ?? 0);
  assert.match(tag, /label="Nova transação"/);
  assert.match(tag, /onClick=\{\(\) => setIsCreating\(true\)\}/);
});

test('"Nova transação" do cabeçalho só a partir de lg', () => {
  const src = fn(read(DASHBOARD), "Index");
  const at = src.search(/\/>\s*Nova transação\s*</);
  assert.ok(at >= 0, "sem o botão Nova transação no cabeçalho");
  // A visibilidade mora no contêiner da ação (M-13, 3b): ver
  // `headerActionProblems` em `jsx-source.ts`.
  assert.deepEqual(headerActionProblems(src, at), []);
});

test("a última seção tem folga embaixo abaixo de lg para o flutuante", () => {
  // Mesma conta da M-12: o botão cobre 3rem acima do padding do `<main>`.
  const src = fn(read(DASHBOARD), "Summary");
  const last = tagAt(src, src.lastIndexOf("<section"));
  assertTokens(last, ["pb-16", "lg:pb-0"]);
});

test("LoadingState: a última seção tem a mesma folga embaixo abaixo de lg", () => {
  // O flutuante aparece também durante o carregamento e cobriria o esqueleto.
  const src = fn(read(DASHBOARD), "LoadingState");
  const last = tagAt(src, src.lastIndexOf("<section"));
  assertTokens(last, ["pb-16", "lg:pb-0"]);
});

test('"Tentar novamente" do Dashboard com 44 px abaixo de lg', () => {
  // Paridade com o banner de Transações (M-12): é a única ação da tela com a
  // API fora, e o P4 só vê altura explícita.
  const src = fn(read(DASHBOARD), "ErrorBanner");
  const button = tagAt(src, src.indexOf("<button"));
  assertTokens(button, ["min-h-11", "lg:min-h-0"]);
});
