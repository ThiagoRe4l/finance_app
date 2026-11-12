/**
 * Leitura de JSX por texto, para os testes de contrato sobre arquivo.
 *
 * **Só para testes** — usa `node:assert` e não é importado por nenhuma tela.
 * Extraído em 12/11/2026 (backlog, item N) das cópias que viviam em
 * `dashboard-mobile`, `month-scroller`, `page-header-mobile`,
 * `transaction-form-mobile` e `transactions-list-mobile` (`*.test.ts`).
 *
 * Continua sendo **heurística sobre texto**, não parser: serve para os
 * arquivos deste projeto, escritos com prettier. Os limites conhecidos estão
 * nos testes de `jsx-source.test.ts`.
 */

import assert from "node:assert/strict";

/**
 * A tag de abertura que começa no `<` em `from`, até o `>` que a fecha,
 * pulando `{...}` e strings (o `=>` de uma expressão não encerra a tag).
 */
export function tagAt(source: string, from: number): string {
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

/** A tag de abertura que contém a posição `index`. */
export function tagAround(source: string, index: number): string {
  return tagAt(source, source.lastIndexOf("<", index));
}

/**
 * Onde termina o elemento que abre em `from`: depois do `</nome>` que o
 * fecha, contando os `<nome` aninhados (os auto-fechados `<nome … />` não
 * contam). Para uma tag auto-fechada, o fim da própria tag.
 */
export function elementEnd(source: string, from: number): number {
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
export function classesIn(tag: string): string[] {
  const m =
    /className="([^"]*)"/.exec(tag) ?? /className=\{`([^`]*)`\}/.exec(tag);
  assert.ok(m, `sem className literal em: ${tag.slice(0, 80)}`);
  return m[1]
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function assertTokens(tag: string, expected: string[]) {
  const cls = classesIn(tag);
  const missing = expected.filter((t) => !cls.includes(t));
  assert.deepEqual(missing, [], `faltam em: ${cls.join(" ")}`);
}

export function assertNoTokens(tag: string, forbidden: string[]) {
  const cls = classesIn(tag);
  const present = forbidden.filter((t) => cls.includes(t));
  assert.deepEqual(present, [], `não deviam estar em: ${cls.join(" ")}`);
}

/** O corpo de `function nome(` até a próxima função de topo. */
export function fn(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} não encontrada`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

export type Element = { start: number; end: number; tag: string };

/**
 * Todos os elementos com `className` de um trecho, com início e fim.
 *
 * Um `<` colado num identificador é genérico TypeScript
 * (`useState<Transaction>`), não tag: fica de fora.
 */
export function elements(source: string): Element[] {
  const out: Element[] = [];
  for (const m of source.matchAll(/<[A-Za-z]/g)) {
    const start = m.index ?? 0;
    if (start > 0 && /[\w$]/.test(source[start - 1])) continue;
    const tag = tagAt(source, start);
    if (!/className=/.test(tag)) continue;
    out.push({ start, end: elementEnd(source, start), tag });
  }
  return out;
}

/**
 * O valor literal (`nome="…"`) de uma prop **no nível da tag** — nunca dentro
 * de uma expressão `{…}`, como o JSX passado em `action`. `null` se não há.
 */
export function propValue(tag: string, name: string): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < tag.length; i++) {
    const ch = tag[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (
      depth === 0 &&
      tag.startsWith(`${name}="`, i) &&
      /\s/.test(tag[i - 1])
    ) {
      const from = i + name.length + 2;
      return tag.slice(from, tag.indexOf('"', from));
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return null;
}

/**
 * Os problemas do botão de ação de cabeçalho em `at`: a visibilidade mora no
 * contêiner (M-13, 3b) — o botão não repete `hidden`/`lg:flex`, e o
 * `<PageHeader>` que o contém tem `actionClassName="hidden lg:flex"`.
 */
export function headerActionProblems(source: string, at: number): string[] {
  const cls = classesIn(tagAt(source, source.lastIndexOf("<button", at)));
  const headerAt = source.lastIndexOf("<PageHeader", at);
  const header = headerAt < 0 ? "" : tagAt(source, headerAt);
  const problems: string[] = [];
  if (!cls.includes("flex")) problems.push("botão sem flex");
  for (const token of ["hidden", "lg:flex"]) {
    if (cls.includes(token)) problems.push(`botão com ${token}`);
  }
  if (headerAt < 0 || headerAt + header.length <= at) {
    problems.push("botão fora de um <PageHeader>");
  } else if (propValue(header, "actionClassName") !== "hidden lg:flex") {
    problems.push('<PageHeader> sem actionClassName="hidden lg:flex"');
  }
  return problems;
}
