/**
 * `installment-form.ts` — validação e derivações do formulário de parcelamento.
 *
 * Escrito **antes** da implementação. Terceiro e último formulário; segue o
 * padrão de `category-form.ts` e `transaction-form.ts`.
 *
 * Três peças que os outros dois não tinham:
 *
 * 1. **`total_amount` derivado.** Os três valores são redundantes e o backend
 *    não valida coerência. `installment_amount` e `total_installments` são
 *    editáveis; o total é calculado e somente-leitura.
 * 2. **`end_date` gerado.** É `String(20)` livre, não data — o seletor mês/ano
 *    monta `"Ago/2026"`, formato que o front assume e o backend não garante.
 * 3. **Parse do 409.** O `detail` cita os campos travados; a UI extrai os nomes
 *    para pintar cada campo, com fallback explícito quando não casa.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveTotalAmount,
  formatEndDate,
  installmentCreateSchema,
  installmentEditSchema,
  parseEndDate,
  parseLockedFields,
  type InstallmentFormInput,
} from "./installment-form.ts";

function input(overrides: Partial<InstallmentFormInput> = {}): InstallmentFormInput {
  return {
    title: "Notebook Dell",
    category_id: "3",
    installment_amount: "450,00",
    current_installment: "2",
    total_installments: "12",
    end_date: "Ago/2026",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveTotalAmount — multiplicação de dinheiro, em centavos inteiros
// ---------------------------------------------------------------------------

test("multiplica parcela por quantidade", () => {
  assert.equal(deriveTotalAmount("450,00", "12"), "5400.00");
  assert.equal(deriveTotalAmount("120,00", "6"), "720.00");
});

test("⚠️ a multiplicação é exata — centavos inteiros, não float", () => {
  /*
   * `0.07 * 3` em ponto flutuante dá `0.21000000000000002`, e
   * `33.33 * 3` dá `99.99000000000001`. É o mesmo risco que o backend eliminou
   * trocando `Float` por `Numeric` — reintroduzi-lo aqui produziria um
   * `total_amount` com centavo a mais no payload.
   */
  assert.equal(deriveTotalAmount("0,07", "3"), "0.21");
  assert.equal(deriveTotalAmount("33,33", "3"), "99.99");
  assert.equal(deriveTotalAmount("0,10", "3"), "0.30");
});

test("aceita a entrada em qualquer forma que o parser aceita", () => {
  assert.equal(deriveTotalAmount("1.500,00", "4"), "6000.00");
  assert.equal(deriveTotalAmount("450", "12"), "5400.00");
});

test("devolve null quando falta ou é inválido", () => {
  // O campo é somente-leitura: sem os dois insumos, mostra vazio em vez de
  // "R$ NaN".
  assert.equal(deriveTotalAmount("", "12"), null);
  assert.equal(deriveTotalAmount("450,00", ""), null);
  assert.equal(deriveTotalAmount("abc", "12"), null);
  assert.equal(deriveTotalAmount("450,00", "0"), null);
  assert.equal(deriveTotalAmount("450,00", "-3"), null);
  assert.equal(deriveTotalAmount("450,00", "1,5"), null);
});

// ---------------------------------------------------------------------------
// end_date — rótulo "Mmm/AAAA", não data
// ---------------------------------------------------------------------------

test("formatEndDate monta o rótulo no formato do seed", () => {
  // As abreviações são as mesmas de `dashboard.py`, duplicadas no front porque
  // não há endpoint que as exponha.
  assert.equal(formatEndDate(8, 2026), "Ago/2026");
  assert.equal(formatEndDate(1, 2026), "Jan/2026");
  assert.equal(formatEndDate(12, 2025), "Dez/2025");
});

test("formatEndDate recusa mês fora do intervalo", () => {
  assert.throws(() => formatEndDate(0, 2026), /mês inválido/i);
  assert.throws(() => formatEndDate(13, 2026), /mês inválido/i);
});

test("parseEndDate lê o rótulo de volta, para popular a edição", () => {
  assert.deepEqual(parseEndDate("Ago/2026"), { month: 8, year: 2026 });
  assert.deepEqual(parseEndDate("Jan/2027"), { month: 1, year: 2027 });
});

test("parseEndDate devolve null no que não segue o formato", () => {
  /*
   * ⚠️ O acoplamento assumido: `end_date` é string livre no backend, então um
   * parcelamento criado por script ou `curl` pode trazer qualquer coisa. `null`
   * é o sinal para o seletor cair num default em vez de quebrar.
   */
  assert.equal(parseEndDate("2026-08-01"), null);
  assert.equal(parseEndDate("agosto de 2026"), null);
  assert.equal(parseEndDate("Xyz/2026"), null);
  assert.equal(parseEndDate(""), null);
});

test("o ciclo formatEndDate -> parseEndDate não perde informação", () => {
  for (let month = 1; month <= 12; month += 1) {
    assert.deepEqual(parseEndDate(formatEndDate(month, 2026)), { month, year: 2026 });
  }
});

// ---------------------------------------------------------------------------
// parseLockedFields — o acoplamento textual com o 409
// ---------------------------------------------------------------------------

test("extrai um campo travado do detail", () => {
  const detail =
    "Parcelamento já possui transações lançadas: installment_amount não pode(m) mais ser alterado(s).";

  assert.deepEqual(parseLockedFields(detail), ["installment_amount"]);
});

