/**
 * Contrato do `PageHeader` — fatia 3b da reforma mobile-first
 * (`docs/mobile-first.md` → M-13).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md. Teste
 * sobre arquivo: o runner não renderiza componente, então isto prova as strings
 * de classe, não o resultado na tela. A conferência visual fica com o DevTools.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cn } from "./utils.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const PAGE_HEADER = "../components/dashboard/PageHeader.tsx";
const DASHBOARD = "../routes/index.tsx";

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

test("sem actionClassName, o contêiner da ação resolve para a string de hoje", () => {
  const src = read(PAGE_HEADER);
  const m = /<div className=\{cn\("([^"]*)", actionClassName\)\}>/.exec(src);
  assert.ok(m, 'sem <div className={cn("…", actionClassName)}> no PageHeader');
  assert.equal(cn(m[1], undefined), "flex items-center gap-3");
});

test("✅ com hidden lg:flex, o tailwind-merge tira o flex sem prefixo", () => {
  // Regressão: já passa hoje. Sem o merge, `flex` e `hidden` ficariam juntos e
  // a ordem do CSS decidiria se o contêiner some no celular.
  assert.equal(
    cn("flex items-center gap-3", "hidden lg:flex"),
    "items-center gap-3 hidden lg:flex",
  );
});

test("o Dashboard usa o PageHeader com os textos do Header local", () => {
  const src = read(DASHBOARD);
  assert.ok(!/function Header\b/.test(src), "ainda define function Header");
  const at = src.indexOf("<PageHeader");
  assert.ok(at >= 0, "sem <PageHeader> em routes/index.tsx");
  const tag = tagAt(src, at);
  for (const prop of [
    'eyebrow="Mês corrente"',
    'title="Visão Geral"',
    'description="Acompanhe seu fluxo, categorias e parcelamentos em um só lugar."',
  ]) {
    assert.ok(tag.includes(prop), `sem ${prop}`);
  }
});

for (const route of ["categorias", "parcelamentos", "relatorios"]) {
  test(`✅ ${route}: o <PageHeader> não passa actionClassName`, () => {
    // Regressão: já passa hoje. É o que faz o teste acima valer para esta tela.
    const src = read(`../routes/${route}.tsx`);
    const tags = [...src.matchAll(/<PageHeader\b/g)];
    assert.equal(tags.length, 1, `${tags.length} <PageHeader>`);
    const tag = tagAt(src, tags[0].index ?? 0);
    assert.ok(tag.endsWith("/>"), `tag lida pela metade: ${tag.slice(-40)}`);
    assert.doesNotMatch(tag, /actionClassName/);
  });
}

test("✅ o resto do PageHeader continua igual, com a ação condicional", () => {
  // Regressão: já passa hoje. Relatórios não tem ação e não pode ganhar um
  // `<div>` vazio.
  const src = read(PAGE_HEADER);
  for (const classes of [
    "mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4",
    "text-xs text-muted-foreground uppercase tracking-wider mb-2",
    "text-3xl font-semibold tracking-tight",
    "text-sm text-muted-foreground mt-2 max-w-xl",
  ]) {
    assert.ok(src.includes(`className="${classes}"`), `sem: ${classes}`);
  }
  assert.match(
    src,
    /\{action && \(\s*<div className=\{cn\(/,
    "o contêiner da ação deixou de ser condicional",
  );
});
