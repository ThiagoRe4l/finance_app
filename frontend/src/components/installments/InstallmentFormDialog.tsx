import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategorySelect } from "@/components/shared/CategorySelect";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import {
  deriveTotalAmount,
  formatEndDate,
  installmentCreateSchema,
  installmentEditSchema,
  parseEndDate,
  parseLockedFields,
  type InstallmentFormInput,
} from "@/lib/installment-form";
import type { Installment } from "@/lib/installments";

interface Account {
  id: number;
  name: string;
}

const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Janela de anos do seletor: o ano corrente e os 9 seguintes. */
function yearOptions(): number[] {
  const current = new Date().getFullYear();
  return Array.from({ length: 10 }, (_, i) => current + i);
}

function emptyValues(): InstallmentFormInput {
  const now = new Date();
  return {
    title: "",
    category_id: "",
    installment_amount: "",
    current_installment: "1",
    total_installments: "",
    end_date: formatEndDate(now.getMonth() + 1, now.getFullYear()),
  };
}

type FieldErrors = Partial<Record<string, string>>;

/**
 * Criação e edição de parcelamento.
 *
 * `total_amount` é **derivado** de `installment_amount × total_installments` e
 * somente-leitura: os três campos são redundantes e o backend não valida
 * coerência entre eles.
 *
 * Na edição os três valores são enviados **sem prever a trava** — a API não
 * expõe se há transação vinculada, então o 409 que vier é transformado em
 * mensagem inline nos campos que o `detail` cita.
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
            title: installment.title,
            category_id: String(installment.category.id),
            installment_amount: formatBRL(installment.installment_amount).replace(/[^\d.,-]/g, ""),
            current_installment: String(installment.current_installment),
            total_installments: String(installment.total_installments),
            // `parseEndDate` pode devolver `null` se o valor não seguir
            // "Mmm/AAAA" — string livre no backend. Nesse caso o seletor cai no
            // default em vez de quebrar.
            end_date: parseEndDate(installment.end_date)
              ? installment.end_date
              : emptyValues().end_date,
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
      for (const key of [["installments"], ["dashboard"], ["reports"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(isEditing ? "Parcelamento atualizado." : "Parcelamento criado.");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      /*
       * O 409 do D15 cita os campos travados no `detail`. `parseLockedFields`
       * extrai os nomes para pintar cada um; lista vazia significa que a frase
       * mudou no backend, e aí o toast mostra a mensagem íntegra em vez de
       * engolir o erro.
       */
      const locked = parseLockedFields(error.message);
      if (locked.length > 0) {
        const next: FieldErrors = {};
        for (const field of locked) {
          next[field] = "Não pode ser alterado: já há parcela lançada.";
        }
        setErrors(next);
        toast.error("Alguns campos não podem mais ser alterados.");
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
      ? installmentEditSchema.safeParse(values)
      : installmentCreateSchema.safeParse({ ...values, account_id: accounts.data?.[0]?.id });

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

  function update<K extends keyof InstallmentFormInput>(field: K, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  const parsedEnd = parseEndDate(values.end_date) ?? { month: 1, year: yearOptions()[0] };
  const derivedTotal = deriveTotalAmount(values.installment_amount, values.total_installments);

  function updateEndDate(month: number, year: number) {
    update("end_date", formatEndDate(month, year));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Editar parcelamento" : "Novo parcelamento"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Valor da parcela e total não podem mudar se já houver parcela lançada."
                : "O valor total é calculado a partir da parcela e do número de parcelas."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6">
            <div className="grid gap-2">
              <Label htmlFor="inst-title">Descrição</Label>
              <Input
                id="inst-title"
                value={values.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="Notebook Dell"
                autoFocus
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="inst-category">Categoria</Label>
              <CategorySelect
                id="inst-category"
                value={values.category_id}
                onValueChange={(v) => update("category_id", v)}
              />
              {errors.category_id && (
                <p className="text-xs text-destructive">{errors.category_id}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="inst-amount">Valor da parcela</Label>
                <Input
                  id="inst-amount"
                  value={values.installment_amount}
                  onChange={(e) => update("installment_amount", e.target.value)}
                  placeholder="450,00"
                  inputMode="decimal"
                />
                {errors.installment_amount && (
                  <p className="text-xs text-destructive">{errors.installment_amount}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="inst-total">Nº de parcelas</Label>
                <Input
                  id="inst-total"
                  value={values.total_installments}
                  onChange={(e) => update("total_installments", e.target.value)}
                  placeholder="12"
                  inputMode="numeric"
                />
                {errors.total_installments && (
                  <p className="text-xs text-destructive">{errors.total_installments}</p>
                )}
              </div>
            </div>

            {/*
              Derivado e somente-leitura. Os três valores são redundantes e o
              backend não valida coerência entre eles — deixar o total livre
              permitiria "12 × R$ 500" com total de R$ 9.000, e a tela calcula
              "Saldo a pagar" a partir dos dois de cima.
            */}
            <div className="grid gap-2">
              <Label className="flex items-center gap-2 text-muted-foreground">
                <Lock className="h-3 w-3" /> Valor total
              </Label>
              <p className="text-lg font-semibold tabular-nums">
                {derivedTotal ? formatBRL(derivedTotal) : "—"}
              </p>
              {errors.total_amount && (
                <p className="text-xs text-destructive">{errors.total_amount}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="inst-current">Parcela atual</Label>
                <Input
                  id="inst-current"
                  value={values.current_installment}
                  onChange={(e) => update("current_installment", e.target.value)}
                  inputMode="numeric"
                />
                {errors.current_installment && (
                  <p className="text-xs text-destructive">{errors.current_installment}</p>
                )}
              </div>

              {/*
                `end_date` é `String(20)` livre no backend — rótulo, não data.
                O seletor **gera** "Mmm/AAAA"; o front assume o formato e o
                backend não garante. Ver CLAUDE.md.
              */}
              <div className="grid gap-2">
                <Label htmlFor="inst-month">Mês final</Label>
                <Select
                  value={String(parsedEnd.month)}
                  onValueChange={(v) => updateEndDate(Number(v), parsedEnd.year)}
                >
                  <SelectTrigger id="inst-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_LABELS.map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="inst-year">Ano final</Label>
                <Select
                  value={String(parsedEnd.year)}
                  onValueChange={(v) => updateEndDate(parsedEnd.month, Number(v))}
                >
                  <SelectTrigger id="inst-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions().map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {errors.end_date && <p className="text-xs text-destructive">{errors.end_date}</p>}
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
