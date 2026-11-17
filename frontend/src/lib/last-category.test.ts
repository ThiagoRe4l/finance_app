/**
 * Categoria padrão = a última usada (`docs/ux-leis.md`, M3).
 *
 * Escrito **antes** da implementação — vermelho de propósito. O armazenamento é
 * injetado: `localStorage` pode faltar ou lançar (janela privada, dados
 * bloqueados) e a tela tem que funcionar igual.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as last from "./last-category.ts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("bloqueado");
  },
  setItem: () => {
    throw new Error("bloqueado");
  },
};

test("a última categoria lembrada volta como texto do Select", () => {
  const storage = memoryStorage();
  last.rememberLastCategory(storage, 3);
  assert.equal(last.readLastCategory(storage, [1, 2, 3]), "3");
});

test("sem nada lembrado, devolve vazio", () => {
  assert.equal(last.readLastCategory(memoryStorage(), [1, 2, 3]), "");
});

test("categoria que não existe mais (excluída) não vira padrão", () => {
  const storage = memoryStorage();
  last.rememberLastCategory(storage, 9);
  assert.equal(last.readLastCategory(storage, [1, 2, 3]), "");
});

test("valor corrompido no armazenamento é ignorado", () => {
  const storage = memoryStorage();
  storage.setItem(last.LAST_CATEGORY_KEY, "abc");
  assert.equal(last.readLastCategory(storage, [1, 2, 3]), "");
});

test("armazenamento que lança não derruba a tela, nem na leitura nem na escrita", () => {
  assert.doesNotThrow(() => last.rememberLastCategory(throwing, 1));
  assert.equal(last.readLastCategory(throwing, [1]), "");
});

test("sem armazenamento (undefined) também funciona", () => {
  assert.doesNotThrow(() => last.rememberLastCategory(undefined, 1));
  assert.equal(last.readLastCategory(undefined, [1]), "");
});

test("orderCategories: mais usadas primeiro, empate por nome, sem mutar", () => {
  const input = [
    { id: 1, name: "Lazer", txs_count: 2 },
    { id: 2, name: "Moradia", txs_count: 9 },
    { id: 3, name: "Alimentação", txs_count: 2 },
    { id: 4, name: "Zero", txs_count: 0 },
  ];
  const out = last.orderCategories(input);
  assert.deepEqual(
    out.map((c: { id: number }) => c.id),
    [2, 3, 1, 4],
  );
  assert.deepEqual(
    input.map((c) => c.id),
    [1, 2, 3, 4],
  );
});
