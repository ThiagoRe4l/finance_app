/**
 * Contrato da lista de Transações no celular — fatia 2b da reforma
 * mobile-first (`docs/mobile-first.md` → M-4, M-12).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md. Teste
 * sobre arquivo, como as fatias anteriores: componente React não tem teste
 * neste container. Largura real, alvos na aba Computed e o último cartão
 * descoberto ficam com a conferência no DevTools (M-12, "Verificação pelo
 * usuário").
 *
 * Cartões abaixo de `lg`, tabela a partir de `lg`, as duas marcações
 * renderizadas e escolhidas só por CSS (`lg:hidden` / `hidden lg:block`).
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

const PAGE = "../routes/transacoes.tsx";
const FAB = "../components/shared/FloatingActionButton.tsx";

/**
 * A tag de abertura que começa no `<` em `from`, até o `>` que a fecha,
 * pulando `{...}` e strings (o `=>` de uma expressão não encerra a tag).
 */
function tagAt(source: string, from: number): string {
  assert.ok(from >= 0, "tag não encontrada");
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

/**
 * Onde termina o elemento que abre em `from`: depois do `</nome>` que o
 * fecha, contando os `<nome` aninhados (os auto-fechados `<nome … />` não
 * contam). Para uma tag auto-fechada, o fim da própria tag.
 */
function elementEnd(source: string, from: number): number {
  const open = tagAt(source, from);
  if (open.endsWith("/>")) return from + open.length;
  const name = /^<([A-Za-z][\w.]*)/.exec(open)?.[1];
  assert.ok(name, `sem nome de tag em: ${open.slice(0, 40)}`);
  const re = new RegExp(`<(/?)${name.replace(".", "\\.")}\\b`, "g");
  re.lastIndex = from + open.length;
  let depth = 1;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) return source.indexOf(">", m.index) + 1;
    } else if (!tagAt(source, m.index).endsWith("/>")) depth++;
  }
  assert.fail(`<${name}> sem fechamento`);
}

/**
 * Os tokens estáticos do `className` de uma tag: `className="…"` ou
 * `className={`…`}`, sem os pedaços `${…}`.
 */
function classesIn(tag: string): string[] {
  const m =
    /className="([^"]*)"/.exec(tag) ?? /className=\{`([^`]*)`\}/.exec(tag);
  assert.ok(m, `sem className literal em: ${tag.slice(0, 80)}`);
  return m[1]
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function assertTokens(tag: string, expected: string[]) {
  const cls = classesIn(tag);
  const missing = expected.filter((t) => !cls.includes(t));
  assert.deepEqual(missing, [], `faltam em: ${cls.join(" ")}`);
}

function assertNoTokens(tag: string, forbidden: string[]) {
  const cls = classesIn(tag);
  const present = forbidden.filter((t) => cls.includes(t));
  assert.deepEqual(present, [], `não deviam estar em: ${cls.join(" ")}`);
}

