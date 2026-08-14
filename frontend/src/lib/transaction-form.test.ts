/**
 * `transaction-form.ts` — validação dos formulários de transação.
 *
 * Escrito **antes** da implementação. Segue o padrão firmado em
 * `category-form.ts`: o schema **transforma**, entrando o que o formulário
 * coleta (tudo string) e saindo o payload da API.
 *
 * A diferença em relação a Categorias — e a razão destes testes existirem —
 * é que **criar e editar têm contratos diferentes** no backend:
 *
 * | Campo            | POST                  | PATCH                        |
 * |------------------|-----------------------|------------------------------|
 * | `account_id`     | obrigatório           | **422** (`extra="forbid"`)   |
 * | `installment_id` | opcional, vincula     | só `null` (decisão B6)       |
 *
 * Um único schema serviria aos dois só ignorando essas regras — e o resultado
 * seria 422 depois do submit, ou pior, um `account_id` aceito com 200 sem
 * fazer nada. São dois schemas, e os testes abaixo travam a diferença.
 *
 * Vincular a um parcelamento **só existe na criação**: registrar a parcela do
 * mês é uso corrente, mas depois de criada a transação o vínculo só pode ser
 * desfeito (B6). Criar a transação **não** avança `current_installment` — isso
 * é ação explícita e isolada na tela de Parcelamentos, para não acoplar duas
 * mudanças de estado numa só.
 *
 * `account_id` vem de fora do formulário: não há seletor de conta nem tela de
 * contas, então a tela usa a primeira de `GET /accounts`. Debt registrada no
 * CLAUDE.md — quebra silenciosamente na criação da segunda conta.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  transactionCreateSchema,
  transactionEditSchema,
  type TransactionFormInput,
} from "./transaction-form.ts";

function input(overrides: Partial<TransactionFormInput> = {}): TransactionFormInput {
  return {
    title: "Supermercado",
    type: "SAÍDA",
    amount: "342,50",
    date: "2026-08-07",
    category_id: "3",
    is_fixed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

test("create devolve o payload completo do POST", () => {
  const parsed = transactionCreateSchema.parse({ ...input(), account_id: 1 });

  assert.deepEqual(parsed, {
    title: "Supermercado",
    type: "SAÍDA",
    amount: "342.50",
    date: "2026-08-07",
    category_id: 3,
    is_fixed: false,
    account_id: 1,
  });
});

test("create converte category_id de string para número", () => {
  // O `Select` devolve string; o backend espera `integer` e rejeita "3" com 422.
  const parsed = transactionCreateSchema.parse({ ...input({ category_id: "42" }), account_id: 1 });

  assert.equal(parsed.category_id, 42);
  assert.equal(typeof parsed.category_id, "number");
});

test("create exige account_id", () => {
  const result = transactionCreateSchema.safeParse(input());

  assert.equal(result.success, false);
  assert.ok(result.error!.issues.some((i) => i.path[0] === "account_id"));
});

test("create omite installment_id quando não se vincula", () => {
  /*
   * Omitir é diferente de mandar `null`: o backend trata ausência como "não
   * vincular", e é o caso da esmagadora maioria dos lançamentos.
   */
  const parsed = transactionCreateSchema.parse({ ...input(), account_id: 1 });

  assert.equal("installment_id" in parsed, false);
});

test('create trata "Nenhum" do seletor como ausência', () => {
  // O `Select` devolve string vazia para a opção "Nenhum"; mandá-la ao backend
  // daria 422 por não ser inteiro.
  const parsed = transactionCreateSchema.parse({
    ...input({ installment_id: "" }),
    account_id: 1,
  });

  assert.equal("installment_id" in parsed, false);
});

test("create vincula a um parcelamento existente", () => {
  /*
   * Sem isto, nenhuma transação criada pela UI poderia aparecer como
   * "Parcelada" — e registrar a parcela do mês é uso corrente do app, não caso
   * de borda. O seletor lista os parcelamentos ativos de `GET /installments/`.
   */
  const parsed = transactionCreateSchema.parse({
    ...input({ installment_id: "7" }),
    account_id: 1,
  });

  /*
   * O `in` não é cerimônia: o tipo de saída é uma **união** — com ou sem
   * `installment_id` —, então o TypeScript exige o estreitamento. É a
   * "ausência ≠ null" aparecendo no tipo, não só no valor.
   */
  assert.ok("installment_id" in parsed);
  assert.equal(parsed.installment_id, 7);
  assert.equal(typeof parsed.installment_id, "number");
});

test("create recusa transação fixa E parcelada ao mesmo tempo", () => {
  /*
   * `TransactionCreate.check_fixed_and_installment_exclusive` devolve **422**
   * para essa combinação. Validar aqui transforma o erro pós-submit em
   * mensagem inline — e o formulário deve, além disso, desabilitar um controle
   * quando o outro estiver ativo.
   */
  const result = transactionCreateSchema.safeParse({
    ...input({ installment_id: "7", is_fixed: true }),
    account_id: 1,
  });

  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /fixa e parcelada/i);
});

test("create aceita fixa sem parcelamento, e parcelada sem fixa", () => {
  // As duas pontas do exclusivo: cada uma sozinha é válida.
  assert.equal(
    transactionCreateSchema.safeParse({ ...input({ is_fixed: true }), account_id: 1 }).success,
    true,
  );
  assert.equal(
    transactionCreateSchema.safeParse({
      ...input({ installment_id: "7", is_fixed: false }),
      account_id: 1,
    }).success,
    true,
  );
});

