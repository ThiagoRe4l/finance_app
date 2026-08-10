/**
 * `transactions.ts` — derivação de rótulo e sinal a partir da transação da API.
 *
 * Escrito **antes** da implementação. Roda com:
 *
 *     node --experimental-strip-types --test src/lib/*.test.ts
 *
 * Por que este módulo existe
 * --------------------------
 * A API expõe dados crus (`type`, `is_fixed`, `installment`) e **não** duplica
 * lógica de apresentação — decisão registrada no CLAUDE.md. O rótulo
 * Fixa/Variável/Parcelada/Receita é derivado no front.
 *
 * Hoje essa derivação existe em **duas versões que discordam**:
 *
 * * `routes/transacoes.tsx` — `"Fixa" | "Variável" | "Parcelada" | "Receita"`
 * * `components/dashboard/Transactions.tsx` — `"fixa" | "variavel" | ...`
 *   (minúsculo, sem acento) traduzido depois por um `typeLabel`
 *
 * São a mesma regra de negócio escrita duas vezes, com casing diferente. Este
 * módulo é a versão única; as duas telas passam a consumi-lo.
 *
 * Precedência decidida em 10/08/2026
 * ----------------------------------
 * **ENTRADA sempre vence.** Uma entrada fixa ou parcelada — casos que o backend
 * permite e que os mocks nunca exibiram — colapsa para "Receita" **sem meta**.
 * Aceito como v1.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveTransactionLabel, signedAmount } from "./transactions.ts";
import type { Transaction } from "./transactions.ts";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    title: "Lançamento",
    type: "SAÍDA",
    amount: "100.00",
    date: "2026-08-07",
    category: { id: 1, name: "Alimentação", color: "oklch(0.6 0.15 155)", icon_name: "UtensilsCrossed" },
    is_fixed: false,
    account_id: 1,
    installment_id: null,
    installment: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveTransactionLabel — os quatro estados
// ---------------------------------------------------------------------------

test("SAÍDA comum é Variável", () => {
  assert.deepEqual(deriveTransactionLabel(tx()), { label: "Variável", meta: null });
});

test("SAÍDA fixa é Fixa", () => {
  assert.deepEqual(
    deriveTransactionLabel(tx({ is_fixed: true })),
    { label: "Fixa", meta: null },
  );
});

test("SAÍDA parcelada é Parcelada e carrega o progresso", () => {
  const parcela = tx({
    installment_id: 7,
    installment: { current_installment: 2, total_installments: 12 },
  });

  assert.deepEqual(deriveTransactionLabel(parcela), { label: "Parcelada", meta: "2/12" });
});

test("ENTRADA é Receita", () => {
  assert.deepEqual(
    deriveTransactionLabel(tx({ type: "ENTRADA" })),
    { label: "Receita", meta: null },
  );
});

// ---------------------------------------------------------------------------
// Precedência — os casos que os mocks nunca mostraram
// ---------------------------------------------------------------------------

test("ENTRADA fixa continua Receita, não Fixa", () => {
  /*
   * Salário é o caso concreto: recorrente, então plausivelmente cadastrado com
   * `is_fixed: true`. O mock exibia "Salário" como Receita, e a decisão
   * confirma isso — ENTRADA vence `is_fixed`.
   */
  assert.deepEqual(
    deriveTransactionLabel(tx({ type: "ENTRADA", is_fixed: true })),
    { label: "Receita", meta: null },
  );
});

test("ENTRADA parcelada é Receita e descarta o meta", () => {
  /*
   * O backend permite (só proíbe `is_fixed` junto de `installment`). Colapsar
   * para "Receita" **sem** o `2/12` é a decisão de v1: exibir "Receita 2/12"
   * sugeriria uma parcela a pagar, que é o oposto do que uma entrada é.
   */
  const entradaParcelada = tx({
    type: "ENTRADA",
    installment_id: 7,
    installment: { current_installment: 2, total_installments: 12 },
  });

  assert.deepEqual(deriveTransactionLabel(entradaParcelada), { label: "Receita", meta: null });
});

test("SAÍDA parcelada vence is_fixed se os dois vierem juntos", () => {
  /*
   * Estado que o backend rejeita (422 no POST, 400 no PATCH), então não deveria
   * chegar aqui. O teste fixa um comportamento determinístico em vez de deixar
   * a ordem dos `if` decidir por acidente — se um dado antigo ou um seed
   * furarem a regra, a tela mostra "Parcelada", que é a informação mais
   * específica.
   */
  const inconsistente = tx({
    is_fixed: true,
    installment_id: 7,
    installment: { current_installment: 3, total_installments: 6 },
  });

  assert.deepEqual(deriveTransactionLabel(inconsistente), { label: "Parcelada", meta: "3/6" });
});

test("installment_id sem o objeto installment não vira Parcelada", () => {
  /*
   * `installment_id` preenchido com `installment: null` não deveria acontecer —
   * a API serializa a relação junto. Mas quem decide o rótulo é o objeto, não o
   * id: sem o progresso não há `2/12` para exibir, e "Parcelada" sem meta seria
   * pior que "Variável".
   */
  assert.deepEqual(
    deriveTransactionLabel(tx({ installment_id: 7, installment: null })),
    { label: "Variável", meta: null },
  );
});

test("o rótulo usa a grafia da UI, com acento e maiúscula", () => {
  /*
   * Trava a unificação: `Transactions.tsx` usava slugs minúsculos sem acento
   * (`"variavel"`) e traduzia com um `typeLabel` próprio. O derivador devolve o
   * texto final — não sobra segunda tabela de tradução para divergir.
   */
  const labels = [
    deriveTransactionLabel(tx()).label,
    deriveTransactionLabel(tx({ is_fixed: true })).label,
    deriveTransactionLabel(tx({ type: "ENTRADA" })).label,
  ];

  assert.deepEqual(labels, ["Variável", "Fixa", "Receita"]);
});

// ---------------------------------------------------------------------------
// signedAmount — o sinal sai de `type`, não do valor
// ---------------------------------------------------------------------------

test("SAÍDA vira negativo", () => {
  /*
   * A API devolve `amount` **sempre positivo** e o sentido em `type`; os mocks
   * usavam número com sinal (`-2100`). Esta é a ponte entre os dois, e o motivo
   * de as telas não poderem simplesmente trocar `tx.amount` por
   * `parseMoney(tx.amount)`.
   */
  assert.equal(signedAmount(tx({ type: "SAÍDA", amount: "2100.00" })), -2100);
});

test("ENTRADA continua positivo", () => {
  assert.equal(signedAmount(tx({ type: "ENTRADA", amount: "8450.00" })), 8450);
});

test("zero não ganha sinal negativo", () => {
  // `-0` é igual a `0` em `==`, mas `Object.is(-0, 0)` é falso e o Intl
  // formata `-0` como "-R$ 0,00". Um lançamento zerado não pode aparecer
  // negativo na tela.
  assert.ok(Object.is(signedAmount(tx({ type: "SAÍDA", amount: "0.00" })), 0));
});
