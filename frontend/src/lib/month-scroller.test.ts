/**
 * Contrato dos gráficos de meses com rolagem interna — fatia 1d da reforma
 * mobile-first (`docs/mobile-first.md` → M-11).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md. Teste
 * sobre arquivo, como `app-shell.test.ts` e `layout-bars.test.ts`: componente
 * React não tem teste neste container, então o que se trava são as classes e
 * as ligações. Quem mede o transbordo de verdade é o procedimento da M-11 no
 * DevTools (critério de aceite da 1d).
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

const SCROLLER = "../components/shared/MonthScroller.tsx";
const CASHFLOW = "../components/dashboard/CashFlow.tsx";
const RELATORIOS = "../routes/relatorios.tsx";

/** O `MonthlyComparison` de `relatorios.tsx`, sem o resto da rota. */
function monthlyComparison(): string {
  const src = read(RELATORIOS);
  const start = src.indexOf("function MonthlyComparison");
  const end = src.indexOf("function TopCategories");
  assert.ok(start >= 0 && end > start, "MonthlyComparison não encontrado");
  return src.slice(start, end);
}

/**
 * A tag de abertura que começa no `<` em `from`, até o `>` que a fecha,
 * pulando `{...}` e strings (o `=>` de uma expressão não encerra a tag).
 */
function tagAt(source: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  let i = from + 1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) break;
  }
  return source.slice(from, i + 1);
}

/** A tag de abertura que contém a posição `index`. */
function tagAround(source: string, index: number): string {
  return tagAt(source, source.lastIndexOf("<", index));
}

/** Os tokens do `className="…"` literal de uma tag. */
function classesIn(tag: string): string[] {
  const m = /className="([^"]*)"/.exec(tag);
  assert.ok(m, `sem className literal em: ${tag.slice(0, 80)}`);
  return m[1].split(/\s+/).filter(Boolean);
}

const CHARTS = [
  {
    name: "Fluxo Mensal (CashFlow.tsx)",
    source: () => read(CASHFLOW),
    // Duas barras `w-3` + `gap-1`: a coluna fixa não pode ser mais estreita.
    minColumnPx: 28,
  },
  {
    name: "Comparativo Mensal (relatorios.tsx)",
    source: monthlyComparison,
    // Duas barras `w-5` + `gap-1.5`.
    minColumnPx: 46,
  },
] as const;

// ── MonthScroller ────────────────────────────────────────────────────────