test("create recusa installment_id que não é número", () => {
  const result = transactionCreateSchema.safeParse({
    ...input({ installment_id: "abc" }),
    account_id: 1,
  });

  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Edição — as duas diferenças de contrato
// ---------------------------------------------------------------------------

test("edit nunca inclui account_id, mesmo se vier no input", () => {
  /*
   * O `PATCH` responde **422** a `account_id` (`extra="forbid"`), de propósito:
   * mover transação de conta mexeria em dois saldos. O schema descarta o campo
   * antes de chegar à rede, em vez de deixar o usuário descobrir no submit.
   */
  const parsed = transactionEditSchema.parse({ ...input(), account_id: 1 });

  assert.equal("account_id" in parsed, false);
});

test("edit omite installment_id quando não se pede desvínculo", () => {
  /*
   * `PATCH` é parcial: omitir significa "não toca". Mandar `null` sem o usuário
   * ter pedido desvincularia a parcela silenciosamente.
   */
  const parsed = transactionEditSchema.parse(input());

  assert.equal("installment_id" in parsed, false);
});

test("edit manda installment_id: null quando se pede desvínculo", () => {
  const parsed = transactionEditSchema.parse(input({ unlink_installment: true }));

  assert.ok("installment_id" in parsed);
  assert.equal(parsed.installment_id, null);
});

test("edit nunca produz installment_id diferente de null", () => {
  /*
   * Decisão B6: o vínculo só pode ser **desfeito**. Vincular ou trocar de
   * parcelamento devolve 400. O schema não tem como expressar "vincular" —
   * o campo de entrada é um booleano, não um id.
   */
  for (const unlink of [true, false, undefined]) {
    const parsed = transactionEditSchema.parse(input({ unlink_installment: unlink }));
    if ("installment_id" in parsed) {
      assert.equal(parsed.installment_id, null, `unlink=${unlink}`);
    }
  }
});

test("edit converte os demais campos igual ao create", () => {
  const parsed = transactionEditSchema.parse(input({ amount: "1.500,00" }));

  assert.equal(parsed.amount, "1500.00");
  assert.equal(parsed.category_id, 3);
  assert.equal(parsed.title, "Supermercado");
});

// ---------------------------------------------------------------------------
// Regras comuns aos dois modos
// ---------------------------------------------------------------------------

test("título é obrigatório e respeita o limite de 150", () => {
  assert.equal(transactionEditSchema.safeParse(input({ title: "" })).success, false);
  assert.equal(transactionEditSchema.safeParse(input({ title: "  " })).success, false);
  assert.equal(transactionEditSchema.safeParse(input({ title: "a".repeat(150) })).success, true);
  assert.equal(transactionEditSchema.safeParse(input({ title: "a".repeat(151) })).success, false);
});

test("valor precisa ser maior que zero", () => {
  /*
   * `amount` tem `gt=0` no backend. Zero e negativo viram mensagem inline em
   * vez de 422 depois do submit — o sinal da transação vem de `type`, não do
   * valor.
   */
  for (const amount of ["0", "0,00", "-10,00"]) {
    const result = transactionEditSchema.safeParse(input({ amount }));
    assert.equal(result.success, false, amount);
    assert.match(result.error!.issues[0].message, /maior que zero/i);
  }
});

test("valor inválido é recusado com mensagem própria", () => {
  const result = transactionEditSchema.safeParse(input({ amount: "abc" }));

  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /valor/i);
});

test("tipo só aceita ENTRADA ou SAÍDA", () => {
  assert.equal(transactionEditSchema.safeParse(input({ type: "ENTRADA" })).success, true);
  assert.equal(transactionEditSchema.safeParse(input({ type: "TRANSFERÊNCIA" })).success, false);
  // O backend normaliza para maiúsculo, mas o formulário usa lista fechada:
  // minúsculo aqui indicaria bug de ligação, não digitação do usuário.
  assert.equal(transactionEditSchema.safeParse(input({ type: "saída" })).success, false);
});

test("data precisa vir em ISO", () => {
  /*
   * O picker sempre entrega ISO via `toISODate`. Um "07/08/2026" aqui seria
   * sintoma de o componente ter mandado o texto exibido em vez do valor.
   */
  assert.equal(transactionEditSchema.safeParse(input({ date: "2026-08-07" })).success, true);
  assert.equal(transactionEditSchema.safeParse(input({ date: "07/08/2026" })).success, false);
  assert.equal(transactionEditSchema.safeParse(input({ date: "" })).success, false);
});

test("categoria é obrigatória", () => {
  const result = transactionEditSchema.safeParse(input({ category_id: "" }));

  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /categoria/i);
});

test("is_fixed default é false", () => {
  const { is_fixed, ...rest } = input();
  const parsed = transactionEditSchema.parse(rest as TransactionFormInput);

  assert.equal(parsed.is_fixed, false);
});

test("reporta todos os campos inválidos de uma vez", () => {
  const result = transactionEditSchema.safeParse({
    title: "",
    type: "X",
    amount: "abc",
    date: "",
    category_id: "",
    is_fixed: false,
  });

  assert.equal(result.success, false);
  const campos = [...new Set(result.error!.issues.map((i) => i.path[0]))].sort();
  assert.deepEqual(campos, ["amount", "category_id", "date", "title", "type"]);
});