test("extrai os três campos travados", () => {
  // Texto real do backend, verificado: vêm ordenados e separados por vírgula.
  const detail =
    "Parcelamento já possui transações lançadas: installment_amount, total_amount, " +
    "total_installments não pode(m) mais ser alterado(s).";

  assert.deepEqual(parseLockedFields(detail), [
    "installment_amount",
    "total_amount",
    "total_installments",
  ]);
});

test("⚠️ devolve lista vazia quando o texto muda — fallback explícito", () => {
  /*
   * Este é o custo do acoplamento assumido: reformular a frase no backend
   * quebra o parse. Lista vazia é o sinal para a tela cair no toast genérico
   * com a mensagem íntegra, em vez de engolir o erro.
   */
  assert.deepEqual(parseLockedFields("Qualquer outra mensagem."), []);
  assert.deepEqual(parseLockedFields(""), []);
  assert.deepEqual(parseLockedFields("Categoria não encontrada."), []);
});

test("ignora nomes que não são campos do formulário", () => {
  // Um `detail` com texto parecido não deve pintar campo que não existe.
  const detail = "Parcelamento já possui transações lançadas: foo, bar não pode(m) mais ser alterado(s).";

  assert.deepEqual(parseLockedFields(detail), []);
});

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

test("create devolve o payload completo, com total_amount derivado", () => {
  const parsed = installmentCreateSchema.parse({ ...input(), account_id: 1 });

  assert.deepEqual(parsed, {
    title: "Notebook Dell",
    category_id: 3,
    installment_amount: "450.00",
    total_amount: "5400.00",
    current_installment: 2,
    total_installments: 12,
    end_date: "Ago/2026",
    account_id: 1,
  });
});

test("create exige account_id", () => {
  const result = installmentCreateSchema.safeParse(input());

  assert.equal(result.success, false);
  assert.ok(result.error!.issues.some((i) => i.path[0] === "account_id"));
});

test("título respeita o limite de 100 — menor que o da transação", () => {
  assert.equal(installmentEditSchema.safeParse(input({ title: "a".repeat(100) })).success, true);
  assert.equal(installmentEditSchema.safeParse(input({ title: "a".repeat(101) })).success, false);
  assert.equal(installmentEditSchema.safeParse(input({ title: "" })).success, false);
});

test("parcela precisa ser maior que zero", () => {
  for (const amount of ["0", "0,00", "-50,00"]) {
    const result = installmentEditSchema.safeParse(input({ installment_amount: amount }));
    assert.equal(result.success, false, amount);
  }
});

test("total de parcelas precisa ser inteiro positivo", () => {
  assert.equal(installmentEditSchema.safeParse(input({ total_installments: "0" })).success, false);
  assert.equal(installmentEditSchema.safeParse(input({ total_installments: "1,5" })).success, false);
  assert.equal(installmentEditSchema.safeParse(input({ total_installments: "" })).success, false);
});

test("parcela atual aceita valor acima do total — é o estado quitado", () => {
  /*
   * Decisão D13: `current > total` é quitado, não erro. Uma validação
   * `current <= total` aqui pareceria defensiva e impediria registrar um
   * parcelamento já encerrado.
   */
  const parsed = installmentEditSchema.parse(input({ current_installment: "13" }));

  assert.equal(parsed.current_installment, 13);
});

test("parcela atual precisa ser pelo menos 1", () => {
  assert.equal(installmentEditSchema.safeParse(input({ current_installment: "0" })).success, false);
  assert.equal(installmentEditSchema.safeParse(input({ current_installment: "-2" })).success, false);
});

test("categoria é obrigatória", () => {
  const result = installmentEditSchema.safeParse(input({ category_id: "" }));

  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /categoria/i);
});

test("end_date precisa estar no formato do rótulo", () => {
  assert.equal(installmentEditSchema.safeParse(input({ end_date: "Ago/2026" })).success, true);
  assert.equal(installmentEditSchema.safeParse(input({ end_date: "2026-08-01" })).success, false);
  assert.equal(installmentEditSchema.safeParse(input({ end_date: "" })).success, false);
});

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------

test("edit nunca inclui account_id, mesmo se vier no input", () => {
  /*
   * `PATCH` responde 422 (`extra="forbid"`) — regra geral: IDs de
   * relacionamento central são imutáveis via PATCH em toda a API.
   */
  const parsed = installmentEditSchema.parse({ ...input(), account_id: 1 });

  assert.equal("account_id" in parsed, false);
});

test("edit manda os três valores, sem prever a trava", () => {
  /*
   * Decidido não adivinhar se estão travados: a API não expõe se há transação
   * vinculada. O formulário envia tudo e transforma o 409 que vier em mensagem
   * inline nos campos citados.
   */
  const parsed = installmentEditSchema.parse(input());

  assert.equal(parsed.installment_amount, "450.00");
  assert.equal(parsed.total_installments, 12);
  assert.equal(parsed.total_amount, "5400.00");
});

test("reporta todos os campos inválidos de uma vez", () => {
  const result = installmentEditSchema.safeParse({
    title: "",
    category_id: "",
    installment_amount: "abc",
    current_installment: "0",
    total_installments: "",
    end_date: "",
  });

  assert.equal(result.success, false);
  const campos = [...new Set(result.error!.issues.map((i) => i.path[0]))].sort();
  assert.deepEqual(campos, [
    "category_id",
    "current_installment",
    "end_date",
    "installment_amount",
    "title",
    "total_installments",
  ]);
});