test("MonthScroller: uma única rolagem horizontal, numa região focável e rotulada", () => {
  const src = read(SCROLLER);
  const hits = [...src.matchAll(/\boverflow-x-auto\b/g)];
  assert.equal(hits.length, 1, "esperada exatamente uma overflow-x-auto");
  const tag = tagAround(src, hits[0].index ?? 0);
  assert.match(tag, /\brole="region"/, tag);
  assert.match(tag, /\btabIndex=\{0\}/, tag);
  assert.match(tag, /\baria-label=\{?\s*\w/, tag);
  assert.ok(
    classesIn(tag).some((c) => c.startsWith("focus-visible:")),
    `sem anel de foco visível: ${tag}`,
  );
});

test("MonthScroller: a barra de rolagem continua visível (é o aviso dos meses à esquerda)", () => {
  assert.doesNotMatch(
    read(SCROLLER),
    /scrollbar-none|scrollbar-hide|no-scrollbar|scrollbar-width:\s*none|scrollbar-width:none|::-webkit-scrollbar/,
  );
});

test("MonthScroller: a trilha é w-max no celular e md:w-full a partir de md", () => {
  const src = read(SCROLLER);
  const region = src.search(/\boverflow-x-auto\b/);
  const track = src.indexOf("<div", region);
  assert.ok(track > region, "sem trilha dentro da região rolável");
  const cls = classesIn(tagAt(src, track));
  assert.ok(cls.includes("w-max"), cls.join(" "));
  assert.ok(cls.includes("md:w-full"), cls.join(" "));
});

test("MonthScroller: começa no mês mais recente, via useLayoutEffect, sem pular em refetch", () => {
  const src = read(SCROLLER);
  assert.match(src, /\.scrollLeft\s*=\s*[\w.]+\.scrollWidth/);
  // Dependência única: a quantidade de meses. Refetch com o mesmo número de
  // meses não reexecuta o efeito.
  const effect =
    /useLayoutEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[\s*(\w+)\s*\]\s*\)/.exec(
      src,
    );
  assert.ok(effect, "sem useLayoutEffect com uma dependência só");
  assert.doesNotMatch(src, /\buseEffect\(/, "useEffect pinta antes de rolar");
  // A dependência é a prop que os gráficos ligam a `months.length`.
  for (const chart of CHARTS) {
    const src = chart.source();
    const at = src.indexOf("<MonthScroller");
    assert.ok(at >= 0, `${chart.name}: sem <MonthScroller`);
    assert.ok(
      tagAt(src, at).includes(`${effect[1]}={months.length}`),
      `${chart.name}: ${effect[1]}={months.length} não encontrado`,
    );
  }
});

// ── Os dois gráficos ─────────────────────────────────────────────────────

for (const chart of CHARTS) {
  test(`${chart.name}: usa o MonthScroller com rótulo, e a legenda fica fora dele`, () => {
    const src = chart.source();
    const at = src.indexOf("<MonthScroller");
    assert.ok(at >= 0, "sem <MonthScroller");
    assert.match(tagAt(src, at), /\blabel="[^"]+"/);
    // A legenda é o ponto seguido do rótulo (`/> Entradas`); o subtítulo do
    // Comparativo ("Entradas vs Saídas") não conta.
    const legend = src.search(/\/>\s*Entradas/);
    assert.ok(
      legend >= 0 && legend < at,
      "a legenda tem que vir antes (fora) da área rolável",
    );
  });

  test(`${chart.name}: cabeçalho com flex-wrap gap-x-4`, () => {
    const src = chart.source();
    const section = src.indexOf("<section");
    const header = src.indexOf("<div", section);
    const cls = classesIn(tagAt(src, header));
    assert.ok(cls.includes("flex-wrap"), cls.join(" "));
    assert.ok(cls.includes("gap-x-4"), cls.join(" "));
  });

  test(`${chart.name}: coluna de largura fixa no celular e flex-1 só a partir de md`, () => {
    const src = chart.source();
    const map = src.indexOf("bars.map(");
    assert.ok(map >= 0, "sem bars.map(");
    const cls = classesIn(tagAt(src, src.indexOf("<div", map)));
    assert.ok(cls.includes("flex-none"), cls.join(" "));
    assert.ok(cls.includes("md:flex-1"), cls.join(" "));
    assert.ok(!cls.includes("flex-1"), `flex-1 sem prefixo: ${cls.join(" ")}`);
    const width = cls.map((c) => /^w-(\d+(?:\.\d+)?)$/.exec(c)).find(Boolean);
    assert.ok(width, `sem largura fixa w-N: ${cls.join(" ")}`);
    assert.ok(
      Number(width[1]) * 4 >= chart.minColumnPx,
      `${width[0]} é mais estreita que as barras (${chart.minColumnPx} px)`,
    );
  });

  test(`✅ ${chart.name}: largura do conteúdo sem min-w-[…] nem minWidth`, () => {
    // Regressão: já passa hoje. Trava o que a M-11 decidiu — a largura sai do
    // número de colunas, não de um mínimo escrito (seria P6, ou invisível ao
    // detector em `style`).
    assert.doesNotMatch(chart.source(), /min-w-\[|minWidth/);
  });
}

test("MonthScroller: largura do conteúdo sem min-w-[…] nem minWidth", () => {
  assert.doesNotMatch(read(SCROLLER), /min-w-\[|minWidth/);
});
