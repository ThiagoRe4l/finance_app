/**
 * `installment-form.ts` — validação do formulário de parcelamento.
 *
 * **Reescrito em 11/11/2026 (issue #4), antes da implementação.** A decisão
 * está em `docs/design-patterns.md` → "Parcelamento gera as próprias
 * transações" (P-3 a P-5). A aprovação foi delegada pelo usuário nesta data.
 *
 * O que mudou em relação à versão anterior, e por quê:
 *
 * * **Sai o `total_amount` derivado no cliente** (`deriveTotalAmount`). Agora o
 *   usuário informa o valor da parcela **ou** o total, e a divisão com a sobra
 *   de centavos é do backend, em `Decimal`. A tela mostra o resultado de
 *   `POST /installments/preview`: o front não divide dinheiro.
 * * **Saem mês e ano final** (`formatEndDate`/`parseEndDate`): o término é
 *   calculado no backend a partir da data da parcela atual.
 * * **Sai o parse do 409** (`parseLockedFields`): a edição deixa de enviar os
 *   valores travados pela D15. Todo parcelamento novo nasce com parcelas, então
 *   valor e quantidade só mudam excluindo e recriando.
 * * **No cadastro, parcela atual ≤ quantidade** (o critério da issue). Na
 *   edição, `current > total` continua sendo o "quitado" da D13.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  installmentCreateSchema,
  installmentEditSchema,
  schedulePreviewPayload,
  type InstallmentFormInput,
} from "./installment-form.ts";

function input(
  overrides: Partial<InstallmentFormInput> = {},
): InstallmentFormInput {
  return {
    title: "Notebook Dell",
    category_id: "3",
    amount_mode: "installment",
    amount: "450,00",
    current_installment: "2",
    total_installments: "12",
    current_due_date: "2026-11-10",
    ...overrides,
  };
}

function errorsOf(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  assert.equal(result.success, false);
  return Object.fromEntries(
    result.error!.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

// ---------------------------------------------------------------------------
// Cadastro — valor da parcela OU valor total
// ---------------------------------------------------------------------------

test("cadastro pelo valor da parcela manda installment_amount e não total_amount", () => {
  const result = installmentCreateSchema.safeParse({
    ...input(),
    account_id: 7,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    title: "Notebook Dell",
    category_id: 3,
    installment_amount: "450.00",
    current_installment: 2,
    total_installments: 12,
    current_due_date: "2026-11-10",
    account_id: 7,
  });
});

test("cadastro pelo valor total manda total_amount e não installment_amount", () => {
  const result = installmentCreateSchema.safeParse({
    ...input({ amount_mode: "total", amount: "1.000,00" }),
    account_id: 7,
  });
  assert.equal(result.success, true);
  const data = result.data as Record<string, unknown>;
  assert.equal(data.total_amount, "1000.00");
  assert.equal("installment_amount" in data, false);
});

test("nenhum campo de término é enviado — o backend calcula", () => {
  const result = installmentCreateSchema.safeParse({
    ...input(),
    account_id: 7,
  });
  assert.equal(result.success, true);
  for (const key of ["end_date", "end_month", "end_year"]) {
    assert.equal(key in result.data!, false, key);
  }
});

test("valor precisa ser maior que zero e em formato válido", () => {
  for (const amount of ["", "abc", "0", "0,00"]) {
    const errors = errorsOf(
      installmentCreateSchema.safeParse({
        ...input({ amount }),
        account_id: 7,
      }),
    );
    assert.ok(errors.amount, `"${amount}" deveria ser recusado`);
  }
});

test("parcela atual não pode passar da quantidade no cadastro (issue #4)", () => {
  const errors = errorsOf(
    installmentCreateSchema.safeParse({
      ...input({ current_installment: "13", total_installments: "12" }),
      account_id: 7,
    }),
  );
  assert.match(errors.current_installment, /maior que a quantidade/);
});

test("quantidade de parcelas entre 1 e 120", () => {
  for (const total of ["0", "121", "abc", "1,5"]) {
    const errors = errorsOf(
      installmentCreateSchema.safeParse({
        ...input({ total_installments: total, current_installment: "1" }),
        account_id: 7,
      }),
    );
    assert.ok(errors.total_installments, `"${total}" deveria ser recusado`);
  }
});

test("parcela atual precisa ser pelo menos 1", () => {
  const errors = errorsOf(
    installmentCreateSchema.safeParse({
      ...input({ current_installment: "0" }),
      account_id: 7,
    }),
  );
  assert.ok(errors.current_installment);
});

test("data da parcela atual é obrigatória e ISO", () => {
  for (const current_due_date of ["", "10/11/2026", "2026-13-01"]) {
    const errors = errorsOf(
      installmentCreateSchema.safeParse({
        ...input({ current_due_date }),
        account_id: 7,
      }),
    );
    assert.ok(
      errors.current_due_date,
      `"${current_due_date}" deveria ser recusado`,
    );
  }
});

test("cadastro exige account_id e categoria", () => {
  const errors = errorsOf(
    installmentCreateSchema.safeParse({ ...input({ category_id: "" }) }),
  );
  assert.ok(errors.account_id);
  assert.ok(errors.category_id);
});

test("título respeita o limite de 100", () => {
  const errors = errorsOf(
    installmentCreateSchema.safeParse({
      ...input({ title: "A".repeat(101) }),
      account_id: 7,
    }),
  );
  assert.ok(errors.title);
});

// ---------------------------------------------------------------------------
// Pré-visualização — só monta o payload; a conta é do backend
// ---------------------------------------------------------------------------

test("preview monta o payload do cronograma quando os campos estão completos", () => {
  assert.deepEqual(
    schedulePreviewPayload(
      input({
        amount_mode: "total",
        amount: "100,00",
        total_installments: "3",
        current_installment: "1",
      }),
    ),
    {
      total_amount: "100.00",
      current_installment: 1,
      total_installments: 3,
      current_due_date: "2026-11-10",
    },
  );
});

test("preview devolve null enquanto falta ou está inválido — sem requisição", () => {
  assert.equal(schedulePreviewPayload(input({ amount: "" })), null);
  assert.equal(schedulePreviewPayload(input({ total_installments: "" })), null);
  assert.equal(
    schedulePreviewPayload(input({ current_installment: "13" })),
    null,
  );
  assert.equal(schedulePreviewPayload(input({ current_due_date: "" })), null);
});

// ---------------------------------------------------------------------------
// Edição — só o que não mexe no cronograma
// ---------------------------------------------------------------------------

test("edição manda título, categoria e parcela atual — nunca valores nem conta", () => {
  const result = installmentEditSchema.safeParse({
    ...input(),
    account_id: 7,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    title: "Notebook Dell",
    category_id: 3,
    current_installment: 2,
  });
});

test("edição aceita parcela atual acima do total — é o quitado da D13", () => {
  const result = installmentEditSchema.safeParse(
    input({ current_installment: "13", total_installments: "12" }),
  );
  assert.equal(result.success, true);
  assert.equal(result.data!.current_installment, 13);
});
