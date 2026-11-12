/**
 * Fatias 4 e 5 da reforma mobile-first — `docs/mobile-first.md` → M-14.
 *
 * Escrito **antes** da implementação (11/11/2026); aprovação delegada pelo
 * usuário nesta data. Teste sobre arquivo, como as fatias anteriores: prova as
 * strings de classe, não a renderização. A conferência visual é do usuário.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const CATEGORIES = read("../routes/categorias.tsx");
const INSTALLMENTS = read("../routes/parcelamentos.tsx");
const REPORTS = read("../routes/relatorios.tsx");
const CATEGORY_FORM = read("../components/categories/CategoryFormDialog.tsx");

function hasTokens(source: string, tokens: string[], where: string) {
  for (const token of tokens) {
    assert.ok(
      new RegExp(
        `(^|[\\s"'\`])${token.replace(/[[\]().:/-]/g, "\\$&")}(?=[\\s"'\`]|$)`,
        "m",
      ).test(source),
      `${where}: falta a classe ${token}`,
    );
  }
}

test("categorias: ações visíveis no toque, escondidas no hover só a partir de lg", () => {
  hasTokens(
    CATEGORIES,
    [
      // M-15: só onde existe hover de verdade.
      "lg:hover-capable:opacity-0",
      "lg:group-hover:opacity-100",
      "lg:group-focus-within:opacity-100",
    ],
    "categorias.tsx",
  );
  assert.equal(
    CATEGORIES.match(/h-11 w-11 lg:h-7 lg:w-7/g)?.length,
    2,
    "editar e excluir com 44 px abaixo de lg",
  );
});

test("formulário de categoria: folha embaixo no celular e sem teclado automático", () => {
  hasTokens(
    CATEGORY_FORM,
    [
      "max-sm:top-auto",
      "max-sm:left-2",
      "max-sm:right-2",
      "max-h-[90dvh]",
      "overflow-y-auto",
    ],
    "CategoryFormDialog.tsx",
  );
  assert.doesNotMatch(CATEGORY_FORM, /\bautoFocus\b/);
  assert.match(CATEGORY_FORM, /onOpenAutoFocus=/);
  assert.match(CATEGORY_FORM, /matchMedia\("\(pointer: coarse\)"\)/);
  assert.match(
    CATEGORY_FORM,
    /h-11 w-11 sm:h-8 sm:w-8/,
    "amostra de cor com 44 px no toque",
  );
  assert.match(
    CATEGORY_FORM,
    /h-11 w-11 sm:h-9 sm:w-9/,
    "ícone com 44 px no toque",
  );
});

test("parcelamentos: card empilha valores e ações, alvos de 44 px", () => {
  hasTokens(
    INSTALLMENTS,
    ["flex-wrap", "gap-x-6", "gap-y-3", "lg:gap-8", "ml-auto"],
    "parcelamentos.tsx",
  );
  assert.match(INSTALLMENTS, /h-11 w-11 lg:h-8 lg:w-8/, "editar com 44 px");
  assert.match(INSTALLMENTS, /h-11 lg:h-8 px-3/, "avançar com 44 px");
  assert.doesNotMatch(INSTALLMENTS, /className="flex items-center gap-8"/);
});

for (const [name, source] of [
  ["parcelamentos.tsx", INSTALLMENTS],
  ["relatorios.tsx", REPORTS],
] as const) {
  test(`${name}: totais empilhados abaixo de xl, valor sem quebra`, () => {
    // M-15: 3 colunas só a partir de xl (medido: vazava a 1024).
    assert.doesNotMatch(
      source,
      /grid grid-cols-1 (md|lg):grid-cols-3 gap-6 mb-8/,
    );
    assert.ok(
      (source.match(/grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8/g)?.length ??
        0) >= 2,
      "a grade dos totais e a do esqueleto",
    );
    assert.match(
      source,
      /text-2xl font-semibold tabular-nums whitespace-nowrap/,
    );
  });
}

test("styles.css: variante hover-capable = hover de verdade, com ponteiro fino (M-15)", () => {
  const css = read("../styles.css");
  assert.match(
    css,
    /@custom-variant hover-capable\s*\{\s*@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*@slot;\s*\}\s*\}/,
  );
});

test("categorias: nada esconde as ações só com lg:opacity-0 (M-15)", () => {
  assert.doesNotMatch(CATEGORIES, /(^|[\s"'`])lg:opacity-0(?=[\s"'`])/m);
});
