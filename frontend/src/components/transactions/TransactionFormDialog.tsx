import { useEffect, useState } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import { formatFullDate, parseISODate, toISODate } from "@/lib/date";
import { CategorySelect } from "@/components/shared/CategorySelect";
import {
  transactionCreateSchema,
  transactionEditSchema,
  type TransactionFormInput,
} from "@/lib/transaction-form";
import type { Transaction } from "@/lib/transactions";
import { installmentProgress, type Installment } from "@/lib/installments";

/**
 * Criação e edição de transação.
 *
 * Diferente de Categorias, os dois modos **não** compartilham schema: o `PATCH`
 * recusa `account_id` (422) e só aceita `installment_id: null` (B6). Os campos
 * correspondentes mudam conforme o modo.
 */

interface Account {
  id: number;
  name: string;
}

const NONE = "__none__";

function emptyValues(): TransactionFormInput {
  return {
    title: "",
    type: "SAÍDA",
    amount: "",
    date: toISODate(new Date()),
    category_id: "",
    is_fixed: false,
    installment_id: "",
  };
}

type FieldErrors = Partial<Record<string, string>>;

export function TransactionFormDialog({
  open,
  onOpenChange,
  transaction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = edição. */
  transaction?: Transaction;
}) {
  const isEditing = transaction !== undefined;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<TransactionFormInput>(emptyValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [unlink, setUnlink] = useState(false);

  /*
   * ⚠️ Debt registrada no CLAUDE.md: `account_id` é obrigatório no POST, mas não
   * existe tela de contas nem seletor. Usa-se a primeira conta. Quebra
   * silenciosamente quando houver uma segunda — os lançamentos iriam todos para
   * esta.
   */
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts/"),
    enabled: open && !isEditing,
  });

  // Só na criação: vincular é impossível na edição (B6), então nem se busca.
  const installments = useQuery({
    queryKey: ["installments"],
    queryFn: () => api.get<Installment[]>("/installments/"),
    enabled: open && !isEditing,
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setUnlink(false);
    setValues(
      transaction
        ? {
            title: transaction.title,
            type: transaction.type,
            amount: formatBRL(transaction.amount).replace(/[^\d.,-]/g, ""),
            date: transaction.date,
            category_id: String(transaction.category.id),
            is_fixed: transaction.is_fixed,
          }
        : emptyValues(),
    );
  }, [open, transaction]);

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      isEditing
        ? api.patch(`/transactions/${transaction!.id}`, payload)
        : api.post("/transactions/", payload),
    onSuccess: () => {
      // Transação move saldo e agregados: dashboard, categorias e a própria
      // listagem ficariam desatualizados.
      for (const key of [["transactions"], ["dashboard"], ["categories"], ["reports"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(isEditing ? "Transação atualizada." : "Transação criada.");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      // 400 do estado mesclado (fixa × parcelada) e 404 de categoria são erros
      // de campo; o resto vira toast.
      if (/fixa e parcelada/i.test(error.message)) {
        setErrors({ is_fixed: error.message });
        return;
      }
      if (/categoria/i.test(error.message)) {
        setErrors({ category_id: error.message });
        return;
      }
      toast.error(error.message);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const result = isEditing
      ? transactionEditSchema.safeParse({ ...values, unlink_installment: unlink })
      : transactionCreateSchema.safeParse({
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

  function update<K extends keyof TransactionFormInput>(
    field: K,
    value: TransactionFormInput[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  const linkedToInstallment = !isEditing && (values.installment_id ?? "") !== "";
  const activeInstallments = (installments.data ?? []).filter(
    (it) => !installmentProgress(it.current_installment, it.total_installments).isPaidOff,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Editar transação" : "Nova transação"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "A conta não pode ser alterada — para mover de conta, exclua e recrie."
                : "O valor é sempre positivo: o sentido vem do tipo."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6">
            <div className="grid gap-2">
              <Label htmlFor="tx-title">Descrição</Label>
              <Input
                id="tx-title"
                value={values.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="Supermercado"
                autoFocus
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tx-type">Tipo</Label>
                <Select value={values.type} onValueChange={(v) => update("type", v)}>
                  <SelectTrigger id="tx-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SAÍDA">Saída</SelectItem>
                    <SelectItem value="ENTRADA">Entrada</SelectItem>
                  </SelectContent>
                </Select>
                {errors.type && <p className="text-xs text-destructive">{errors.type}</p>}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tx-amount">Valor</Label>
                <Input
                  id="tx-amount"
                  value={values.amount}
                  onChange={(e) => update("amount", e.target.value)}
                  placeholder="342,50"
                  inputMode="decimal"
                />
                {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start font-normal"
                  >
                    <CalendarIcon className="h-4 w-4" />
                    {values.date ? formatFullDate(values.date) : "Selecione"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  {/*
                    O `Calendar` fala `Date`; a API fala ISO. `parseISODate` e
                    `toISODate` fazem a ponte — as conversões ingênuas erram o
                    dia em fusos opostos. Ver `date.ts`.
                  */}
                  <Calendar
                    mode="single"
                    selected={values.date ? parseISODate(values.date) : undefined}
                    onSelect={(date) => date && update("date", toISODate(date))}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tx-category">Categoria</Label>
              <CategorySelect
                id="tx-category"
                value={values.category_id}
                onValueChange={(v) => update("category_id", v)}
              />
              {errors.category_id && (
                <p className="text-xs text-destructive">{errors.category_id}</p>
              )}
            </div>

            {!isEditing && (
              <div className="grid gap-2">
                <Label htmlFor="tx-installment">Parcelamento</Label>
                <Select
                  value={values.installment_id === "" ? NONE : values.installment_id}
                  onValueChange={(v) => update("installment_id", v === NONE ? "" : v)}
                  disabled={values.is_fixed}
                >
                  <SelectTrigger id="tx-installment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhum</SelectItem>
                    {activeInstallments.map((it) => (
                      <SelectItem key={it.id} value={String(it.id)}>
                        {it.title} — {it.current_installment}/{it.total_installments}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Vincular não avança a parcela — isso é feito na tela de Parcelamentos.
                </p>
                {errors.installment_id && (
                  <p className="text-xs text-destructive">{errors.installment_id}</p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="grid gap-1">
                <Label htmlFor="tx-fixed">Despesa fixa</Label>
                <p className="text-xs text-muted-foreground">
                  {/* O backend rejeita as duas juntas com 422; aqui o controle
                      já fica travado antes de o usuário montar o estado. */}
                  {linkedToInstallment
                    ? "Indisponível: a transação está vinculada a um parcelamento."
                    : "Recorrente, como aluguel ou assinatura."}
                </p>
              </div>
              <Switch
                id="tx-fixed"
                checked={values.is_fixed ?? false}
                onCheckedChange={(checked) => update("is_fixed", checked)}
                disabled={linkedToInstallment}
              />
            </div>
            {errors.is_fixed && <p className="text-xs text-destructive">{errors.is_fixed}</p>}

            {isEditing && transaction?.installment && (
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="grid gap-1">
                  <Label htmlFor="tx-unlink">Desvincular do parcelamento</Label>
                  <p className="text-xs text-muted-foreground">
                    Parcela {transaction.installment.current_installment}/
                    {transaction.installment.total_installments}. O lançamento continua
                    existindo.
                  </p>
                </div>
                <Switch id="tx-unlink" checked={unlink} onCheckedChange={setUnlink} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
