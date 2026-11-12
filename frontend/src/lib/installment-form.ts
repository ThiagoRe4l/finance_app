/**
 * Validação do formulário de parcelamento.
 *
 * Reescrito em 11/11/2026 (issue #4). Decisão em `docs/design-patterns.md` →
 * "Parcelamento gera as próprias transações" (P-3 a P-5).
 *
 * O usuário informa o valor da parcela **ou** o valor total, a quantidade, a
 * parcela atual e a data dela. A divisão (com a sobra de centavos) e o mês de
 * término são do backend: a tela mostra o resultado de
 * `POST /installments/preview`. **Nenhuma conta de dinheiro acontece aqui.**
 */

import { z } from "zod";

import { parseMoneyInput } from "./money.ts";

export type AmountMode = "installment" | "total";

export interface InstallmentFormInput {
  title: string;
  category_id: string;
  /** Se `amount` é o valor da parcela ou o total da compra. */
  amount_mode: AmountMode;
  amount: string;
  current_installment: string;
  total_installments: string;
  /** ISO `AAAA-MM-DD`: vencimento da parcela atual, que ancora o cronograma. */
  current_due_date: string;
  account_id?: number;
}

/** Mesmo teto do backend (P-5): evita gerar milhares de parcelas por engano. */
export const MAX_INSTALLMENTS = 120;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(raw: string): boolean {
  const match = ISO_DATE.exec(raw);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function wholeNumber(raw: string): number | null {
  return /^\d+$/.test(raw.trim()) ? Number(raw) : null;
}

const title = z
  .string()
  .trim()
  .min(1, "Informe a descrição.")
  .max(100, "A descrição deve ter no máximo 100 caracteres.");

const categoryId = z
  .string()
  .refine((raw) => /^\d+$/.test(raw), "Selecione a categoria.")
  .transform(Number);

const currentInstallment = z
  .string()
  .refine(
    (raw) => (wholeNumber(raw) ?? 0) >= 1,
    "A parcela atual deve ser 1 ou maior.",
  )
  .transform(Number);

const totalInstallments = z
  .string()
  .refine((raw) => {
    const n = wholeNumber(raw);
    return n !== null && n >= 1 && n <= MAX_INSTALLMENTS;
  }, `Informe de 1 a ${MAX_INSTALLMENTS} parcelas.`)
  .transform(Number);

const amount = z
  .string()
  .transform((raw) => parseMoneyInput(raw))
  .refine((parsed) => parsed !== null, "Informe um valor válido, como 450,00.")
  .refine(
    (parsed) => parsed === null || Number(parsed) > 0,
    "O valor deve ser maior que zero.",
  )
  .transform((parsed) => parsed as string);

const createFields = z.object({
  title,
  category_id: categoryId,
  amount_mode: z.enum(["installment", "total"]),
  amount,
  current_installment: currentInstallment,
  total_installments: totalInstallments,
  current_due_date: z
    .string()
    .refine(isIsoDate, "Selecione a data da parcela atual."),
  account_id: z.number({ message: "Conta não encontrada." }).int().positive(),
});

/**
 * Payload do `POST /installments`: **um** de `installment_amount`/`total_amount`
 * (P-4), nunca os dois, e nada de término — o backend calcula.
 */
export const installmentCreateSchema = createFields
  .superRefine((data, ctx) => {
    if (data.current_installment > data.total_installments) {
      ctx.addIssue({
        code: "custom",
        path: ["current_installment"],
        message:
          "A parcela atual não pode ser maior que a quantidade de parcelas.",
      });
    }
  })
  .transform(({ amount_mode, amount: value, ...rest }) => ({
    title: rest.title,
    category_id: rest.category_id,
    ...(amount_mode === "total"
      ? { total_amount: value }
      : { installment_amount: value }),
    current_installment: rest.current_installment,
    total_installments: rest.total_installments,
    current_due_date: rest.current_due_date,
    account_id: rest.account_id,
  }));

/**
 * Payload do `PATCH`: só o que não mexe no cronograma. Valor e quantidade estão
 * travados pela D15 desde que todo parcelamento nasce com parcelas — corrigir é
 * excluir e recriar. Parcela atual acima do total é o quitado (D13).
 */
export const installmentEditSchema = z
  .object({
    title,
    category_id: categoryId,
    current_installment: currentInstallment,
  })
  .transform((data) => ({
    title: data.title,
    category_id: data.category_id,
    current_installment: data.current_installment,
  }));

export interface SchedulePreviewPayload {
  installment_amount?: string;
  total_amount?: string;
  current_installment: number;
  total_installments: number;
  current_due_date: string;
}

/**
 * Corpo de `POST /installments/preview`, ou `null` enquanto o cronograma ainda
 * não está completo e válido — aí a tela não faz requisição.
 */
export function schedulePreviewPayload(
  values: InstallmentFormInput,
): SchedulePreviewPayload | null {
  const value = parseMoneyInput(values.amount);
  const current = wholeNumber(values.current_installment);
  const total = wholeNumber(values.total_installments);
  if (
    value === null ||
    Number(value) <= 0 ||
    current === null ||
    total === null ||
    current < 1 ||
    total < 1 ||
    total > MAX_INSTALLMENTS ||
    current > total ||
    !isIsoDate(values.current_due_date)
  ) {
    return null;
  }
  return {
    ...(values.amount_mode === "total"
      ? { total_amount: value }
      : { installment_amount: value }),
    current_installment: current,
    total_installments: total,
    current_due_date: values.current_due_date,
  };
}

export type InstallmentCreatePayload = z.infer<typeof installmentCreateSchema>;
export type InstallmentEditPayload = z.infer<typeof installmentEditSchema>;

/**
 * Corpo do `PATCH` de edição. Com calendário (S-3) a parcela atual não vai:
 * o campo nem aparece na tela, e mandar o valor da lista — que pode estar em
 * cache desde o mês anterior — fazia o backend recusar (400) sem o usuário ter
 * como corrigir (revisão de 12/11/2026).
 */
export function installmentEditPayload(
  data: InstallmentEditPayload,
  { anchored }: { anchored: boolean },
): Partial<InstallmentEditPayload> {
  if (!anchored) return data;
  const { current_installment: _ignored, ...rest } = data;
  return rest;
}
