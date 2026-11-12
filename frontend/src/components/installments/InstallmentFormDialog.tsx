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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategorySelect } from "@/components/shared/CategorySelect";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import { formatFullDate, parseISODate, toISODate } from "@/lib/date";
import {
  installmentCreateSchema,
  installmentEditPayload,
  installmentEditSchema,
  schedulePreviewPayload,
  type InstallmentEditPayload,
  type AmountMode,
  type InstallmentFormInput,
  type SchedulePreviewPayload,
} from "@/lib/installment-form";
import type { Installment } from "@/lib/installments";
import { INSTALLMENT_QUERY_KEYS } from "./query-keys";

interface Account {
  id: number;
  name: string;
}

/** Espelha `InstallmentPreview` do backend. Valores monetários são string. */
interface SchedulePreview {
  total_amount: string;
  installment_amount: string;
  remaining_amount: string;
  first_due_date: string;
  end_date: string;
  installments: { number: number; date: string; amount: string }[];
}

function emptyValues(): InstallmentFormInput {
  return {
    title: "",
    category_id: "",
    amount_mode: "installment",
    amount: "",
    current_installment: "1",
    total_installments: "",
    current_due_date: toISODate(new Date()),
  };
}

type FieldErrors = Partial<Record<string, string>>;

/** O último valor estável há `delay` ms — evita uma requisição por tecla. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Cronograma calculado pelo backend, para conferência antes de salvar (#4).
 * O front não divide dinheiro: a parcela, a sobra de centavos na primeira e o
 * término vêm de `POST /installments/preview`, a mesma função do cadastro.
 */
function SchedulePreviewBox({
  payload,
}: {
  payload: SchedulePreviewPayload | null;
}) {
  // Comparado por valor: o pai monta um objeto novo a cada render, e sem isso
  // o debounce reiniciava em renders que não mudam nada.
  const key = JSON.stringify(payload);
  const debouncedKey = useDebounced(key);
  const debounced = JSON.parse(debouncedKey) as SchedulePreviewPayload | null;
  // Enquanto o debounce não alcança o que está na tela, o cronograma mostrado
  // seria o da digitação anterior: melhor dizer que está calculando.
  const isStale = key !== debouncedKey;
  const preview = useQuery({
    queryKey: ["installments", "preview", debounced],
    queryFn: () =>
      api.post<SchedulePreview>("/installments/preview", debounced),
    enabled: debounced !== null,
    staleTime: Infinity,
    retry: false,
  });

  if (payload === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Preencha valor, parcelas e data para ver o cronograma.
      </p>
    );
  }
  if (preview.isError) {
    return (
      <p className="text-xs text-destructive">
        Não foi possível calcular o cronograma.
      </p>
    );
  }
  if (isStale || !preview.data) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Calculando...
      </p>
    );
  }

  const data = preview.data;
  const first = data.installments[0];
  const firstDiffers =
    first !== undefined && first.amount !== data.installment_amount;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Parcela</dt>
      <dd className="text-right font-medium tabular-nums whitespace-nowrap">
        {formatBRL(data.installment_amount)}
      </dd>
      {firstDiffers && (
        <>
          <dt className="text-muted-foreground">Parcela {first.number}</dt>
          <dd className="text-right tabular-nums whitespace-nowrap">
            {formatBRL(first.amount)}
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">Valor total</dt>
      <dd className="text-right font-medium tabular-nums whitespace-nowrap">
        {formatBRL(data.total_amount)}
      </dd>
      <dt className="text-muted-foreground">Termina em</dt>
      <dd className="text-right font-medium">{data.end_date}</dd>
      <dt className="text-muted-foreground">Parcelas a lançar</dt>
      <dd className="text-right tabular-nums">{data.installments.length}</dd>
    </dl>
  );
}

/**
 * Criação e edição de parcelamento.
 *
 * **Criação (issue #4):** valor da parcela **ou** total, quantidade, parcela
 * atual e a data dela; o cronograma calculado aparece antes de salvar, e salvar
 * gera as parcelas restantes como transações (P-1).
 *
 * **Edição:** só descrição, categoria e parcela atual. Valor e quantidade estão
 * travados pela D15, porque todo parcelamento novo nasce com parcelas —
 * corrigir é excluir e recriar.
 *
 * Layout do celular igual ao de `TransactionFormDialog` (M-3, fatia 2a):
 * folha ancorada embaixo, rolagem interna, rodapé fixo, alvos de 44 px e sem
 * teclado automático em tela de toque.
 */
