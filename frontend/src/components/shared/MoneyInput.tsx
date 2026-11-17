import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { maskMoney } from "@/lib/money";

/**
 * Campo de valor "caixa registradora" (T-3, `docs/integracao-frontend.md`).
 *
 * Os dígitos preenchem a partir do centavo, então ninguém digita vírgula nem
 * ponto: `40000` vira `R$ 400,00`. O valor do campo é o **texto mascarado**; o
 * schema do formulário o converte para o decimal da API com `parseMoneyInput`.
 *
 * `inputMode="numeric"` abre o teclado de dígitos. A fonte de 16 px no celular
 * vem do `Input` do shadcn (`text-base md:text-sm`, P3).
 */
export function MoneyInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (masked: string) => void;
}) {
  return (
    <Input
      {...props}
      value={value}
      onChange={(event) => onValueChange(maskMoney(event.target.value))}
      placeholder="R$ 0,00"
      inputMode="numeric"
      autoComplete="off"
    />
  );
}
