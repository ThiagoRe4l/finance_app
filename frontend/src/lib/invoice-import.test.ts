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
  bankLabel,
  buildConfirmPayload,
  canCreateInstallment,
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
    installment_match: null,
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

// ---------------------------------------------------------------------------
// D-Import-7 e D-Import-8 (12/11/2026), escritos antes da implementação
// ---------------------------------------------------------------------------

test("rótulo do banco avisa que o leitor ainda não foi verificado", () => {
  assert.equal(
    bankLabel("itau"),
    "Fatura do Itaú (leitor ainda não verificado com fatura real)",
  );
  assert.equal(
    bankLabel("nubank"),
    "Fatura do Nubank (leitor ainda não verificado com fatura real)",
  );
  assert.equal(
    bankLabel("mercado_pago"),
    "Fatura do Mercado Pago (leitor ainda não verificado com fatura real)",
  );
  assert.equal(bankLabel("generic"), "Banco não reconhecido: leitor genérico");
});

test("parcela casada sem transação vai vinculada ao parcelamento", () => {
  const rows = initialRows([
    item({
      suggested_category_id: 2,
      installment_hint: { current: 3, total: 10 },
      installment_match: {
        installment_id: 7,
        installment_title: "Magazine",
        transaction_id: null,
      },
    }),
  ]);
  const result = buildConfirmPayload(9, rows);
  assert.equal(result.ok, true);
  const [sent] = (result.ok && result.payload.items) || [];
  assert.equal(sent.installment_id, 7);
  assert.equal(sent.installment_number, 3);
  assert.equal("create_installment" in sent, false);
});

test("linha com parcela sem parcelamento só cria se o usuário marcar", () => {
  const rows = initialRows([
    item({
      suggested_category_id: 2,
      installment_hint: { current: 3, total: 10 },
    }),
  ]);
  assert.equal(rows[0].create_installment, false);
  let result = buildConfirmPayload(9, rows);
  assert.equal(
    "create_installment" in ((result.ok && result.payload.items[0]) || {}),
    false,
  );

  rows[0].create_installment = true;
  result = buildConfirmPayload(9, rows);
  const [sent] = (result.ok && result.payload.items) || [];
  assert.equal(sent.create_installment, true);
  assert.equal(sent.installment_current, 3);
  assert.equal(sent.installment_total, 10);
});

test("canCreateInstallment: só saída com parcela e sem parcelamento casado", () => {
  assert.equal(
    canCreateInstallment(item({ installment_hint: { current: 1, total: 2 } })),
    true,
  );
  assert.equal(canCreateInstallment(item()), false);
  assert.equal(
    canCreateInstallment(
      item({ type: "ENTRADA", installment_hint: { current: 1, total: 2 } }),
    ),
    false,
  );
  assert.equal(
    canCreateInstallment(
      item({
        installment_hint: { current: 1, total: 2 },
        installment_match: {
          installment_id: 1,
          installment_title: "x",
          transaction_id: 5,
        },
      }),
    ),
    false,
  );
});
