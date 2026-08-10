/**
 * Ponto único de conversão e formatação de dinheiro.
 *
 * O backend guarda valores monetários como `Numeric(12, 2)` e o Pydantic os
 * serializa como **string** JSON (`"450.00"`, não `450.5`). Ver "Dinheiro é
 * `Decimal`" no CLAUDE.md.
 *
 * ⚠️ Converter para `number` reintroduz o ponto flutuante que o backend
 * eliminou — `number` é IEEE 754, igual ao `float` que saiu do banco. Isso é
 * aceitável para **exibir**; não é para **somar no cliente**. Ver
 * `money.test.ts`, que fixa a limitação num teste.
 */

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Converte o valor monetário devolvido pela API em `number`.
 *
 * Lança em entrada inválida em vez de devolver `NaN`: `NaN` atravessaria a tela
 * como "R$ NaN", sem nada no console — o usuário veria o defeito antes do
 * desenvolvedor.
 */
export function parseMoney(value: string): number {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`valor monetário inválido: ${JSON.stringify(value)}`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`valor monetário inválido: ${JSON.stringify(value)}`);
  }

  return parsed;
}

/**
 * Formata em BRL.
 *
 * Aceita `number` além de `string` porque as telas ainda não integradas seguem
 * com mocks em `number`, e valores derivados no front (soma, média) também são
 * `number`. Substitui as 5 cópias de `formatBRL`/`formatCurrency` que existiam
 * espalhadas pelas rotas.
 */
export function formatBRL(value: string | number): string {
  const parsed = typeof value === "number" ? value : parseMoney(value);

  // O caminho `string` já falha em `parseMoney`; o `number` precisa da própria
  // guarda. Sem ela o `Intl` formata `NaN` como "R$ NaN" e `Infinity` como
  // "R$ ∞", que chegam à tela sem nada no console.
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`valor monetário inválido: ${JSON.stringify(value)}`);
  }

  return BRL.format(parsed);
}
