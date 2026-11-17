/**
 * O widget de recorrências do Dashboard — R-7 (`docs/recorrencias.md`).
 *
 * Escrito **antes** da implementação (13/11/2026), teste sobre arquivo. Hoje fica
 * vermelho: o widget ainda é "Parcelamentos" e só lê os campos de parcelamento.
 * O total vem pronto do backend; o front não soma dinheiro.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const INDEX = read("../routes/index.tsx");

test("o resumo do Dashboard declara os três campos novos", () => {
  assert.match(INDEX, /active_subscriptions_count: number;/);
  assert.match(INDEX, /monthly_subscriptions_amount: string;/);
  assert.match(INDEX, /monthly_recurring_amount: string;/);
});

const CARD = read("../components/dashboard/RecurringCard.tsx");

test("o widget é de Recorrências, com parcelamentos, assinaturas e o total do backend", () => {
  // Extraído para `RecurringCard` em 13/11/2026 (`docs/tema.md`, D-Tema-7).
  assert.match(CARD, /title="Recorrências"/);
  for (const label of ["Parcelamentos", "Assinaturas", "Comprometido"]) {
    assert.ok(CARD.includes(label), `sem a linha ${label}`);
  }
  assert.match(INDEX, /active_installments_count/);
  assert.match(INDEX, /active_subscriptions_count/);
  assert.match(INDEX, /monthlyAmount=\{data\.monthly_recurring_amount\}/);
  assert.match(CARD, /formatBRL\(monthlyAmount\)/);
});

test("o front não soma dinheiro: o total não é montado a partir das duas partes", () => {
  assert.doesNotMatch(
    INDEX,
    /monthly_committed_amount[^;\n]*\+[^;\n]*monthly_subscriptions_amount/,
  );
  assert.doesNotMatch(INDEX, /parseMoney\(|parseFloat\(|\.reduce\(/);
  assert.doesNotMatch(CARD, /parseMoney\(|parseFloat\(|\.reduce\(/);
});

test("o valor do total não quebra nem é cortado (M-13)", () => {
  const at = CARD.indexOf("formatBRL(monthlyAmount)");
  assert.ok(at > 0);
  const row = CARD.slice(Math.max(0, at - 220), at + 80);
  assert.match(row, /tabular-nums/);
  assert.match(row, /whitespace-nowrap/);
});
