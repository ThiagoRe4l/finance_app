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
  const titleRef = useRef<HTMLInputElement>(null);

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
      /*
       * Transação move saldo e agregados: dashboard, categorias e a própria
       * listagem ficariam desatualizados.
       *
       * ⚠️ `["installments"]` fica **de fora de propósito**: nenhuma operação de
       * transação escreve em dado de parcelamento hoje. `create_transaction` só
       * *valida* o `installment_id`; `remaining_amount` deriva de
       * `installment_amount × parcelas restantes`, e avançar a parcela é ação
       * separada, na tela de Parcelamentos.
       *
       * Se um dia criar a transação passar a avançar `current_installment` — ou
       * qualquer outro efeito no parcelamento —, esta lista precisa da chave.
       */
      for (const key of [
        ["transactions"],
        ["dashboard"],
        ["categories"],
        ["reports"],
      ]) {
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
      ? transactionEditSchema.safeParse({
          ...values,
          unlink_installment: unlink,
        })
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

  const linkedToInstallment =
    !isEditing && (values.installment_id ?? "") !== "";
  const activeInstallments = (installments.data ?? []).filter(
    (it) =>
      !installmentProgress(it.current_installment, it.total_installments)
        .isPaidOff,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Abaixo de `sm` vira folha ancorada embaixo (M-3, M-12). As `max-sm:`
        sobrepõem posição, largura e animação do `ui/dialog` só no celular; a
        partir de `sm` o diálogo fica centrado como hoje. A animação do shadcn
        vem de `left-1/2` e `top-[48%]`: anulada aqui, a folha só sobe de baixo,
        sem zoom. A altura desconta as duas áreas seguras (o topo não vai para
        baixo do entalhe). Em toda largura quem rola é o miolo e o rodapé fica
        fora da rolagem — no desktop só aparece se o formulário passar de 90dvh.
        `outline-none`: no toque o foco vai para o próprio diálogo, e o contorno
        do browser desenharia em volta da folha inteira.
      */}
      <DialogContent
        className="flex flex-col overflow-hidden outline-none sm:max-w-lg max-h-[90dvh] max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] max-sm:left-2 max-sm:right-2 max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-xl max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-bottom-8 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-bottom-8 max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100"
        onOpenAutoFocus={(event) => {
          /*
           * Em tela de toque o teclado não abre sozinho: o foco vai para o
           * próprio diálogo (o leitor de tela entra nele). Com mouse, a
           * descrição recebe o foco, como antes. O foco automático do próprio
           * campo saiu: com ele o Radix nem dispara este evento. E sem
           * `preventDefault()` o Radix focaria o campo selecionando o texto.
           */
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
              {isEditing ? "Editar transação" : "Nova transação"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "A conta não pode ser alterada — para mover de conta, exclua e recrie."
                : "O valor é sempre positivo: o sentido vem do tipo."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6 min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
            <div className="grid gap-2">
              <Label htmlFor="tx-title">Descrição</Label>
              <Input
                id="tx-title"
                ref={titleRef}
                value={values.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="Supermercado"
                className="h-11 sm:h-9"
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tx-type">Tipo</Label>
                <Select
                  value={values.type}
                  onValueChange={(v) => update("type", v)}
                >
                  <SelectTrigger id="tx-type" className="h-11 sm:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SAÍDA">Saída</SelectItem>
                    <SelectItem value="ENTRADA">Entrada</SelectItem>
                  </SelectContent>
                </Select>
                {errors.type && (
                  <p className="text-xs text-destructive">{errors.type}</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="tx-amount">Valor</Label>
                <Input
                  id="tx-amount"
                  value={values.amount}
                  onChange={(e) => update("amount", e.target.value)}
                  placeholder="342,50"
                  inputMode="decimal"
                  className="h-11 sm:h-9"
                />
                {errors.amount && (
                  <p className="text-xs text-destructive">{errors.amount}</p>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start font-normal h-11 sm:h-9"
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
                    selected={
                      values.date ? parseISODate(values.date) : undefined
                    }
                    onSelect={(date) => date && update("date", toISODate(date))}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              {errors.date && (
                <p className="text-xs text-destructive">{errors.date}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tx-category">Categoria</Label>
              <CategorySelect
                id="tx-category"
                triggerClassName="h-11 sm:h-9"
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
                  value={
                    values.installment_id === "" ? NONE : values.installment_id
                  }
                  onValueChange={(v) =>
                    update("installment_id", v === NONE ? "" : v)
                  }
                  disabled={values.is_fixed}
                >
                  <SelectTrigger id="tx-installment" className="h-11 sm:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nenhum</SelectItem>
                    {activeInstallments.map((it) => (
                      <SelectItem key={it.id} value={String(it.id)}>
                        {it.title} — {it.current_installment}/
                        {it.total_installments}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Vincular não avança a parcela — isso é feito na tela de
                  Parcelamentos.
                </p>
                {errors.installment_id && (
                  <p className="text-xs text-destructive">
                    {errors.installment_id}
                  </p>
                )}
              </div>
            )}

            {/*
              A linha inteira é o alvo do Switch no celular: abaixo de `sm` o
              `::after` do rótulo cobre a linha (`relative`), e clicar no rótulo
              aciona o Switch. O `<Label>` do shadcn fica como está, e no
              desktop a linha se comporta como antes.
            */}
            <div className="relative flex items-center justify-between max-sm:min-h-11">
              <div className="grid gap-1">
                <Label
                  htmlFor="tx-fixed"
                  className="max-sm:after:absolute max-sm:after:inset-0"
                >
                  Despesa fixa
                </Label>
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
            {errors.is_fixed && (
              <p className="text-xs text-destructive">{errors.is_fixed}</p>
            )}

            {isEditing && transaction?.installment && (
              <div className="relative flex items-center justify-between rounded-lg border border-border p-3 max-sm:min-h-11">
                <div className="grid gap-1">
                  <Label
                    htmlFor="tx-unlink"
                    className="max-sm:after:absolute max-sm:after:inset-0"
                  >
                    Desvincular do parcelamento
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Parcela {transaction.installment.current_installment}/
                    {transaction.installment.total_installments}. O lançamento
                    continua existindo.
                  </p>
                </div>
                <Switch
                  id="tx-unlink"
                  checked={unlink}
                  onCheckedChange={setUnlink}
                />
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
