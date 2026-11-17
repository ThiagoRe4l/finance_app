/**
 * Validação do formulário de assinatura (`docs/recorrencias.md` → R-4 e R-6).
 *
 * O usuário informa descrição, categoria, valor e a data da primeira cobrança; o
 * dia dela é o dia da cobrança. **Nenhuma conta de dinheiro acontece aqui**: o
 * valor sai como string decimal, e o calendário é do backend.
 */

import { z } from "zod";

import { parseMoneyInput } from "./money.ts";

export interface SubscriptionFormInput {
  title: string;
  category_id: string;
  /** Como digitado: "49,90". */
  amount: string;
  /** ISO `AAAA-MM-DD`: a primeira cobrança que o app lança. */
  first_charge_date: string;
  account_id?: number;
}

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

const title = z
  .string()
  .trim()
  .min(1, "Informe a descrição.")
  .max(100, "A descrição deve ter no máximo 100 caracteres.");

const categoryId = z
  .string()
  .refine((raw) => /^\d+$/.test(raw), "Selecione a categoria.")
  .transform(Number);

const amount = z
  .string()
  .transform((raw) => parseMoneyInput(raw))
  .refine((parsed) => parsed !== null, "Informe um valor válido, como 49,90.")
  .refine(
    (parsed) => parsed === null || Number(parsed) > 0,
    "O valor deve ser maior que zero.",
  )
  .transform((parsed) => parsed as string);

/** Payload do `POST /subscriptions`. */
export const subscriptionCreateSchema = z.object({
  title,
  category_id: categoryId,
  amount,
  first_charge_date: z
    .string()
    .refine(isIsoDate, "Selecione a data da primeira cobrança."),
  account_id: z.number({ message: "Conta não encontrada." }).int().positive(),
});

/**
 * Payload do `PATCH`: só o que vale daqui para frente. A data da primeira
 * cobrança e a conta não mudam (R-4); o zod descarta o que não está aqui.
 */
export const subscriptionEditSchema = z.object({
  title,
  category_id: categoryId,
  amount,
});
