/**
 * Caderno, fatia C3 — Transações agrupadas por dia (`docs/tema.md`, D-Cad-7).
 *
 * Escrito **antes** da implementação (aprovação delegada pelo usuário em
 * 18/11/2026). Função pura mais o contrato sobre `routes/transacoes.tsx`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { groupByDay } from "./day-groups.ts";

type Item = { id: number; date: string };
const tx = (id: number, date: string): Item => ({ id, date });

// 18/11/2026 é uma quarta-feira.
const TODAY = "2026-11-18";

test("agrupa por data, na ordem da lista, sem reordenar", () => {
  const groups = groupByDay(
    [
      tx(1, "2026-11-18"),
      tx(2, "2026-11-18"),
      tx(3, "2026-11-14"),
      tx(4, "2026-11-10"),
      tx(5, "2026-11-10"),
    ],
    TODAY,
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.items.map((i) => i.id)]),
    [
      ["2026-11-18", [1, 2]],
      ["2026-11-14", [3]],
      ["2026-11-10", [4, 5]],
    ],
  );
});

test("rótulo: hoje e ontem pelo nome", () => {
  const [hoje, ontem] = groupByDay(
    [tx(1, "2026-11-18"), tx(2, "2026-11-17")],
    TODAY,
  );
  assert.equal(hoje.label, "Hoje · 18 nov");
  assert.equal(ontem.label, "Ontem · 17 nov");
});

test("rótulo: os outros dias pelo dia da semana, dia sem zero à esquerda", () => {
  const groups = groupByDay(
    [tx(1, "2026-11-14"), tx(2, "2026-11-09"), tx(3, "2026-11-01")],
    TODAY,
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Sábado · 14 nov", "Segunda · 9 nov", "Domingo · 1 nov"],
  );
});

test("rótulo: o ano aparece só quando não é o de hoje", () => {
  const [g] = groupByDay([tx(1, "2025-12-31")], TODAY);
  assert.equal(g.label, "Quarta · 31 dez 2025");
});

test("ontem atravessa a virada do mês e do ano", () => {
  const [g] = groupByDay([tx(1, "2025-12-31")], "2026-01-01");
  assert.equal(g.label, "Ontem · 31 dez 2025");
});

test("lista vazia não tem grupo", () => {
  assert.deepEqual(groupByDay([], TODAY), []);
});

test("data inválida lança, como o resto do date.ts", () => {
  assert.throws(() => groupByDay([tx(1, "18/11/2026")], TODAY), TypeError);
  assert.throws(() => groupByDay([tx(1, "2026-11-18")], "hoje"), TypeError);
});

test("o grupo não tem total: soma de dinheiro não é do front (backlog)", () => {
  const [g] = groupByDay([tx(1, "2026-11-18")], TODAY);
  assert.deepEqual(Object.keys(g).sort(), ["items", "key", "label"]);
});

test("os itens são os mesmos objetos da entrada (o resto da linha não muda)", () => {
  const item = tx(1, "2026-11-18");
  const [g] = groupByDay([item], TODAY);
  assert.equal(g.items[0], item);
});

// ── Contrato sobre a tela ────────────────────────────────────────────────

const ROUTE = readFileSync(
  fileURLToPath(new URL("../routes/transacoes.tsx", import.meta.url)),
  "utf8",
);

test("Transações agrupa as duas marcações com groupByDay", () => {
  assert.match(
    ROUTE,
    /import \{ groupByDay \} from "@\/lib\/day-groups(\.ts)?";/,
  );
  assert.match(ROUTE, /groupByDay\(visible,/);
});

test("cartões: cada dia é um <li> com <h3> em Fraunces e a lista do dia", () => {
  const cards = ROUTE.slice(
    ROUTE.indexOf('<ul className="lg:hidden'),
    ROUTE.indexOf('<div className="hidden lg:block'),
  );
  assert.match(cards, /<h3 className="[^"]*\bfont-display\b/);
  assert.match(cards, /\{group\.label\}/);
  assert.match(cards, /<TransactionCard\b/);
});

test("tabela: uma linha de cabeçalho do dia antes das linhas dele", () => {
  const table = ROUTE.slice(ROUTE.indexOf('<div className="hidden lg:block'));
  const header = table.indexOf("{group.label}");
  const row = table.indexOf("<TransactionRow");
  assert.ok(
    header >= 0 && row > header,
    "sem cabeçalho do dia antes das linhas",
  );
  assert.match(table, /font-display/);
});
