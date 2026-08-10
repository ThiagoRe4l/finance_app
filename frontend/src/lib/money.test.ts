/**
 * `money.ts` — parse e formatação de valores monetários.
 *
 * Escrito **antes** da implementação. Roda com o runner nativo do Node:
 *
 *     node --experimental-strip-types --test src/lib/*.test.ts
 *
 * Vitest não roda neste container: o `node_modules` foi instalado pelo Windows
 * (`@esbuild/win32-x64/esbuild.exe`) e o esbuild recusa rodar em outra
 * plataforma. Decisão registrada no CLAUDE.md; Vitest fica em aberto para
 * quando aparecer a primeira necessidade real de teste de componente.
 *
 * Por que este módulo existe
 * --------------------------
 * O backend passou a devolver dinheiro como **string** JSON (`"450.00"`), e há
 * hoje 5 cópias do mesmo formatador espalhadas pelas telas, todas tipadas
 * `(n: number)`. Este arquivo é o ponto único onde a string vira número.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatBRL, parseMoney } from "./money.ts";

// `Intl` separa símbolo e valor com espaço não-quebrável (U+00A0), não com
// espaço comum. Escrever o literal direto faria o teste falhar por um caractere
// invisível — daí a constante.
const NBSP = " ";

// ---------------------------------------------------------------------------
// parseMoney
// ---------------------------------------------------------------------------

test("parseMoney converte a string da API em número", () => {
  assert.equal(parseMoney("450.00"), 450);
  assert.equal(parseMoney("8450.00"), 8450);
  assert.equal(parseMoney("342.50"), 342.5);
});

test("parseMoney preserva os centavos", () => {
  assert.equal(parseMoney("0.01"), 0.01);
  assert.equal(parseMoney("1234567.89"), 1234567.89);
});

test("parseMoney aceita zero e negativo", () => {
  assert.equal(parseMoney("0.00"), 0);
  assert.equal(parseMoney("-342.50"), -342.5);
});

test("parseMoney rejeita entrada não numérica em vez de devolver NaN", () => {
  /*
   * Falha barulhenta, no estilo do resto do projeto (o 422 de campo proibido, o
   * `money()` do backend que assere o tipo). Devolver `NaN` faria a tela exibir
   * "R$ NaN" sem nada no console — o usuário vê o defeito antes do
   * desenvolvedor.
   */
  assert.throws(() => parseMoney("abc"), /valor monetário/i);
  assert.throws(() => parseMoney(""), /valor monetário/i);
});

test("parseMoney rejeita null e undefined vindos de um campo ausente", () => {
  assert.throws(() => parseMoney(null as unknown as string), /valor monetário/i);
  assert.throws(() => parseMoney(undefined as unknown as string), /valor monetário/i);
});

test("⚠️ parseMoney reintroduz o erro de float — limitação conhecida e deliberada", () => {
  /*
   * Este teste **documenta uma limitação**, não um comportamento desejado.
   *
   * O backend guarda `Decimal` justamente para que 0,10 + 0,20 dê 0,30 exato.
   * Ao converter para `number` do JS, o problema volta — `number` é IEEE 754,
   * igual ao `float` que acabamos de tirar do banco.
   *
   * Isso é aceitável para **exibir**, que é todo o uso da tela de Transações.
   * Não é aceitável para **somar no cliente**, e `parcelamentos.tsx` e
   * `relatorios.tsx` fazem exatamente isso nos mocks. A resposta provável
   * quando essas telas chegarem é usar os totais que o dashboard já devolve
   * prontos, em vez de somar no front — ver a restrição no CLAUDE.md.
   *
   * O teste existe para que ninguém descubra isso por acidente, num número
   * errado em produção.
   */
  assert.notEqual(parseMoney("0.10") + parseMoney("0.20"), 0.3);
  assert.equal(parseMoney("0.10") + parseMoney("0.20"), 0.30000000000000004);
});

// ---------------------------------------------------------------------------
// formatBRL
// ---------------------------------------------------------------------------

test("formatBRL formata a string da API direto", () => {
  assert.equal(formatBRL("450.00"), `R$${NBSP}450,00`);
  assert.equal(formatBRL("8450.00"), `R$${NBSP}8.450,00`);
});

test("formatBRL também aceita number", () => {
  /*
   * Necessário durante a transição: as telas ainda não integradas seguem com
   * mocks em `number`, e valores derivados no front (soma, média) também são
   * `number`. Aceitar os dois evita um `parseMoney` decorativo em cada chamada.
   */
  assert.equal(formatBRL(450), `R$${NBSP}450,00`);
  assert.equal(formatBRL(0), `R$${NBSP}0,00`);
});

test("formatBRL usa a convenção pt-BR: ponto no milhar, vírgula no decimal", () => {
  assert.equal(formatBRL("1234567.89"), `R$${NBSP}1.234.567,89`);
});

test("formatBRL põe o sinal negativo antes do símbolo", () => {
  // pt-BR é "-R$ 342,50", não "R$ -342,50".
  assert.equal(formatBRL("-342.50"), `-R$${NBSP}342,50`);
});

test("formatBRL sempre mostra duas casas", () => {
  assert.equal(formatBRL("100.00"), `R$${NBSP}100,00`);
  assert.equal(formatBRL(100), `R$${NBSP}100,00`);
});

test("formatBRL propaga a rejeição de entrada inválida", () => {
  assert.throws(() => formatBRL("abc"), /valor monetário/i);
});

test("formatBRL rejeita number não finito em vez de exibir 'R$ NaN'", () => {
  /*
   * O caminho `string` já falhava barulhento via `parseMoney`; o caminho
   * `number` não tinha guarda e o `Intl` formata `NaN` como "R$ NaN" e
   * `Infinity` como "R$ ∞" — sem nada no console.
   *
   * Não é hipotético: um `NaN` chegando aqui viria de aritmética no front dando
   * errado, que é exatamente o risco documentado no teste de reintrodução do
   * float. Falhar visível é a mesma postura de `parseMoney`.
   */
  assert.throws(() => formatBRL(Number.NaN), /valor monetário/i);
  assert.throws(() => formatBRL(Number.POSITIVE_INFINITY), /valor monetário/i);
  assert.throws(() => formatBRL(Number.NEGATIVE_INFINITY), /valor monetário/i);
});