/** O corpo de `function nome(` até a próxima função de topo. */
function fn(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} não encontrada`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

type Element = { start: number; end: number; tag: string };

/** Todos os elementos com `className` de um trecho, com início e fim. */
function elements(source: string): Element[] {
  const out: Element[] = [];
  for (const m of source.matchAll(/<[A-Za-z]/g)) {
    const start = m.index ?? 0;
    const tag = tagAt(source, start);
    if (!/className=/.test(tag)) continue;
    out.push({ start, end: elementEnd(source, start), tag });
  }
  return out;
}

/** O elemento com `className` mais interno que contém a posição `index`. */
function innermostAround(source: string, index: number): Element {
  const around = elements(source).filter(
    (e) => e.start < index && index < e.end,
  );
  assert.ok(around.length > 0, `nada com className em volta de ${index}`);
  return around.reduce((a, b) => (b.start > a.start ? b : a));
}

/** O único elemento do trecho cujo `className` tem todos os `tokens`. */
function onlyWith(source: string, tokens: string[]): Element {
  const hits = elements(source).filter((e) =>
    tokens.every((t) => classesIn(e.tag).includes(t)),
  );
  assert.equal(
    hits.length,
    1,
    `esperado um elemento com ${tokens.join(" ")}, achados ${hits.length}`,
  );
  return hits[0];
}

function heightPx(tag: string, axis: "h" | "w"): number {
  const m = classesIn(tag)
    .map((c) => new RegExp(`^${axis}-(\\d+(?:\\.\\d+)?)$`).exec(c))
    .find(Boolean);
  assert.ok(m, `sem ${axis}-N sem prefixo em: ${classesIn(tag).join(" ")}`);
  return Number(m[1]) * 4;
}

const page = () => fn(read(PAGE), "TransacoesPage");
const cardList = () => onlyWith(page(), ["lg:hidden"]);
const table = () => onlyWith(page(), ["hidden", "lg:block"]);

// ── Duas marcações, escolhidas por CSS ───────────────────────────────────

test("a página tem a lista de cartões (lg:hidden) e a tabela (hidden lg:block)", () => {
  const src = page();
  const cards = src.slice(cardList().start, cardList().end);
  const rows = src.slice(table().start, table().end);

  assert.match(cards, /<TransactionCard\b/, "cartões fora da lista lg:hidden");
  assert.match(cards, /<LoadingCards\b/, "esqueleto de cartão fora da lista");
  assert.doesNotMatch(cards, /<TransactionRow\b|<TableHeader\b|<LoadingRows\b/);

  assert.match(rows, /<TableHeader\b/);
  assert.match(rows, /<TransactionRow\b/);
  assert.match(rows, /<LoadingRows\b/);
  assert.doesNotMatch(rows, /<TransactionCard\b|<LoadingCards\b/);
});

test("a partir de lg a tabela é a de hoje: as classes, por extenso, só ganham o prefixo", () => {
  const src = read(PAGE);
  // O `grid-cols-12` vira `lg:grid-cols-12` (P1); o resto é o de antes.
  const columns = /const COLUMNS =\s*"([^"]*)"/.exec(src);
  assert.ok(columns, "const COLUMNS não encontrada");
  assert.deepEqual(
    columns[1].split(/\s+/).filter(Boolean),
    "grid lg:grid-cols-12 gap-4 px-6 py-4 border-b border-border last:border-0 items-center".split(
      " ",
    ),
  );

  const header = fn(src, "TableHeader");
  assert.deepEqual(
    classesIn(tagAt(header, header.indexOf("<div"))),
    "grid lg:grid-cols-12 gap-4 px-6 py-3 border-b border-border text-xs uppercase tracking-wider text-muted-foreground".split(
      " ",
    ),
  );

  assert.deepEqual(
    classesIn(table().tag),
    "hidden lg:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden".split(
      " ",
    ),
  );
});

// ── Cartão ───────────────────────────────────────────────────────────────

test("cartão: descrição em até duas linhas, palavra longa quebra, pai com min-w-0", () => {
  const src = fn(read(PAGE), "TransactionCard");
  const at = src.search(/\{transaction\.title\}\s*<\//);
  assert.ok(at >= 0, "sem {transaction.title} como texto no cartão");
  const title = innermostAround(src, at);
  assertTokens(title.tag, ["line-clamp-2", "wrap-anywhere"]);
  // `break-words` não entra no cálculo da largura mínima: a palavra única
  // longa continuaria alargando o cartão.
  assertNoTokens(title.tag, ["break-words", "truncate"]);

  const parents = elements(src).filter(
    (e) => e.start < title.start && title.end <= e.end,
  );
  assert.ok(
    parents.some((e) => classesIn(e.tag).includes("min-w-0")),
    "nenhum ancestral da descrição com min-w-0",
  );
});

test("cartão: o valor não encolhe nem quebra", () => {
  const src = fn(read(PAGE), "TransactionCard");
  const at = src.indexOf("formatBRL(amount)");
  assert.ok(at >= 0, "sem formatBRL(amount) no cartão");
  assertTokens(innermostAround(src, at).tag, [
    "shrink-0",
    "whitespace-nowrap",
    "tabular-nums",
  ]);
});

test("cartão: linha 2 com data · categoria (truncate) e tipo, em flex-wrap", () => {
  const src = fn(read(PAGE), "TransactionCard");
  const date = src.indexOf("formatShortDate(transaction.date)");
  const category = src.indexOf("{transaction.category.name}");
  const type = src.indexOf("typeColor[label]");
  assert.ok(
    date >= 0 && category >= 0 && type >= 0,
    "faltam data, categoria ou tipo",
  );

  assertTokens(innermostAround(src, category).tag, ["truncate"]);
  const line = elements(src)
    .filter((e) =>
      [date, category, type].every((i) => e.start < i && i < e.end),
    )
    .reduce((a, b) => (b.start > a.start ? b : a));
  assertTokens(line.tag, ["flex", "flex-wrap"]);
});

test("cartão: editar e excluir com 44×44, sempre visíveis, rotulados com o título", () => {
  const src = fn(read(PAGE), "TransactionCard");
  for (const verb of ["Editar", "Excluir"]) {
    const at = src.indexOf(`aria-label={\`${verb} \${transaction.title}\`}`);
    assert.ok(at >= 0, `sem botão "${verb}" no cartão`);
    const button = tagAt(src, src.lastIndexOf("<button", at));
    assert.match(button, /type="button"/);
    assert.ok(heightPx(button, "h") >= 44, `${verb}: altura < 44 px`);
    assert.ok(heightPx(button, "w") >= 44, `${verb}: largura < 44 px`);
  }
  // Nada esconde as ações no cartão: no toque não há hover.
  assert.doesNotMatch(src, /opacity-0|group-hover:/);
});

