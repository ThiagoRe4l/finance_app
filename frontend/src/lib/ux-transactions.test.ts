/**
 * Leis da UX no lançamento e na lista de transações (`docs/ux-leis.md`: Q5, M1,
 * M2, M4).
 *
 * Escrito **antes** da implementação — vermelho de propósito.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as tx from "./transactions.ts";
import * as form from "./transaction-form.ts";
import { formatBRL } from "./money.ts";

// --- directionOf (M4): a cor não é a única pista -----------------------------

test("directionOf: entrada tem '+' e leitor de tela diz Entrada", () => {
  assert.deepEqual(tx.directionOf("ENTRADA"), {
    sign: "+",
    srLabel: "Entrada",
  });
});

test("directionOf: saída tem o sinal de menos (U+2212) e diz Saída", () => {
  assert.deepEqual(tx.directionOf("SAÍDA"), { sign: "−", srLabel: "Saída" });
});

// --- savedToastMessage (Q5): o final do fluxo diz o que aconteceu -------------

test("savedToastMessage: saída criada diz tipo e valor", () => {
  assert.equal(
    form.savedToastMessage({
      type: "SAÍDA",
      amount: "50.00",
      isEditing: false,
    }),
    `Saída de ${formatBRL("50.00")} salva.`,
  );
});

test("savedToastMessage: entrada criada, com milhar em pt-BR", () => {
  assert.equal(
    form.savedToastMessage({
      type: "ENTRADA",
      amount: "1500.00",
      isEditing: false,
    }),
    `Entrada de ${formatBRL("1500.00")} salva.`,
  );
});

test("savedToastMessage: edição mantém a frase de antes", () => {
  assert.equal(
    form.savedToastMessage({ type: "SAÍDA", amount: "50.00", isEditing: true }),
    "Transação atualizada.",
  );
});

// --- shouldOpenMoreOptions (M2): o raro fica recolhido ------------------------

test("shouldOpenMoreOptions: criação limpa fica recolhida", () => {
  assert.equal(
    form.shouldOpenMoreOptions({
      isEditing: false,
      is_fixed: false,
      installment_id: "",
    }),
    false,
  );
});

test("shouldOpenMoreOptions: abre se a despesa já é fixa", () => {
  assert.equal(
    form.shouldOpenMoreOptions({
      isEditing: true,
      is_fixed: true,
      installment_id: "",
    }),
    true,
  );
});

test("shouldOpenMoreOptions: abre se há parcelamento escolhido ou vinculado", () => {
  assert.equal(
    form.shouldOpenMoreOptions({
      isEditing: false,
      is_fixed: false,
      installment_id: "7",
    }),
    true,
  );
  assert.equal(
    form.shouldOpenMoreOptions({
      isEditing: true,
      is_fixed: false,
      installment_id: "",
      linkedToInstallment: true,
    }),
    true,
  );
});

// --- initialFocusTarget (M1): foco no valor, só com ponteiro fino ------------

test("initialFocusTarget: com mouse o foco vai para o valor", () => {
  assert.equal(form.initialFocusTarget({ coarsePointer: false }), "amount");
});

test("initialFocusTarget: no toque o foco fica no diálogo (M-12)", () => {
  assert.equal(form.initialFocusTarget({ coarsePointer: true }), "dialog");
});
