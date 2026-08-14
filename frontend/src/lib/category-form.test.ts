/**
 * `category-form.ts` — validação do formulário de categoria.
 *
 * Escrito **antes** da implementação. Primeiro schema `zod` do projeto: define
 * o padrão que os formulários de transação e parcelamento vão seguir.
 *
 * O schema **transforma**, não só valida: recebe o que o formulário coleta
 * (tudo string) e devolve o payload que a API espera — com `budget` já em
 * decimal canônico. Assim o componente não faz conversão nenhuma, e o teste
 * cobre a ponta a ponta sem tocar em JSX.
 *
 * `zod ^3.25`, `react-hook-form ^7.71` e `@hookform/resolvers` já estavam
 * instalados desde a geração no Lovable, e nunca haviam sido usados.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { categoryFormSchema, type CategoryFormInput } from "./category-form.ts";

function input(overrides: Partial<CategoryFormInput> = {}): CategoryFormInput {
  return {
    name: "Alimentação",
    icon_name: "UtensilsCrossed",
    color: "oklch(0.6 0.15 155)",
    budget: "1.500,00",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Caminho feliz — o schema devolve o payload da API
// ---------------------------------------------------------------------------

test("converte o formulário no payload da API", () => {
  const parsed = categoryFormSchema.parse(input());

  assert.deepEqual(parsed, {
    name: "Alimentação",
    icon_name: "UtensilsCrossed",
    color: "oklch(0.6 0.15 155)",
    budget: "1500.00",
  });
});

test("budget sai em decimal canônico, nunca em number", () => {
  /*
   * O campo é string do começo ao fim. Converter para `number` no meio
   * reintroduziria o float que o backend eliminou — e `budget` é justamente o
   * denominador da barra de progresso da tela.
   */
  const parsed = categoryFormSchema.parse(input({ budget: "1.234.567,89" }));

  assert.equal(parsed.budget, "1234567.89");
  assert.equal(typeof parsed.budget, "string");
});

test("apara espaços do nome", () => {
  assert.equal(categoryFormSchema.parse(input({ name: "  Lazer  " })).name, "Lazer");
});

// ---------------------------------------------------------------------------
// name
// ---------------------------------------------------------------------------

test("nome é obrigatório", () => {
  const result = categoryFormSchema.safeParse(input({ name: "" }));

  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /nome/i);
});

test("nome só com espaços também é vazio", () => {
  // Sem o `trim` antes do `min`, "   " passaria e o backend gravaria em branco.
  assert.equal(categoryFormSchema.safeParse(input({ name: "   " })).success, false);
});

test("nome respeita o limite de 50 do backend", () => {
  /*
   * `String(50)` no model. Validar aqui transforma um 422 depois do submit em
   * mensagem inline antes dele.
   */
  assert.equal(categoryFormSchema.safeParse(input({ name: "a".repeat(50) })).success, true);
  assert.equal(categoryFormSchema.safeParse(input({ name: "a".repeat(51) })).success, false);
});

// ---------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------

test("budget vazio vira 0,00 — categoria sem orçamento é estado válido", () => {
  /*
   * `budget` é opcional no `CategoryCreate` e a categoria `Receita` do seed usa
   * `"0.00"`. A tela já sabe exibir "sem orçamento definido" nesse caso.
   */
  assert.equal(categoryFormSchema.parse(input({ budget: "" })).budget, "0.00");
});

test("budget negativo é recusado", () => {
  /*
   * O backend aceita (não há `ge=0` no schema), mas `categoryProgress` trata
   * negativo como "sem orçamento" — deixar entrar criaria um estado que a tela
   * não sabe explicar.
   */
  const result = categoryFormSchema.safeParse(input({ budget: "-100,00" }));

  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /negativ/i);
});

test("budget com texto inválido é recusado com mensagem própria", () => {
  const result = categoryFormSchema.safeParse(input({ budget: "abc" }));

  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /valor/i);
});

test("budget recusa ponto como decimal, como o parser", () => {
  // Coerente com `parseMoneyInput`: "1500.50" viraria 150050 se interpretado
  // como milhar. Recusa explícita em vez de erro silencioso de 100×.
  assert.equal(categoryFormSchema.safeParse(input({ budget: "1500.50" })).success, false);
});

// ---------------------------------------------------------------------------
// icon_name e color
// ---------------------------------------------------------------------------

test("icon_name precisa estar no mapa de ícones", () => {
  /*
   * `icon_name` é string livre no backend, e um nome fora do mapa renderiza o
   * `CircleDashed` de fallback — sem erro, mas com a categoria parecendo
   * genérica. Como o formulário usa um seletor com lista fechada, validar aqui
   * impede que um valor digitado à mão vaze.
   */
  assert.equal(categoryFormSchema.safeParse(input({ icon_name: "Wallet" })).success, true);

  const result = categoryFormSchema.safeParse(input({ icon_name: "NaoExiste" }));
  assert.equal(result.success, false);
  assert.match(result.error!.issues[0].message, /ícone/i);
});

test("cor é obrigatória", () => {
  assert.equal(categoryFormSchema.safeParse(input({ color: "" })).success, false);
});

test("cor respeita o limite de 50 do backend", () => {
  assert.equal(categoryFormSchema.safeParse(input({ color: "a".repeat(51) })).success, false);
});

// ---------------------------------------------------------------------------
// Erros agregados
// ---------------------------------------------------------------------------

test("reporta todos os campos inválidos de uma vez", () => {
  /*
   * `react-hook-form` pinta os erros campo a campo. Um schema que parasse no
   * primeiro faria o usuário descobrir os problemas um por submit.
   */
  const result = categoryFormSchema.safeParse({
    name: "",
    icon_name: "NaoExiste",
    color: "",
    budget: "abc",
  });

  assert.equal(result.success, false);
  const campos = result.error!.issues.map((i) => i.path[0]);
  assert.deepEqual([...campos].sort(), ["budget", "color", "icon_name", "name"]);
});
