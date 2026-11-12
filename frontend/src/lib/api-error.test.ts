/**
 * `api-error.ts` — mensagem legível a partir do `detail` da API.
 *
 * Escrito antes da implementação (12/11/2026), a partir da revisão do
 * frontend: um 422 do Pydantic traz `detail` como **lista** de erros, e
 * `new Error(lista)` virava o toast "[object Object]".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { errorMessage } from "./api-error.ts";

test("detail em texto passa como está", () => {
  assert.equal(
    errorMessage({ detail: "Conta não encontrada." }, "Bad Request"),
    "Conta não encontrada.",
  );
});

test("detail em lista (422 do Pydantic) vira as mensagens juntas, nunca [object Object]", () => {
  const body = {
    detail: [
      {
        loc: ["body", "items", 0, "title"],
        msg: "String should have at most 150 characters",
      },
      { loc: ["body", "amount"], msg: "Input should be greater than 0" },
    ],
  };
  assert.equal(
    errorMessage(body, "Unprocessable Entity"),
    "String should have at most 150 characters; Input should be greater than 0",
  );
});

test("sem detail usável cai no texto do status", () => {
  assert.equal(
    errorMessage({}, "Internal Server Error"),
    "Internal Server Error",
  );
  assert.equal(errorMessage(null, "Bad Gateway"), "Bad Gateway");
  assert.equal(
    errorMessage({ detail: [] }, "Unprocessable Entity"),
    "Unprocessable Entity",
  );
  assert.equal(errorMessage({ detail: { x: 1 } }, "Erro"), "Erro");
});
