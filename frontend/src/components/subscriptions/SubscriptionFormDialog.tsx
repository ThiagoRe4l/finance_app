import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarIcon, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { decimalToMask } from "@/lib/money";
import { Label } from "@/components/ui/label";
import { CategorySelect } from "@/components/shared/CategorySelect";
import { api } from "@/lib/api";
import { formatFullDate, parseISODate, toISODate } from "@/lib/date";
import {
  subscriptionCreateSchema,
  subscriptionEditSchema,
  type SubscriptionFormInput,
} from "@/lib/subscription-form";
import type { Subscription } from "@/lib/subscriptions";
import { SUBSCRIPTION_QUERY_KEYS } from "./query-keys";

interface Account {
  id: number;
  name: string;
}

function emptyValues(): SubscriptionFormInput {
  return {
    title: "",
    category_id: "",
    amount: "",
    first_charge_date: toISODate(new Date()),
  };
}

type FieldErrors = Partial<Record<string, string>>;

/**
 * Criação e edição de assinatura (`docs/recorrencias.md`).
 *
 * **Criação:** descrição, categoria, valor e a data da primeira cobrança; o dia
 * dela é o dia da cobrança, todo mês. **Edição (R-4):** só descrição, categoria
 * e valor, e valem daqui para frente — a data e a conta não mudam.
 *
 * Layout do celular igual ao de `InstallmentFormDialog` (M-3): folha ancorada
 * embaixo, rolagem interna, rodapé fixo, alvos de 44 px e sem teclado
 * automático em tela de toque.
 */
export function SubscriptionFormDialog({
  open,
  onOpenChange,
  subscription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: Subscription;
}) {
  const isEditing = subscription !== undefined;
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<SubscriptionFormInput>(emptyValues);
  const [errors, setErrors] = useState<FieldErrors>({});

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
    enabled: open && !isEditing,
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setValues(
      subscription
        ? {
            ...emptyValues(),
            title: subscription.title,
            category_id: String(subscription.category.id),
            // Vem do backend como "49.90"; o campo aceita vírgula e ponto.
            amount: decimalToMask(subscription.amount),
            first_charge_date: subscription.first_charge_date,
          }
        : emptyValues(),
    );
  }, [open, subscription]);

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      isEditing
        ? api.patch(`/subscriptions/${subscription!.id}`, payload)
        : api.post("/subscriptions", payload),
    onSuccess: () => {
      for (const key of SUBSCRIPTION_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(
        isEditing ? "Assinatura atualizada." : "Assinatura cadastrada.",
      );
      onOpenChange(false);
    },
    onError: (error: Error) => {
      if (/categoria/i.test(error.message)) {
        setErrors({ category_id: error.message });
        return;
      }
      if (/cobran[çc]a/i.test(error.message)) {
        setErrors({ first_charge_date: error.message });
        return;
      }
      toast.error(error.message);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!isEditing && accounts.data?.[0] === undefined) {
      toast.error(
        accounts.isPending
          ? "Carregando as contas, tente de novo em instantes."
          : "Nenhuma conta encontrada para lançar a assinatura.",
      );
      return;
    }

    const result = isEditing
      ? subscriptionEditSchema.safeParse(values)
      : subscriptionCreateSchema.safeParse({
          ...values,
          account_id: accounts.data?.[0]?.id,
        });

    if (!result.success) {
      const next: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    mutation.mutate(result.data);
  }

  function update<K extends keyof SubscriptionFormInput>(
    field: K,
    value: SubscriptionFormInput[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden outline-none sm:max-w-lg max-h-[90dvh] max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] max-sm:left-2 max-sm:right-2 max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-xl max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-bottom-8 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-bottom-8 max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100"
        onOpenAutoFocus={(event) => {
          // Mesmo tratamento dos outros formulários (M-12, 2a): em tela de
          // toque o foco vai para o diálogo e o teclado não abre sozinho.
          event.preventDefault();
          if (window.matchMedia("(pointer: coarse)").matches) {
            (event.currentTarget as HTMLElement | null)?.focus();
          } else {
            titleRef.current?.focus();
          }
        }}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Editar assinatura" : "Nova assinatura"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "A mudança vale a partir da próxima cobrança; o que já foi lançado não muda."
                : "A cobrança entra sozinha todo mês, no dia da primeira cobrança."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6 min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
            <div className="grid gap-2">
              <Label htmlFor="sub-title">Descrição</Label>
              <Input
                id="sub-title"
                ref={titleRef}
                value={values.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="Netflix"
                className="h-11 sm:h-9"
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sub-category">Categoria</Label>
              <CategorySelect
                id="sub-category"
                value={values.category_id}
                onValueChange={(v) => update("category_id", v)}
                triggerClassName="h-11 sm:h-9"
              />
              {errors.category_id && (
                <p className="text-xs text-destructive">{errors.category_id}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="sub-amount">Valor por mês</Label>
              <MoneyInput
                id="sub-amount"
                value={values.amount}
                onValueChange={(v) => update("amount", v)}
                className="h-11 sm:h-9"
              />
              {errors.amount && (
                <p className="text-xs text-destructive">{errors.amount}</p>
              )}
            </div>

            {!isEditing && (
              <div className="grid gap-2">
                <Label>Primeira cobrança</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-start font-normal h-11 sm:h-9"
                    >
                      <CalendarIcon className="h-4 w-4" />
                      {values.first_charge_date
                        ? formatFullDate(values.first_charge_date)
                        : "Selecione"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={
                        values.first_charge_date
                          ? parseISODate(values.first_charge_date)
                          : undefined
                      }
                      onSelect={(date) =>
                        date && update("first_charge_date", toISODate(date))
                      }
                      autoFocus
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  O dia desta data é o dia da cobrança. Em data passada (até 12
                  meses), as cobranças que já venceram entram agora.
                </p>
                {errors.first_charge_date && (
                  <p className="text-xs text-destructive">
                    {errors.first_charge_date}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="max-sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="h-11 sm:h-9"
            >
              {mutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {isEditing ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