test("cartão: o esqueleto é de cartão, não de grade de 12 colunas", () => {
  const src = fn(read(PAGE), "LoadingCards");
  assert.match(src, /<Skeleton\b/);
  assert.doesNotMatch(src, /COLUMNS|grid-cols-|col-span-/);
});

// ── Tabela a partir de lg ────────────────────────────────────────────────

test("tabela: ações escondidas no hover só a partir de lg, com 44 px abaixo de lg", () => {
  const src = fn(read(PAGE), "TransactionRow");
  const edit = src.indexOf("aria-label={`Editar ${transaction.title}`}");
  assert.ok(edit >= 0, "sem botão Editar na linha");
  const actions = innermostAround(src, src.lastIndexOf("<button", edit));
  assertTokens(actions.tag, [
    "lg:opacity-0",
    "lg:group-hover:opacity-100",
    "lg:group-focus-within:opacity-100",
  ]);
  assertNoTokens(actions.tag, [
    "opacity-0",
    "group-hover:opacity-100",
    "group-focus-within:opacity-100",
  ]);

  for (const verb of ["Editar", "Excluir"]) {
    const at = src.indexOf(`aria-label={\`${verb} \${transaction.title}\`}`);
    const button = tagAt(src, src.lastIndexOf("<button", at));
    assertTokens(button, ["h-11", "w-11", "lg:h-7", "lg:w-7"]);
    assertNoTokens(button, ["h-7", "w-7"]);
  }
});

// ── Estados uma vez só, fora das duas marcações ──────────────────────────

test("vazio e erro aparecem uma vez só, fora dos cartões e da tabela", () => {
  const src = page();
  for (const name of ["EmptyState", "ErrorBanner"]) {
    const hits = [...src.matchAll(new RegExp(`<${name}\\b`, "g"))];
    assert.equal(hits.length, 1, `<${name}> aparece ${hits.length} vezes`);
    const at = hits[0].index ?? 0;
    for (const [label, el] of [
      ["cartões", cardList()],
      ["tabela", table()],
    ] as const) {
      assert.ok(
        at < el.start || at > el.end,
        `<${name}> dentro da marcação de ${label}`,
      );
    }
  }
});

// ── Controles da página ──────────────────────────────────────────────────

