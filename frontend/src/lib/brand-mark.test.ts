/**
 * Marca do Fisco na barra lateral: o mesmo desenho do ícone da aba
 * (`public/favicon.svg`), como componente com o SVG inline, para não depender
 * de arquivo servido de `public/`.
 *
 * Escrito **antes** da implementação. Teste sobre arquivo, um por asserção.
 * A igualdade do desenho com o `favicon.svg` (cores, traços, `rx`, espessura,
 * ordem do gradiente) está em `favicon.test.ts`, lida do próprio arquivo.
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

const MARK = "../components/shared/BrandMark.tsx";
const SIDEBAR = "../components/dashboard/Sidebar.tsx";

test("BrandMark: o id do gradiente é único por instância (useId)", () => {
  // A barra lateral e a superior podem estar no DOM ao mesmo tempo (uma
  // escondida por CSS); um id fixo repetido faria uma usar o gradiente da outra.
  assert.ok(/\buseId\(\)/.test(read(MARK)), "sem useId()");
});

test("BrandMark: decorativo para leitor de tela (o nome Fisco vem ao lado)", () => {
  assert.ok(
    read(MARK).includes('aria-hidden="true"'),
    'sem aria-hidden="true"',
  );
});

test("Sidebar: usa a BrandMark ao lado do nome", () => {
  const src = read(SIDEBAR);
  assert.ok(/<BrandMark\b/.test(src), "sem <BrandMark");
});

test('Sidebar: não tem mais o "F" provisório', () => {
  const src = read(SIDEBAR);
  assert.ok(!/>\s*F\s*</.test(src), 'o "F" de texto continua na Sidebar');
});

const TOPBAR = "../components/layout/TopBar.tsx";

test("TopBar: usa a BrandMark ao lado do nome", () => {
  assert.ok(/<BrandMark\b/.test(read(TOPBAR)), "sem <BrandMark");
});

test('TopBar: não tem mais o "F" provisório', () => {
  assert.ok(
    !/>\s*F\s*</.test(read(TOPBAR)),
    'o "F" de texto continua na TopBar',
  );
});
