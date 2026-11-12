/**
 * `invoice-import.ts` — a parte pura da tela "Importar fatura".
 *
 * Escrito **antes** da implementação (11/11/2026); aprovação delegada pelo
 * usuário nesta data. Decisões em `docs/importacao-fatura.md`.
 *
 * A tela recebe as linhas de `POST /imports/invoice/preview`, deixa o usuário
 * marcar e escolher categoria, e monta o corpo do `confirm`. Nenhuma conta de
 * dinheiro: o valor vai como veio da API.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildConfirmPayload,
  initialRows,
  importResultMessage,
  invoicePreviewPath,
  type InvoicePreviewItem,
} from "./invoice-import.ts";

function item(overrides: Partial<InvoicePreviewItem> = {}): InvoicePreviewItem {
  return {
    date: "2026-11-10",
    title: "PADARIA",
    amount: "12.50",
    type: "SAÍDA",
    installment_hint: null,
    is_payment: false,
    duplicate: false,
    selected: true,
    suggested_category_id: null,
    ...overrides,
  };
}

test("linhas começam com a seleção e a categoria sugeridas pela API", () => {
  const rows = initialRows([
    item({ suggested_category_id: 4 }),
    item({ duplicate: true, selected: false }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.selected, r.category_id]),
    [
      [true, "4"],
      [false, ""],
    ],
  );
});

test("o confirm leva só as marcadas, com valor e data como vieram", () => {
  const rows = initialRows([
    item({ title: "A", suggested_category_id: 4 }),
    item({ title: "B", selected: false, suggested_category_id: 4 }),
    item({
      title: "C",
      type: "ENTRADA",
      amount: "15.00",
      suggested_category_id: 5,
    }),
  ]);
  const result = buildConfirmPayload(9, rows);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.payload, {
    account_id: 9,
    items: [
      {
        date: "2026-11-10",
        title: "A",
        amount: "12.50",
        type: "SAÍDA",
        category_id: 4,
      },
      {
        date: "2026-11-10",
        title: "C",
        amount: "15.00",
        type: "ENTRADA",
        category_id: 5,
      },
    ],
  });
});

test("linha marcada sem categoria impede o confirm e é apontada", () => {
  const rows = initialRows([
    item({ suggested_category_id: 4 }),
    item({ title: "SEM" }),
  ]);
  const result = buildConfirmPayload(9, rows);
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.missingCategory, [1]);
});

test("nenhuma linha marcada não é um confirm válido", () => {
  const rows = initialRows([item({ selected: false })]);
  const result = buildConfirmPayload(9, rows);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.empty, true);
});

test("sem conta não há confirm", () => {
  const result = buildConfirmPayload(
    undefined,
    initialRows([item({ suggested_category_id: 1 })]),
  );
  assert.equal(result.ok, false);
});

test("mensagem do resultado diz o que foi criado e o que foi pulado", () => {
  assert.equal(
    importResultMessage({ created: 3, skipped_duplicates: 0 }),
    "3 transações importadas.",
  );
  assert.equal(
    importResultMessage({ created: 1, skipped_duplicates: 0 }),
    "1 transação importada.",
  );
  assert.equal(
    importResultMessage({ created: 2, skipped_duplicates: 1 }),
    "2 transações importadas; 1 já existia e foi ignorada.",
  );
  assert.equal(
    importResultMessage({ created: 0, skipped_duplicates: 2 }),
    "Nada importado: as 2 já existiam.",
  );
});

test("caminho do preview leva vencimento e conta na query", () => {
  assert.equal(
    invoicePreviewPath("2026-11-20", 9),
    "/imports/invoice/preview?due_date=2026-11-20&account_id=9",
  );
});

test("linha duplicada que o usuário marcou de novo vai com allow_duplicate", () => {
  const rows = initialRows([
    item({
      title: "CAFE",
      duplicate: true,
      selected: false,
      suggested_category_id: 2,
    }),
    item({ title: "PAO", suggested_category_id: 2 }),
  ]);
  rows[0].selected = true;
  const result = buildConfirmPayload(9, rows);
  assert.equal(result.ok, true);
  const items = (result.ok && result.payload.items) || [];
  assert.equal(items[0].allow_duplicate, true);
  assert.equal("allow_duplicate" in items[1], false);
});
