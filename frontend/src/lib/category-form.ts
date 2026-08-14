/**
 * Validação do formulário de categoria.
 *
 * Primeiro schema `zod` do projeto — define o padrão para os formulários de
 * transação e parcelamento.
 *
 * O schema **transforma**, não só valida: entra o que o formulário coleta (tudo
 * string) e sai o payload que a API espera, com `budget` já em decimal
 * canônico. O componente não faz conversão nenhuma, e o teste cobre a ponta a
 * ponta sem tocar em JSX — que é onde a cobertura atual não alcança.
 */

import { z } from "zod";

import { isKnownCategoryIcon } from "./category-icons.ts";
import { parseMoneyInput } from "./money.ts";

/** O que os campos do formulário produzem: texto, sempre. */
export interface CategoryFormInput {
  name: string;
  icon_name: string;
  color: string;
  budget: string;
}

/** O que a API recebe (`CategoryCreate`/`CategoryUpdate`). */
export interface CategoryPayload {
  name: string;
  icon_name: string;
  color: string;
  budget: string;
}

export const categoryFormSchema = z.object({
  // `trim` antes do `min`: sem isso "   " passaria e o backend gravaria em
  // branco. O 50 espelha o `String(50)` do model — validar aqui transforma um
  // 422 depois do submit em mensagem inline antes dele.
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(50, "O nome deve ter no máximo 50 caracteres."),

  // `icon_name` é string livre no backend, e um nome fora do mapa renderiza o
  // fallback sem erro nenhum — a categoria fica genérica em silêncio. O
  // formulário usa lista fechada; isto impede que um valor digitado vaze.
  icon_name: z
    .string()
    .refine(isKnownCategoryIcon, "Selecione um ícone da lista."),

  color: z
    .string()
    .trim()
    .min(1, "Selecione uma cor.")
    .max(50, "A cor deve ter no máximo 50 caracteres."),

  // Opcional no `CategoryCreate`, e a categoria "Receita" do seed usa "0.00" —
  // categoria sem orçamento é estado válido, que a tela já sabe exibir.
  budget: z
    .string()
    .transform((raw) => (raw.trim() === "" ? "0.00" : parseMoneyInput(raw)))
    .refine((parsed) => parsed !== null, "Informe um valor válido, como 1.500,00.")
    .refine(
      (parsed) => parsed === null || !parsed.startsWith("-"),
      "O orçamento não pode ser negativo.",
    )
    .transform((parsed) => parsed as string),
});

export type CategoryFormOutput = z.infer<typeof categoryFormSchema>;
