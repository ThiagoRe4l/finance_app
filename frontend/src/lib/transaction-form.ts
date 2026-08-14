/**
 * Validação dos formulários de transação.
 *
 * Segue o padrão de `category-form.ts`: o schema **transforma**, entrando o que
 * o formulário coleta (tudo string) e saindo o payload da API.
 *
 * São **dois schemas** porque criar e editar têm contratos diferentes:
 *
 * | Campo            | POST              | PATCH                      |
 * |------------------|-------------------|----------------------------|
 * | `account_id`     | obrigatório       | **422** (`extra="forbid"`) |
 * | `installment_id` | opcional, vincula | só `null` (decisão B6)     |
 *
 * Um schema só serviria aos dois apenas ignorando essas regras — e o resultado
 * seria 422 depois do submit, ou pior, um `account_id` que o cliente acha que
 * funcionou.
 *
 * Vincular a parcelamento **só existe na criação**: registrar a parcela do mês
 * é uso corrente, mas depois de criada a transação o vínculo só pode ser
 * desfeito. Criar a transação **não** avança `current_installment` — isso é
 * ação explícita e isolada na tela de Parcelamentos, para não acoplar duas
 * mudanças de estado numa só.
 */

import { z } from "zod";

import { parseMoneyInput } from "./money.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** O que os campos do formulário produzem. */
export interface TransactionFormInput {
  title: string;
  type: string;
  amount: string;
  date: string;
  category_id: string;
  is_fixed?: boolean;
  /** Só na criação. `""` = "Nenhum". */
  installment_id?: string;
  /** Só na edição. Pedido explícito de desvínculo. */
  unlink_installment?: boolean;
  /** Ignorado na edição — ver o schema. */
  account_id?: number;
}

const amountField = z
  .string()
  .transform((raw) => parseMoneyInput(raw))
  .refine((parsed) => parsed !== null, "Informe um valor válido, como 1.500,00.")
  // `amount` tem `gt=0` no backend. O sinal da transação vem de `type`, não do
  // valor — zero e negativo não têm significado aqui.
  .refine(
    (parsed) => parsed === null || Number(parsed) > 0,
    "O valor deve ser maior que zero.",
  )
  .transform((parsed) => parsed as string);

const commonFields = {
  title: z
    .string()
    .trim()
    .min(1, "Informe a descrição.")
    .max(150, "A descrição deve ter no máximo 150 caracteres."),

  // Lista fechada no formulário: minúsculo aqui indicaria bug de ligação, não
  // digitação do usuário — por isso não se normaliza.
  type: z.enum(["ENTRADA", "SAÍDA"], { message: "Selecione o tipo." }),

  amount: amountField,

  // O picker sempre entrega ISO via `toISODate`. Um "07/08/2026" aqui seria
  // sintoma de o componente ter mandado o texto exibido em vez do valor.
  date: z.string().regex(ISO_DATE, "Selecione uma data."),

  // O `Select` devolve string; o backend espera `integer` e rejeita "3".
  category_id: z
    .string()
    .min(1, "Selecione a categoria.")
    .refine((raw) => /^\d+$/.test(raw), "Selecione a categoria.")
    .transform(Number),

  is_fixed: z.boolean().default(false),
};

export const transactionCreateSchema = z
  .object({
    ...commonFields,
    account_id: z.number({ message: "Conta não encontrada." }).int().positive(),
    // `""` é a opção "Nenhum" do seletor; mandá-la ao backend daria 422.
    installment_id: z
      .string()
      .optional()
      .refine(
        (raw) => raw === undefined || raw === "" || /^\d+$/.test(raw),
        "Parcelamento inválido.",
      )
      .transform((raw) => (raw === undefined || raw === "" ? undefined : Number(raw))),
  })
  .refine(
    (data) => !(data.is_fixed && data.installment_id !== undefined),
    {
      // Espelha `check_fixed_and_installment_exclusive`, que devolve 422. O
      // formulário também desabilita um controle quando o outro está ativo, mas
      // a regra vive aqui para não depender só do JSX.
      message: "Uma transação não pode ser fixa e parcelada ao mesmo tempo.",
      path: ["installment_id"],
    },
  )
  .transform(({ installment_id, ...rest }) =>
    // Ausência ≠ `null`: o backend trata a chave ausente como "não vincular".
    installment_id === undefined ? rest : { ...rest, installment_id },
  );

export const transactionEditSchema = z
  .object({
    ...commonFields,
    unlink_installment: z.boolean().optional(),
  })
  .transform(({ unlink_installment, ...rest }) =>
    /*
     * `PATCH` é parcial: omitir `installment_id` significa "não toca". Mandar
     * `null` sem o usuário ter pedido desvincularia a parcela em silêncio.
     *
     * Só existe `null` — decisão B6. Note que não há caminho para produzir um
     * id aqui: a entrada é um booleano, então "vincular na edição" é
     * estruturalmente impossível, não apenas validado.
     */
    unlink_installment ? { ...rest, installment_id: null } : rest,
  );

export type TransactionCreatePayload = z.infer<typeof transactionCreateSchema>;
export type TransactionEditPayload = z.infer<typeof transactionEditSchema>;
