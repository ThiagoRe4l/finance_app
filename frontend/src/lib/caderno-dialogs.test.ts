/**
 * Caderno, fatia C5 — popups (`docs/tema.md`, D-Cad-9).
 *
 * Escrito **antes** da implementação (aprovação delegada pelo usuário em
 * 18/11/2026). Função pura da prévia de cobrança mais o contrato sobre os
 * diálogos.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { tagAt, classesIn } from "./jsx-source.ts";
import { chargePreview } from "./subscriptions.ts";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// ── chargePreview ────────────────────────────────────────────────────────

test("chargePreview: dia do mês e a primeira cobrança por extenso", () => {
  assert.equal(
    chargePreview("2026-11-20"),
    "Todo dia 20 · primeira cobrança em 20/11/2026",
  );
});

test("chargePreview: dia sem zero à esquerda, data com", () => {
  assert.equal(
    chargePreview("2026-12-05"),
    "Todo dia 5 · primeira cobrança em 05/12/2026",
  );
});

test("chargePreview: sem data válida não há prévia", () => {
  assert.equal(chargePreview(""), null);
  assert.equal(chargePreview("20/11/2026"), null);
});

// ── Títulos ──────────────────────────────────────────────────────────────

const FORMS = [
  "../components/transactions/TransactionFormDialog.tsx",
  "../components/categories/CategoryFormDialog.tsx",
  "../components/installments/InstallmentFormDialog.tsx",
  "../components/subscriptions/SubscriptionFormDialog.tsx",
  "../components/transactions/ImportInvoiceDialog.tsx",
];

const DELETES = [
  "../components/transactions/DeleteTransactionDialog.tsx",
  "../components/categories/DeleteCategoryDialog.tsx",
  "../components/installments/DeleteInstallmentDialog.tsx",
  "../components/subscriptions/DeleteSubscriptionDialog.tsx",
];

for (const file of FORMS) {
  test(`${file.split("/").pop()}: título em Fraunces`, () => {
    const src = read(file);
    const title = tagAt(src, src.indexOf("<DialogTitle"));
    assert.ok(classesIn(title).includes("font-display"), title);
  });
}

for (const file of DELETES) {
  test(`${file.split("/").pop()}: título em Fraunces, e o nome longo quebra`, () => {
    const src = read(file);
    const title = tagAt(src, src.indexOf("<AlertDialogTitle"));
    assert.ok(classesIn(title).includes("font-display"), title);
    assert.ok(classesIn(title).includes("wrap-anywhere"), title);
  });
}

// ── Formulários ──────────────────────────────────────────────────────────

test("transação: o valor em destaque, sem perder a altura da M-12", () => {
  const src = read(FORMS[0]);
  const at = src.indexOf('id="tx-amount"');
  const input = tagAt(src, src.lastIndexOf("<MoneyInput", at));
  for (const t of ["font-display", "text-xl", "md:text-xl", "h-11", "sm:h-9"]) {
    assert.ok(classesIn(input).includes(t), `${t} fora de ${input}`);
  }
});

test("parcelamento: o resumo em linhas de extrato, valores em Fraunces", () => {
  const src = read(FORMS[2]);
  const dl = src.slice(src.indexOf("<dl"), src.indexOf("</dl>"));
  assert.ok(dl.length > 0, "sem <dl> no resumo");
  assert.ok(
    (dl.match(/<Leader \/>/g) ?? []).length >= 4,
    "linhas sem pontilhado",
  );
  assert.match(dl, /<dd className="[^"]*\bfont-display\b/);
});

test("categoria: prévia do cartão, escondida do leitor de tela, sem conta", () => {
  const src = read(FORMS[1]);
  assert.match(src, /Prévia/);
  // O rótulo visível é a última ocorrência (a primeira é o comentário).
  const at = src.lastIndexOf("Prévia");
  const box = src.slice(src.lastIndexOf('aria-hidden="true"', at) - 200, at);
  assert.match(box, /aria-hidden="true"/);
  assert.match(src, /values\.name \|\| /);
  assert.doesNotMatch(src, /parseMoney\(values\.budget\)/);
});

test("assinatura: a prévia da cobrança só na criação", () => {
  const src = read(FORMS[3]);
  assert.match(src, /chargePreview\(values\.first_charge_date\)/);
  assert.match(src, /!isEditing/);
});
