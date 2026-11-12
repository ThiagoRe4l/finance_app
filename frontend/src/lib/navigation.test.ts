/**
 * Fonte única da navegação — fatia 1c da reforma mobile-first
 * (`docs/mobile-first.md` → M-1, M-10).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS, activeNavKey } from "./navigation.ts";

test("os 5 itens, na ordem da Sidebar de hoje", () => {
  assert.deepEqual(
    NAV_ITEMS.map((i) => [i.key, i.to]),
    [
      ["inicio", "/"],
      ["transacoes", "/transacoes"],
      ["categorias", "/categorias"],
      ["parcelamentos", "/parcelamentos"],
      ["relatorios", "/relatorios"],
    ],
  );
});

test("label é o da Sidebar de hoje: ≥ 1024 px não muda", () => {
  assert.deepEqual(
    NAV_ITEMS.map((i) => i.label),
    ["Dashboard", "Transações", "Categorias", "Parcelamentos", "Relatórios"],
  );
});

test("shortLabel é o da barra inferior e cabe em ~64 px (até 10 caracteres)", () => {
  assert.deepEqual(
    NAV_ITEMS.map((i) => i.shortLabel),
    ["Início", "Transações", "Categorias", "Parcelas", "Relatórios"],
  );
  for (const { shortLabel } of NAV_ITEMS) {
    assert.ok(shortLabel.length <= 10, `"${shortLabel}" não cabe na barra`);
  }
});

test("cada destino tem um arquivo de rota", () => {
  for (const { to } of NAV_ITEMS) {
    const file = to === "/" ? "index" : to.slice(1);
    const path = fileURLToPath(
      new URL(`../routes/${file}.tsx`, import.meta.url),
    );
    assert.ok(existsSync(path), `sem rota para ${to}`);
  }
});

test("activeNavKey: cada destino ativa o próprio item (igual ao exact da Sidebar)", () => {
  for (const { key, to } of NAV_ITEMS) {
    assert.equal(activeNavKey(to), key, to);
  }
});

test("activeNavKey: barra final é ignorada", () => {
  assert.equal(activeNavKey("/transacoes/"), "transacoes");
  assert.equal(activeNavKey("/relatorios/"), "relatorios");
});

test("activeNavKey: subcaminho ativa o pai, menos para /", () => {
  assert.equal(activeNavKey("/transacoes/123"), "transacoes");
  assert.equal(activeNavKey("/parcelamentos/a/b"), "parcelamentos");
});

test("activeNavKey: prefixo sem fronteira de segmento não casa", () => {
  assert.equal(activeNavKey("/transacoesx"), null);
  assert.equal(activeNavKey("/categorias-velhas"), null);
});

test("activeNavKey: rota desconhecida dá null — / não vira coringa", () => {
  assert.equal(activeNavKey("/nao-existe"), null);
  assert.equal(activeNavKey("/Transacoes"), null);
});
