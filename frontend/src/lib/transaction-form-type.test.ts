/**
 * Formulário por tipo (T-1, T-2 — `docs/integracao-frontend.md`).
 *
 * Escrito **antes** da implementação.
 *
 * - Entrada não tem parcelamento: o schema de criação recusa.
 * - "Criar novo parcelamento" dentro da saída: `inlineInstallmentInput` monta
 *   a entrada de `installmentCreateSchema`, e o `POST /installments` — que já
 *   grava as parcelas como transações (P-1) — é a única chamada.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NEW_INSTALLMENT,
  inlineInstallmentInput,
  transactionCreateSchema,
  type TransactionFormInput,
} from "./transaction-form.ts";
import { installmentCreateSchema } from "./installment-form.ts";

function values(
  over: Partial<TransactionFormInput> = {},
): TransactionFormInput {
  return {
    title: "Salário",
    type: "ENTRADA",
    amount: "R$ 5.000,00",
    date: "2026-11-05",
    category_id: "3",
    is_fixed: false,
    installment_id: "",
    ...over,
  };
}

test("entrada com parcelamento é recusada, no campo do parcelamento", () => {
  const result = transactionCreateSchema.safeParse({
    ...values({ installment_id: "7" }),
    account_id: 1,
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0].path, ["installment_id"]);
    assert.match(result.error.issues[0].message, /entrada/i);
  }
});

test("✅ entrada sem parcelamento passa, e pode ser fixa (recorrente)", () => {
  // Regressão: já passa hoje — rotulado para não contar como cobertura nova.
  const result = transactionCreateSchema.safeParse({
    ...values({ is_fixed: true }),
    account_id: 1,
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.type, "ENTRADA");
    assert.equal(result.data.is_fixed, true);
    assert.equal(result.data.amount, "5000.00");
    assert.equal("installment_id" in result.data, false);
  }
});

test("✅ saída vinculada a parcelamento existente continua valendo", () => {
  const result = transactionCreateSchema.safeParse({
    ...values({ type: "SAÍDA", installment_id: "7" }),
    account_id: 1,
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok("installment_id" in result.data);
    assert.equal(result.data.installment_id, 7);
  }
});

test("NEW_INSTALLMENT é a opção 'criar novo' e nunca um id", () => {
  assert.equal(typeof NEW_INSTALLMENT, "string");
  assert.equal(/^\d+$/.test(NEW_INSTALLMENT), false);
  assert.notEqual(NEW_INSTALLMENT, "");
});

test("inlineInstallmentInput: valor e data da transação viram parcela e vencimento", () => {
  const input = inlineInstallmentInput(
    values({
      title: "Notebook",
      type: "SAÍDA",
      amount: "R$ 450,00",
      date: "2026-11-20",
      category_id: "4",
      installment_id: NEW_INSTALLMENT,
    }),
    {
      amount_mode: "installment",
      current_installment: "2",
      total_installments: "12",
    },
    9,
  );
  assert.deepEqual(input, {
    title: "Notebook",
    category_id: "4",
    amount_mode: "installment",
    amount: "R$ 450,00",
    current_installment: "2",
    total_installments: "12",
    current_due_date: "2026-11-20",
    account_id: 9,
  });
});

test("o resultado passa por installmentCreateSchema e sai como POST /installments", () => {
  const input = inlineInstallmentInput(
    values({
      title: "Notebook",
      type: "SAÍDA",
      amount: "R$ 5.400,00",
      date: "2026-11-20",
      category_id: "4",
      installment_id: NEW_INSTALLMENT,
    }),
    {
      amount_mode: "total",
      current_installment: "1",
      total_installments: "12",
    },
    9,
  );
  const parsed = installmentCreateSchema.safeParse(input);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    // Total informado: o backend divide (o front não faz conta de dinheiro).
    assert.ok("total_amount" in parsed.data);
    assert.equal(parsed.data.total_amount, "5400.00");
    assert.equal("installment_amount" in parsed.data, false);
    assert.equal(parsed.data.total_installments, 12);
    assert.equal(parsed.data.account_id, 9);
  }
});

test("conta ausente vira erro de validação, não requisição", () => {
  const input = inlineInstallmentInput(
    values({ type: "SAÍDA", installment_id: NEW_INSTALLMENT }),
    {
      amount_mode: "installment",
      current_installment: "1",
      total_installments: "3",
    },
    undefined,
  );
  const parsed = installmentCreateSchema.safeParse(input);
  assert.equal(parsed.success, false);
});
