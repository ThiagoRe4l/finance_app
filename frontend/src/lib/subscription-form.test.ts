/**
 * Validação do formulário de assinatura (`docs/recorrencias.md` → R-6).
 *
 * Escrito **antes** da implementação (13/11/2026): vermelho hoje por módulo
 * inexistente. **Nenhuma conta de dinheiro** no front: o valor sai como string
 * decimal, no formato que o backend lê (`Decimal`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  subscriptionCreateSchema,
  subscriptionEditSchema,
} from "./subscription-form.ts";

const valid = {
  title: "  Netflix  ",
  category_id: "3",
  amount: "49,90",
  first_charge_date: "2026-11-15",
  account_id: 1,
};

function messages(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  assert.equal(result.success, false);
  return Object.fromEntries(
    result.error!.issues.map((i) => [String(i.path[0]), i.message]),
  );
}

test("cadastro válido vira o payload do POST, valor como string decimal", () => {
  const result = subscriptionCreateSchema.safeParse(valid);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    title: "Netflix",
    category_id: 3,
    amount: "49.90",
    first_charge_date: "2026-11-15",
    account_id: 1,
  });
});

test("a descrição é obrigatória e tem no máximo 100 caracteres", () => {
  assert.equal(
    messages(subscriptionCreateSchema.safeParse({ ...valid, title: "   " }))
      .title,
    "Informe a descrição.",
  );
  assert.equal(
    messages(
      subscriptionCreateSchema.safeParse({ ...valid, title: "x".repeat(101) }),
    ).title,
    "A descrição deve ter no máximo 100 caracteres.",
  );
});

test("a categoria é obrigatória", () => {
  assert.equal(
    messages(subscriptionCreateSchema.safeParse({ ...valid, category_id: "" }))
      .category_id,
    "Selecione a categoria.",
  );
});

test("o valor tem que ser positivo e legível", () => {
  assert.equal(
    messages(subscriptionCreateSchema.safeParse({ ...valid, amount: "abc" }))
      .amount,
    "Informe um valor válido, como 49,90.",
  );
  assert.equal(
    messages(subscriptionCreateSchema.safeParse({ ...valid, amount: "0" }))
      .amount,
    "O valor deve ser maior que zero.",
  );
});

test("a data da primeira cobrança é obrigatória e tem que existir no calendário", () => {
  const expected = "Selecione a data da primeira cobrança.";
  for (const bad of ["", "15/11/2026", "2026-02-30"]) {
    assert.equal(
      messages(
        subscriptionCreateSchema.safeParse({
          ...valid,
          first_charge_date: bad,
        }),
      ).first_charge_date,
      expected,
      bad,
    );
  }
});

test("sem conta no cadastro: erro próprio, e nunca chuta uma conta", () => {
  const { account_id: _omit, ...withoutAccount } = valid;
  assert.equal(
    messages(subscriptionCreateSchema.safeParse(withoutAccount)).account_id,
    "Conta não encontrada.",
  );
});

test("edição: só título, categoria e valor (a data e a conta não mudam, R-4)", () => {
  const result = subscriptionEditSchema.safeParse({
    title: "Netflix Premium",
    category_id: "4",
    amount: "59,90",
    first_charge_date: "2026-01-01",
    account_id: 9,
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    title: "Netflix Premium",
    category_id: 4,
    amount: "59.90",
  });
});