test("busca: 16 px no celular (sem zoom no iOS) e 44 px de altura abaixo de lg", () => {
  const src = page();
  const at = src.indexOf('placeholder="Buscar');
  assert.ok(at >= 0, "sem o campo de busca");
  const input = tagAt(src, src.lastIndexOf("<input", at));
  assertTokens(input, ["text-base", "md:text-sm", "min-h-11", "lg:min-h-0"]);
  assertNoTokens(input, ["text-sm", "text-xs"]);
});

test('"Nova" do cabeçalho só a partir de lg (o flutuante a substitui no celular)', () => {
  const src = page();
  const at = src.search(/\/>\s*Nova\s*</);
  assert.ok(at >= 0, "sem o botão Nova");
  const button = tagAt(src, src.lastIndexOf("<button", at));
  // A visibilidade mora no contêiner da ação (M-13, 3b): o botão não repete o
  // `hidden`, e o `actionClassName` é quem o esconde no celular.
  const cls = classesIn(button);
  const headerAt = src.lastIndexOf("<PageHeader", at);
  const header = headerAt < 0 ? "" : tagAt(src, headerAt);
  const problems: string[] = [];
  if (!cls.includes("flex")) problems.push("botão sem flex");
  for (const token of ["hidden", "lg:flex"]) {
    if (cls.includes(token)) problems.push(`botão com ${token}`);
  }
  if (headerAt < 0 || headerAt + header.length <= at) {
    problems.push("botão fora de um <PageHeader>");
  } else if (!header.includes('actionClassName="hidden lg:flex"')) {
    problems.push('<PageHeader> sem actionClassName="hidden lg:flex"');
  }
  assert.deepEqual(problems, []);
});

test('"Tentar novamente" com 44 px abaixo de lg', () => {
  const src = fn(read(PAGE), "ErrorBanner");
  const button = tagAt(src, src.indexOf("<button"));
  assertTokens(button, ["min-h-11", "lg:min-h-0"]);
});

test("a lista de cartões tem folga embaixo para o flutuante não cobrir o último", () => {
  // O botão cobre 3rem acima do padding do `<main>` (1rem de distância +
  // 3.5rem de altura − 1.5rem de padding); 4rem deixa 1rem de folga.
  const cls = classesIn(cardList().tag);
  const space = cls.map((c) => /^[pm]b-(\d+)$/.exec(c)).find(Boolean);
  assert.ok(space, `sem pb-N/mb-N na lista de cartões: ${cls.join(" ")}`);
  assert.ok(Number(space[1]) >= 16, `${space[0]} < 4rem`);
});

// ── Botão flutuante ──────────────────────────────────────────────────────

test("FloatingActionButton: fixo, só abaixo de lg, no nível das barras, acima da barra inferior", () => {
  const src = read(FAB);
  assert.match(src, /export function FloatingActionButton\b/);
  const button = tagAt(src, src.indexOf("<button"));
  assertTokens(button, [
    "fixed",
    "lg:hidden",
    "z-40",
    "bottom-[calc(var(--app-bottombar-height)+env(safe-area-inset-bottom)+1rem)]",
  ]);
  assert.ok(
    classesIn(button).some((c) => /^right-/.test(c)),
    `sem right-*: ${classesIn(button).join(" ")}`,
  );
  assert.match(button, /type="button"/);
  assert.match(button, /aria-label=\{label\}/);
  assert.match(button, /onClick=\{onClick\}/);
});

test("FloatingActionButton: alvo de pelo menos 44×44", () => {
  const button = tagAt(read(FAB), read(FAB).indexOf("<button"));
  assert.ok(heightPx(button, "h") >= 44, "altura < 44 px");
  assert.ok(heightPx(button, "w") >= 44, "largura < 44 px");
});

test("Transações usa o flutuante para abrir o formulário de criação", () => {
  const src = read(PAGE);
  assert.match(
    src,
    /import \{ FloatingActionButton \} from "@\/components\/shared\/FloatingActionButton";/,
  );
  const at = src.indexOf("<FloatingActionButton");
  assert.ok(at >= 0, "sem <FloatingActionButton");
  const tag = tagAt(src, at);
  assert.match(tag, /label="Nova transação"/);
  assert.match(tag, /onClick=\{\(\) => setIsCreating\(true\)\}/);
});
