/**
 * Contrato do layout externo único — fatia 1b da reforma mobile-first
 * (`docs/mobile-first.md` → M-9).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
 *
 * A 1b é "sem mudança visual". A prova é estática: o `AppShell` carrega as
 * mesmas classes e a mesma estrutura que as 5 rotas repetiam, então o DOM
 * renderizado é o mesmo. Os tokens estão escritos por extenso aqui, copiados
 * do código de antes da extração — não importados do componente.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");

const SHELL = "../components/layout/AppShell.tsx";
const ROUTES = [
  "index",
  "transacoes",
  "categorias",
  "parcelamentos",
  "relatorios",
] as const;

/** Os tokens de antes da extração, iguais nas 5 rotas (conferido em 11/10/2026). */
const WRAPPER = "flex min-h-dvh bg-background text-foreground";
const MAIN = "flex-1 p-6 md:p-12 max-w-[1400px] mx-auto";

const sorted = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();

function shell(): string {
  assert.ok(
    existsSync(path(SHELL)),
    "components/layout/AppShell.tsx não existe",
  );
  return read(SHELL);
}

/** O `className` literal da primeira tag `<tag …>` do arquivo. */
function classOf(source: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*?className="([^"]*)"`).exec(source);
  assert.ok(m, `<${tag} className="…"> não encontrado`);
  return m[1];
}

for (const route of ROUTES) {
  test(`(a) ${route}.tsx usa <AppShell> e não repete o layout externo`, () => {
    const src = read(`../routes/${route}.tsx`);
    assert.match(
      src,
      /import \{ AppShell \} from "@\/components\/layout\/AppShell(\.tsx)?";/,
    );
    assert.match(src, /<AppShell>/);
    assert.doesNotMatch(src, /<Sidebar\b/);
    assert.doesNotMatch(src, /<main\b/);
    assert.ok(!src.includes(WRAPPER), "o wrapper flex min-h-dvh ficou na rota");
  });
}

test("(b) AppShell: wrapper e <main> com exatamente os tokens de antes", () => {
  const src = shell();
  assert.deepEqual(sorted(classOf(src, "div")), sorted(WRAPPER));
  assert.deepEqual(sorted(classOf(src, "main")), sorted(MAIN));
});

test("(c) AppShell: <Sidebar /> antes do <main>, children dentro do <main>", () => {
  const src = shell();
  const div = src.indexOf("<div");
  const sidebar = src.indexOf("<Sidebar />");
  const main = src.indexOf("<main");
  const children = src.indexOf("{children}");
  const mainEnd = src.indexOf("</main>");
  const divEnd = src.lastIndexOf("</div>");
  assert.ok(div >= 0 && sidebar > div, "<Sidebar /> fora do wrapper");
  assert.ok(main > sidebar, "<main> tem que vir depois da <Sidebar />");
  assert.ok(children > main && children < mainEnd, "{children} fora do <main>");
  assert.ok(divEnd > mainEnd, "</main> tem que fechar antes do wrapper");
  // Nada entre </main> e </div>, como nas 5 rotas de antes.
  assert.equal(src.slice(mainEnd + "</main>".length, divEnd).trim(), "");
});