export function InstallmentFormDialog({
  open,
  onOpenChange,
  installment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installment?: Installment;
}) {
  const isEditing = installment !== undefined;
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<InstallmentFormInput>(emptyValues);
  const [errors, setErrors] = useState<FieldErrors>({});

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts/"),
    enabled: open && !isEditing,
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setValues(
      installment
        ? {
            ...emptyValues(),
            title: installment.title,
            category_id: String(installment.category.id),
            current_installment: String(installment.current_installment),
            total_installments: String(installment.total_installments),
          }
        : emptyValues(),
    );
  }, [open, installment]);

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      isEditing
        ? api.patch(`/installments/${installment!.id}`, payload)
        : api.post("/installments/", payload),
    onSuccess: () => {
      for (const key of INSTALLMENT_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(
        isEditing ? "Parcelamento atualizado." : "Parcelamento criado.",
      );
      onOpenChange(false);
    },
    onError: (error: Error) => {
      if (/categoria/i.test(error.message)) {
        setErrors({ category_id: error.message });
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
          : "Nenhuma conta encontrada para lançar o parcelamento.",
      );
      return;
    }

    const result = isEditing
      ? installmentEditSchema.safeParse(values)
      : installmentCreateSchema.safeParse({
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
    mutation.mutate(
      isEditing
        ? installmentEditPayload(result.data as InstallmentEditPayload, {
            anchored: installment.anchor_due_date !== null,
          })
        : result.data,
    );
  }

  function update<K extends keyof InstallmentFormInput>(
    field: K,
    value: InstallmentFormInput[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden outline-none sm:max-w-lg max-h-[90dvh] max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] max-sm:left-2 max-sm:right-2 max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-xl max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-bottom-8 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-bottom-8 max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100"
        onOpenAutoFocus={(event) => {
          // Mesmo tratamento do formulário de transação (M-12, 2a): em tela
          // de toque o foco vai para o diálogo e o teclado não abre sozinho.
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
              {isEditing ? "Editar parcelamento" : "Novo parcelamento"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Valor e quantidade de parcelas não mudam depois de criado: para corrigir, exclua e recrie."
                : "Informe o valor da parcela ou o total. As parcelas a pagar entram nas transações."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6 min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
            <div className="grid gap-2">
              <Label htmlFor="inst-title">Descrição</Label>
              <Input
                id="inst-title"
                ref={titleRef}
                value={values.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="Notebook Dell"
                className="h-11 sm:h-9"
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="inst-category">Categoria</Label>
              <CategorySelect
                id="inst-category"
                value={values.category_id}
                onValueChange={(v) => update("category_id", v)}
                triggerClassName="h-11 sm:h-9"
              />
              {errors.category_id && (
                <p className="text-xs text-destructive">{errors.category_id}</p>
              )}
            </div>

            {!isEditing && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="inst-mode">Informar</Label>
                    <Select
                      value={values.amount_mode}
                      onValueChange={(v) =>
                        update("amount_mode", v as AmountMode)
                      }
                    >
                      <SelectTrigger id="inst-mode" className="h-11 sm:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="installment">
                          Valor da parcela
                        </SelectItem>
                        <SelectItem value="total">Valor total</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="inst-amount">
                      {values.amount_mode === "total" ? "Total" : "Parcela"}
                    </Label>
                    <Input
                      id="inst-amount"
                      value={values.amount}
                      onChange={(e) => update("amount", e.target.value)}
                      placeholder={
                        values.amount_mode === "total" ? "5.400,00" : "450,00"
                      }
                      inputMode="decimal"
                      className="h-11 sm:h-9"
                    />
                    {errors.amount && (
                      <p className="text-xs text-destructive">
                        {errors.amount}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="inst-total">Nº de parcelas</Label>
                    <Input
                      id="inst-total"
                      value={values.total_installments}
                      onChange={(e) =>
                        update("total_installments", e.target.value)
                      }
                      placeholder="12"
                      inputMode="numeric"
                      className="h-11 sm:h-9"
                    />
                    {errors.total_installments && (
                      <p className="text-xs text-destructive">
                        {errors.total_installments}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="inst-current">Parcela atual</Label>
                    <Input
                      id="inst-current"
                      value={values.current_installment}
                      onChange={(e) =>
                        update("current_installment", e.target.value)
                      }
                      inputMode="numeric"
                      className="h-11 sm:h-9"
                    />
                    {errors.current_installment && (
                      <p className="text-xs text-destructive">
                        {errors.current_installment}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Vencimento da parcela atual</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="justify-start font-normal h-11 sm:h-9"
                      >
                        <CalendarIcon className="h-4 w-4" />
                        {values.current_due_date
                          ? formatFullDate(values.current_due_date)
                          : "Selecione"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={
                          values.current_due_date
                            ? parseISODate(values.current_due_date)
                            : undefined
                        }
                        onSelect={(date) =>
                          date && update("current_due_date", toISODate(date))
                        }
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {errors.current_due_date && (
                    <p className="text-xs text-destructive">
                      {errors.current_due_date}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-secondary/40 p-4">
                  <SchedulePreviewBox
                    payload={schedulePreviewPayload(values)}
                  />
                </div>
              </>
            )}

            {/*
              Com calendário (S-3) a parcela atual não se edita: o valor
              prefixado vai no PATCH igual ao da API e o backend o aceita.
            */}
            {isEditing && installment.anchor_due_date === null && (
              <div className="grid gap-2">
                <Label htmlFor="inst-current">Parcela atual</Label>
                <Input
                  id="inst-current"
                  value={values.current_installment}
                  onChange={(e) =>
                    update("current_installment", e.target.value)
                  }
                  inputMode="numeric"
                  className="h-11 sm:h-9"
                />
                <p className="text-xs text-muted-foreground">
                  de {installment.total_installments} parcelas de{" "}
                  {formatBRL(installment.installment_amount)}
                </p>
                {errors.current_installment && (
                  <p className="text-xs text-destructive">
                    {errors.current_installment}
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
              {isEditing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
