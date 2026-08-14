/**
 * Validação e derivações do formulário de parcelamento.
 *
 * Terceiro formulário; segue o padrão de `category-form.ts` e
 * `transaction-form.ts`, com três peças que os outros não tinham:
 * `total_amount` derivado, `end_date` como rótulo gerado, e o parse do 409.
 */

import { z } from "zod";

import { parseMoneyInput } from "./money.ts";

/** As mesmas abreviações de `dashboard.py`, duplicadas por não haver endpoint. */
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const END_DATE = /^([A-Z][a-z]{2})\/(\d{4})$/;

/** Campos que o `PATCH` recusa quando há transação lançada (decisão D15). */
export const LOCKABLE_FIELDS = [
  "installment_amount",
  "total_installments",
  "total_amount",
] as const;

export interface InstallmentFormInput {
  title: string;
  category_id: string;
  installment_amount: string;
  current_installment: string;
  total_installments: string;
  end_date: string;
  account_id?: number;
}

/**
 * `installment_amount × total_installments`, em **centavos inteiros**.
 *
 * `450.00 * 12` em ponto flutuante é o mesmo risco que o backend eliminou
 * trocando `Float` por `Numeric`: `0.07 * 3` dá `0.21000000000000002`. Como o
 * campo é somente-leitura, um centavo a mais aqui iria para o payload sem o
 * usuário ter como corrigir.
 *
 * `null` quando falta insumo — o campo mostra vazio em vez de "R$ NaN".
 */
export function deriveTotalAmount(
  installmentAmount: string,
  totalInstallments: string,
): string | null {
  const parsed = parseMoneyInput(installmentAmount);
  return parsed === null ? null : multiplyCanonical(parsed, totalInstallments);
}

/**
 * Multiplica um valor **já canônico** (`"450.00"`) por uma contagem.
 *
 * Separado de `deriveTotalAmount` porque o formato de saída do `parseMoneyInput`
 * não é formato de entrada dele: `"450.00"` usa ponto decimal, que o parser
 * pt-BR recusa de propósito. Passar o valor canônico de volta pelo parser
 * devolvia `null` — e o `total_amount` do payload saía vazio.
 */
function multiplyCanonical(canonical: string, totalInstallments: string): string | null {
  if (!/^\d+$/.test(totalInstallments.trim())) return null;
  const count = Number(totalInstallments);
  if (count <= 0) return null;

  const cents = Math.round(Number(canonical) * 100) * count;
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);

  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** `(8, 2026)` → `"Ago/2026"`. */
export function formatEndDate(month: number, year: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`mês inválido: ${month}`);
  }
  return `${MONTHS[month - 1]}/${year}`;
}

/**
 * `"Ago/2026"` → `{ month: 8, year: 2026 }`.
 *
 * ⚠️ `null` quando não casa. `end_date` é `String(20)` livre no backend, então
 * um parcelamento criado por script pode trazer qualquer coisa — o seletor cai
 * num default em vez de quebrar.
 */
export function parseEndDate(value: string): { month: number; year: number } | null {
  const match = typeof value === "string" ? END_DATE.exec(value.trim()) : null;
  if (!match) return null;

  const month = MONTHS.indexOf(match[1]) + 1;
  return month === 0 ? null : { month, year: Number(match[2]) };
}

/**
 * Extrai do `detail` do 409 os campos que o backend recusou alterar.
 *
 * ⚠️ **Acoplamento textual assumido.** O backend devolve os nomes ordenados e
 * separados por vírgula, e a UI depende dessa frase para pintar cada campo.
 * Reformulá-la lá quebra o parse — daí a lista vazia como fallback explícito:
 * a tela cai no toast genérico com a mensagem íntegra, em vez de engolir o
 * erro. Registrado no CLAUDE.md.
 */
export function parseLockedFields(detail: string): string[] {
  if (typeof detail !== "string") return [];

  const match = /transações lançadas:\s*(.+?)\s*não pode/i.exec(detail);
  if (!match) return [];

  const known = new Set<string>(LOCKABLE_FIELDS);
  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => known.has(name));
}

const positiveInteger = (message: string) =>
  z
    .string()
    .refine((raw) => /^\d+$/.test(raw.trim()) && Number(raw) > 0, message)
    .transform(Number);

const commonFields = {
  title: z
    .string()
    .trim()
    .min(1, "Informe a descrição.")
    // 100 no model, menor que os 150 da transação.
    .max(100, "A descrição deve ter no máximo 100 caracteres."),

  category_id: z
    .string()
    .refine((raw) => /^\d+$/.test(raw), "Selecione a categoria.")
    .transform(Number),

  installment_amount: z
    .string()
    .transform((raw) => parseMoneyInput(raw))
    .refine((parsed) => parsed !== null, "Informe um valor válido, como 450,00.")
    .refine(
      (parsed) => parsed === null || Number(parsed) > 0,
      "O valor da parcela deve ser maior que zero.",
    )
    .transform((parsed) => parsed as string),

  // D13: `current > total` é o estado quitado, não erro. Uma validação
  // `current <= total` pareceria defensiva e impediria registrar um
  // parcelamento já encerrado.
  current_installment: positiveInteger("A parcela atual deve ser 1 ou maior."),

  total_installments: positiveInteger("Informe o número de parcelas."),

  end_date: z
    .string()
    .refine((raw) => parseEndDate(raw) !== null, "Selecione o mês de término."),
};

/** Acrescenta `total_amount` derivado dos dois campos editáveis. */
function withDerivedTotal<T extends { installment_amount: string; total_installments: number }>(
  data: T,
) {
  return {
    ...data,
    // `installment_amount` já passou pelo schema e está canônico — por isso
    // `multiplyCanonical`, não `deriveTotalAmount`.
    total_amount: multiplyCanonical(data.installment_amount, String(data.total_installments))!,
  };
}

export const installmentCreateSchema = z
  .object({
    ...commonFields,
    account_id: z.number({ message: "Conta não encontrada." }).int().positive(),
  })
  .transform(withDerivedTotal);

export const installmentEditSchema = z
  .object(commonFields)
  // `account_id` fica de fora: o `PATCH` responde 422 (`extra="forbid"`), pela
  // regra geral de IDs de relacionamento imutáveis.
  .transform(withDerivedTotal);

export type InstallmentCreatePayload = z.infer<typeof installmentCreateSchema>;
export type InstallmentEditPayload = z.infer<typeof installmentEditSchema>;
