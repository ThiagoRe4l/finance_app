/**
 * Transações com filtro de período e ordem da mais nova para a mais antiga
 * (`docs/periodos.md`, PER-8). Escrito **antes** da implementação.
 *
 * A tela listava o histórico inteiro. Agora ela pede só o período escolhido
 * (padrão: o mês corrente, PER-1) e mostra sempre do mais recente ao mais
 * antigo. O backend já ordena; `sortNewestFirst` garante a ordem também no
 * cliente, depois da busca e da aba, sem depender de quem chamou.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sortNewestFirst } from "./transactions.ts";
import { fn } from "./jsx-source.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const row = (id: number, date: string) => ({ id, date });

// ── Ordem ────────────────────────────────────────────────────────────────

test("sortNewestFirst: data decrescente", () => {
  const sorted = sortNewestFirst([
    row(1, "2026-08-10"),
    row(2, "2026-10-05"),
    row(3, "2026-09-20"),
  ]);
  assert.deepEqual(
    sorted.map((r) => r.date),
    ["2026-10-05", "2026-09-20", "2026-08-10"],
  );
});

test("sortNewestFirst: no mesmo dia, o id maior (lançado depois) vem primeiro", () => {
  const sorted = sortNewestFirst([
    row(4, "2026-10-05"),
    row(9, "2026-10-05"),
    row(7, "2026-10-05"),
  ]);
  assert.deepEqual(
    sorted.map((r) => r.id),
    [9, 7, 4],
  );
});

test("sortNewestFirst: dia de um dígito não atrapalha (2026-10-09 antes de 2026-10-10 só por data)", () => {
  const sorted = sortNewestFirst([row(1, "2026-10-09"), row(2, "2026-10-10")]);
  assert.deepEqual(
    sorted.map((r) => r.date),
    ["2026-10-10", "2026-10-09"],
  );
});

test("sortNewestFirst: não muda a lista recebida e devolve uma cópia", () => {
  const input = [row(1, "2026-01-01"), row(2, "2026-02-01")];
  const snapshot = JSON.stringify(input);
  const sorted = sortNewestFirst(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(sorted, input);
});

test("sortNewestFirst: lista vazia", () => {
  assert.deepEqual(sortNewestFirst([]), []);
});

test("sortNewestFirst: preserva os outros campos", () => {
  const [first] = sortNewestFirst([
    { id: 1, date: "2026-01-01", title: "a" },
    { id: 2, date: "2026-02-01", title: "b" },
  ]);
  assert.equal(first.title, "b");
});

// ── A tela ───────────────────────────────────────────────────────────────

const PAGE = "../routes/transacoes.tsx";
const page = () => fn(read(PAGE), "TransacoesPage");

test("o período vai na URL, validado como no Dashboard, ao lado da aba", () => {
  const src = read(PAGE);
  assert.match(src, /parsePeriodParam\(/);
  assert.match(src, /periodo\?: string/);
  assert.match(src, /aba\?: Aba/);
});

test("há um <PeriodFilter> ligado à URL", () => {
  assert.match(
    read(PAGE),
    /import \{ PeriodFilter \} from "@\/components\/shared\/PeriodFilter";/,
  );
  const src = page();
  assert.match(src, /<PeriodFilter\b/);
  assert.match(src, /periodSearch\(/);
});

test("a consulta leva o período no queryKey e na chamada, e o padrão é o mês corrente", () => {
  const src = page();
  assert.match(
    src,
    /queryKey: \["transactions",[^\]]*(periodo|period|key)[^\]]*\]/,
  );
  assert.match(src, /\?period=\$\{/);
  assert.match(src, /currentMonthKey\(\)/);
  // O histórico inteiro sem recorte era o defeito: não pode voltar.
  assert.doesNotMatch(
    src,
    /queryFn: \(\) => api\.get<Transaction\[\]>\(TRANSACTIONS_ENDPOINT\)/,
  );
});

test("trocar de período mantém a lista até a nova chegar", () => {
  assert.match(page(), /placeholderData: \(previous\) => previous/);
});

test("a lista exibida é ordenada da mais nova para a mais antiga", () => {
  assert.match(read(PAGE), /sortNewestFirst/);
  assert.match(page(), /sortNewestFirst\(/);
});

test("trocar a aba preserva o período, e trocar o período preserva a aba", () => {
  const src = page();
  assert.match(src, /search: \(prev\) => \(\{ \.\.\.prev,/);
});

test("o vazio diz o período, não só 'nenhuma transação'", () => {
  const src = fn(read(PAGE), "EmptyState");
  assert.match(src, /period/i);
});
