/**
 * Contrato sobre arquivo da reorganização entrada × saída (T-3 a T-5,
 * `docs/integracao-frontend.md`).
 *
 * Escrito **antes** da implementação. O comportamento do formulário é coberto
 * pelos testes de componente (`TransactionFormDialog.test.tsx`); aqui ficam as
 * ligações que nenhum render exercita: quem usa a máscara, o que saiu do
 * Dashboard e como as listas se separam.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fn } from "./jsx-source.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const DASHBOARD = "../routes/index.tsx";
const PAGE = "../routes/transacoes.tsx";
const RECENT = "../components/dashboard/Transactions.tsx";
const MONEY_INPUT = "../components/shared/MoneyInput.tsx";

// ── T-3: a máscara vale no sistema todo ──────────────────────────────────

const MONEY_DIALOGS: [string, string][] = [
  ["../components/transactions/TransactionFormDialog.tsx", 'id="tx-amount"'],
  ["../components/installments/InstallmentFormDialog.tsx", 'id="inst-amount"'],
  ["../components/subscriptions/SubscriptionFormDialog.tsx", 'id="sub-amount"'],
  ["../components/categories/CategoryFormDialog.tsx", 'id="category-budget"'],
];

for (const [file, id] of MONEY_DIALOGS) {
  test(`${file.split("/").pop()}: o campo de valor usa o MoneyInput`, () => {
    const src = read(file);
    assert.match(
      src,
      /import \{ MoneyInput \} from "@\/components\/shared\/MoneyInput";/,
    );
    const at = src.indexOf(id);
    assert.ok(at >= 0, `sem ${id}`);
    const tagStart = src.lastIndexOf("<", at);
    assert.match(src.slice(tagStart, tagStart + 12), /^<MoneyInput\b/);
    // O campo antigo, livre e com vírgula digitada à mão, não volta.
    assert.doesNotMatch(src, /inputMode="decimal"/);
  });
}

test("MoneyInput: só dígitos, teclado numérico, placeholder R$ 0,00, 16 px no celular", () => {
  const src = read(MONEY_INPUT);
  assert.match(src, /export function MoneyInput\b/);
  assert.match(src, /maskMoney\(/);
  assert.match(src, /inputMode="numeric"/);
  assert.match(src, /placeholder="R\$ 0,00"/);
  // O `Input` do shadcn já traz `text-base md:text-sm` (P3): o MoneyInput não
  // põe classe de fonte própria.
  assert.doesNotMatch(src, /className=/);
});

test("os formulários que editam valor o preenchem com decimalToMask", () => {
  for (const file of [
    "../components/transactions/TransactionFormDialog.tsx",
    "../components/subscriptions/SubscriptionFormDialog.tsx",
    "../components/categories/CategoryFormDialog.tsx",
  ]) {
    assert.match(read(file), /decimalToMask\(/, file);
  }
});

// ── T-4: criar só em Transações ──────────────────────────────────────────

test("Dashboard: sai o botão, o flutuante e o formulário de nova transação", () => {
  const src = read(DASHBOARD);
  assert.doesNotMatch(src, /TransactionFormDialog/);
  assert.doesNotMatch(src, /FloatingActionButton/);
  assert.doesNotMatch(src, /Nova transação/);
  assert.doesNotMatch(src, /setIsCreating|isCreating/);
  assert.doesNotMatch(src, /\bPlus\b/);
});

test("Transações: o Nova e o flutuante abrem o formulário já no tipo da aba", () => {
  const src = fn(read(PAGE), "TransacoesPage");
  assert.match(src, /<TransactionFormDialog[^>]*defaultType=\{/s);
  assert.match(src, /<FloatingActionButton/);
});

// ── T-5: listas separadas ────────────────────────────────────────────────

test("Transações: abas Entradas e Saídas, a aba vai na URL", () => {
  const src = read(PAGE);
  assert.match(src, /validateSearch/);
  assert.match(src, /aba/);
  assert.match(src, /<TabsTrigger[^>]*value="entradas"[^>]*>\s*Entradas\s*</s);
  assert.match(src, /<TabsTrigger[^>]*value="saidas"[^>]*>\s*Saídas\s*</s);
  // Alvo de toque dos gatilhos, como em /recorrencias.
  for (const m of src.matchAll(/<TabsTrigger\b[^>]*>/gs)) {
    assert.match(m[0], /h-11 sm:h-9/, m[0]);
  }
});

test("Transações: a lista mostra só o tipo da aba", () => {
  const src = fn(read(PAGE), "TransacoesPage");
  assert.match(src, /t\.type === /);
});

test("Transações: o vazio diz entrada ou saída", () => {
  const src = fn(read(PAGE), "EmptyState");
  assert.match(src, /entrada/i);
  assert.match(src, /saída/i);
});

test("Dashboard, recentes: duas listas, Entradas e Saídas, separadas por type", () => {
  const src = read(RECENT);
  assert.match(src, /type === "ENTRADA"/);
  assert.match(src, /type === "SAÍDA"/);
  assert.match(src, /title="Entradas"/);
  assert.match(src, /title="Saídas"/);
});
