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


// Convenção pt-BR: grupos de milhar separados por ponto, vírgula decimal com
// até 2 casas. O primeiro grupo tem 1–3 dígitos.
const BR_MONEY = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;

/**
 * Texto digitado pelo usuário → decimal canônico para a API (`"1500.50"`).
 *
 * Caminho inverso de `formatBRL`. Devolve `null` em entrada inválida ou vazia —
 * quem decide o default de campo vazio é o schema do formulário, não o parser:
 * campo obrigatório em branco tem que virar erro de validação, não R$ 0,00
 * calado.
 *
 * É string de ponta a ponta. Passar por `number` no meio reintroduziria o
 * ponto flutuante que o backend eliminou.
 *
 * ⚠️ **`"1500.50"` é recusado, não interpretado.** Em pt-BR o ponto é milhar,
 * então lê-lo assim daria `150050` — erro de duas ordens de grandeza, e
 * silencioso. Mas quem cola de planilha em inglês espera `1500,50`. Como as
 * duas leituras são plausíveis, a entrada é recusada com mensagem em vez de
 * virar outro número. `"1.500"` é grupo de milhar válido e passa.
 */
export function parseMoneyInput(text: string): string | null {
  if (typeof text !== "string") {
    return null;
  }

  // "R$ 1.500,50" colado de outro lugar é comum demais para recusar.
  const cleaned = text.replace(/R\$/gi, "").replace(/\s/g, "").trim();
  if (cleaned === "") {
    return null;
  }

  const match = BR_MONEY.exec(cleaned);
  if (!match) {
    return null;
  }

  const [, sign, integerPart, decimalPart = ""] = match;
  const integer = integerPart.replace(/\./g, "");
  const cents = decimalPart.padEnd(2, "0");

  return `${sign}${integer}.${cents}`;
}
