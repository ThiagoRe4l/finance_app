import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarIcon, ChevronDown, Loader2 } from "lucide-react";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { decimalToMask } from "@/lib/money";
import { formatFullDate, parseISODate, toISODate } from "@/lib/date";
import { CategorySelect } from "@/components/shared/CategorySelect";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { INSTALLMENT_QUERY_KEYS } from "@/components/installments/query-keys";
import {
  NEW_INSTALLMENT,
  inlineInstallmentInput,
  initialFocusTarget,
  savedToastMessage,
  shouldOpenMoreOptions,
  transactionCreateSchema,
  transactionEditSchema,
  type InlineInstallmentFields,
  type TransactionFormInput,
} from "@/lib/transaction-form";
import { readLastCategory, rememberLastCategory } from "@/lib/last-category";
import type { CategorySummary } from "@/lib/dashboard";
import { installmentCreateSchema } from "@/lib/installment-form";
import type { Transaction, TransactionType } from "@/lib/transactions";
import { installmentProgress, type Installment } from "@/lib/installments";

/**
 * Criação e edição de transação.
 *
 * Diferente de Categorias, os dois modos **não** compartilham schema: o `PATCH`
 * recusa `account_id` (422) e só aceita `installment_id: null` (B6). Os campos
 * correspondentes mudam conforme o modo.
 *
 * O formulário muda por tipo (T-1): **entrada** não tem parcelamento e a
 * recorrência se chama "Entrada fixa"; **saída** pode ser parcelada — inclusive
 * criando o parcelamento ali mesmo (T-2), caso em que a única chamada é
 * `POST /installments`, que já grava as parcelas como transações (P-1).
 */

interface Account {
  id: number;
  name: string;
}

const NONE = "__none__";

function emptyValues(type: TransactionType): TransactionFormInput {
  return {
    title: "",
    type,
    amount: "",
    date: toISODate(new Date()),
    category_id: "",
    is_fixed: false,
    installment_id: "",
  };
}

function emptyInstallmentFields(): InlineInstallmentFields {
  return {
    amount_mode: "installment",
    current_installment: "1",
    total_installments: "",
  };
}

type FieldErrors = Partial<Record<string, string>>;

/** O que a mutação envia: transação, ou parcelamento criado na própria saída. */
type Submission = {
  path: string;
  payload: unknown;
  installment: boolean;
  /** Para o toast final (Q5): o que foi salvo. */
  summary?: { type: TransactionType; amount: string; categoryId: string };
};

export function TransactionFormDialog({
  open,
  onOpenChange,
  transaction,
  defaultType = "SAÍDA",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = edição. */
  transaction?: Transaction;
  /** Tipo com que a criação abre (a aba ativa de Transações). */
  defaultType?: TransactionType;
}) {
  const isEditing = transaction !== undefined;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<TransactionFormInput>(() =>
    emptyValues(defaultType),
  );
  const [fields, setFields] = useState<InlineInstallmentFields>(
    emptyInstallmentFields,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [unlink, setUnlink] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // Mesma chave do `CategorySelect`: o cache serve os dois (M3).
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategorySummary[]>("/categories"),
    enabled: open && !isEditing,
  });

  /*
   * ⚠️ Debt registrada no CLAUDE.md: `account_id` é obrigatório no POST, mas não
   * existe tela de contas nem seletor. Usa-se a primeira conta. Quebra
   * silenciosamente quando houver uma segunda — os lançamentos iriam todos para
   * esta.
   */
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
    enabled: open && !isEditing,
  });

  // Só na criação: vincular é impossível na edição (B6), então nem se busca.
  const installments = useQuery({
    queryKey: ["installments"],
    queryFn: () => api.get<Installment[]>("/installments"),
    enabled: open && !isEditing,
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setUnlink(false);
    setFields(emptyInstallmentFields());
    setValues(
      transaction
        ? {
            title: transaction.title,
            type: transaction.type,
            // Decimal da API → texto mascarado (T-3), sem passar por `number`.
            amount: decimalToMask(transaction.amount),
            date: transaction.date,
            category_id: String(transaction.category.id),
            is_fixed: transaction.is_fixed,
          }
        : emptyValues(defaultType),
    );
    setMoreOpen(
      shouldOpenMoreOptions({
        isEditing,
        is_fixed: transaction?.is_fixed,
        linkedToInstallment: transaction?.installment != null,
      }),
    );
  }, [open, transaction, defaultType, isEditing]);

  // Categoria padrão = a última usada (M3), só na criação e sem sobrescrever
  // uma escolha já feita.
  useEffect(() => {
    if (!open || isEditing || !categories.data) return;
    const remembered = readLastCategory(
      typeof window === "undefined" ? undefined : window.localStorage,
      categories.data.map((c) => c.id),
    );
    if (remembered === "") return;
    setValues((current) =>
      current.category_id === ""
        ? { ...current, category_id: remembered }
        : current,
    );
  }, [open, isEditing, categories.data]);

  const mutation = useMutation({
    mutationFn: ({ path, payload }: Submission) =>
      isEditing ? api.patch(path, payload) : api.post(path, payload),
    onSuccess: (_data, { installment, summary }) => {
      if (installment) {
        // O parcelamento gravou as parcelas como transações (P-1): as mesmas
        // chaves de `InstallmentFormDialog`.
        for (const key of INSTALLMENT_QUERY_KEYS) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        toast.success("Parcelamento criado.");
        onOpenChange(false);
        return;
      }
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
      if (summary) {
        try {
          rememberLastCategory(window.localStorage, Number(summary.categoryId));
        } catch {
          // localStorage indisponível: só não lembra a categoria.
        }
      }
      const message = summary
        ? savedToastMessage({ ...summary, isEditing })
        : isEditing
          ? "Transação atualizada."
          : "Transação criada.";
      // Final do fluxo (Q5): diz o que foi salvo e, na criação, oferece a
      // próxima — o diálogo reabre limpo, sem refazer o caminho até o botão.
      toast.success(
        message,
        isEditing
          ? undefined
          : {
              action: {
                label: "Lançar outra",
                onClick: () => onOpenChange(true),
              },
            },
      );
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

    if (creatingInstallment) {
      const parsed = installmentCreateSchema.safeParse(
        inlineInstallmentInput(values, fields, accounts.data?.[0]?.id),
      );
      if (!parsed.success) {
        const next: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          // A data da saída é o vencimento da parcela atual.
          const raw = String(issue.path[0]);
          const field = raw === "current_due_date" ? "date" : raw;
          next[field] ??= issue.message;
        }
        setErrors(next);
        if (next.account_id) toast.error(next.account_id);
        return;
      }
      setErrors({});
      mutation.mutate({
        path: "/installments",
        payload: parsed.data,
        installment: true,
      });
      return;
    }

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
    mutation.mutate({
      path: isEditing ? `/transactions/${transaction!.id}` : "/transactions",
      payload: result.data,
      installment: false,
      summary: isEditing
        ? undefined
        : {
            type: values.type as TransactionType,
            amount: String((result.data as { amount: string }).amount),
            categoryId: values.category_id,
          },
    });
  }

  function update<K extends keyof TransactionFormInput>(
    field: K,
    value: TransactionFormInput[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function updateFields<K extends keyof InlineInstallmentFields>(
    field: K,
    value: InlineInstallmentFields[K],
  ) {
    setFields((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  /** Trocar o tipo na criação não leva o vínculo de parcelamento junto (T-1). */
  function changeType(type: TransactionType) {
    setValues((current) => ({
      ...current,
      type,
      installment_id: type === "ENTRADA" ? "" : current.installment_id,
    }));
    setErrors({});
  }

  const isIncome = values.type === "ENTRADA";
  const creatingInstallment =
    !isEditing && !isIncome && values.installment_id === NEW_INSTALLMENT;
  const linkedToInstallment =
    !isEditing && (values.installment_id ?? "") !== "";
  const activeInstallments = (installments.data ?? []).filter(
    (it) =>
      !installmentProgress(it.current_installment, it.total_installments)
        .isPaidOff,
  );

  const forcedMore =
    creatingInstallment ||
    Boolean(
      errors.is_fixed ||
      errors.installment_id ||
      errors.total_installments ||
      errors.current_installment,
    );
  const showMore = moreOpen || forcedMore;

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
           * próprio diálogo (o leitor de tela entra nele). Com mouse, o
           * valor recebe o foco (M1, docs/ux-leis.md). O foco automático do próprio
           * campo saiu: com ele o Radix nem dispara este evento. E sem
           * `preventDefault()` o Radix focaria o campo selecionando o texto.
           */
          event.preventDefault();
          const target = initialFocusTarget({
            coarsePointer: window.matchMedia("(pointer: coarse)").matches,
          });
          if (target === "dialog") {
            (event.currentTarget as HTMLElement | null)?.focus();
          } else {
            amountRef.current?.focus();
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
            {/*
              Entrada ou saída (T-1): o mesmo alternador de /recorrencias. O
              tipo de uma transação parcelada não muda na edição — virar
              entrada deixaria um vínculo que entrada não tem.
            */}
            <Tabs
              value={values.type}
              onValueChange={(v) => changeType(v as TransactionType)}
            >
              <TabsList className="grid h-auto w-full grid-cols-2 sm:h-9">
                <TabsTrigger
                  value="ENTRADA"
                  className="h-11 sm:h-9"
                  disabled={isEditing && transaction?.installment != null}
                >
                  Entrada
                </TabsTrigger>
                <TabsTrigger
                  value="SAÍDA"
                  className="h-11 sm:h-9"
                  disabled={isEditing && transaction?.installment != null}
                >
                  Saída
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {errors.type && (
              <p className="text-xs text-destructive">{errors.type}</p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="tx-amount">
                {creatingInstallment
                  ? fields.amount_mode === "total"
                    ? "Valor total"
                    : "Valor da parcela"
                  : "Valor"}
              </Label>
              <MoneyInput
                id="tx-amount"
                ref={amountRef}
                value={values.amount}
                onValueChange={(v) => update("amount", v)}
                className="h-11 sm:h-9"
              />
              {errors.amount && (
                <p className="text-xs text-destructive">{errors.amount}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tx-title">Descrição</Label>
              <Input
                id="tx-title"
                value={values.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="Supermercado"
                className="h-11 sm:h-9"
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>
                {creatingInstallment ? "Vencimento da parcela atual" : "Data"}
              </Label>
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

            {/*
              Raro fica recolhido (Hick/Tesler, M2): parcelamento e despesa
              fixa. Abre sozinho quando algum já está em uso ou com erro.
            */}
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={showMore}
              aria-controls="tx-more-options"
              disabled={forcedMore}
              className="flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showMore ? "rotate-180" : ""}`}
              />
              Mais opções
            </button>
            {showMore && (
              <div id="tx-more-options" className="grid gap-5">
                {!isEditing && !isIncome && (
                  <div className="grid gap-2">
                    <Label htmlFor="tx-installment">Parcelamento</Label>
                    <Select
                      value={
                        values.installment_id === ""
                          ? NONE
                          : values.installment_id
                      }
                      onValueChange={(v) =>
                        update("installment_id", v === NONE ? "" : v)
                      }
                      disabled={values.is_fixed}
                    >
                      <SelectTrigger
                        id="tx-installment"
                        className="h-11 min-w-0 sm:h-9 [&>svg]:shrink-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-w-(--radix-select-content-available-width)">
                        <SelectItem value={NONE}>Nenhum</SelectItem>
                        <SelectItem value={NEW_INSTALLMENT}>
                          Criar novo parcelamento
                        </SelectItem>
                        {activeInstallments.map((it) => (
                          <SelectItem key={it.id} value={String(it.id)}>
                            <span className="wrap-anywhere in-[[role=combobox]]:block in-[[role=combobox]]:truncate">
                              {it.title} — {it.current_installment}/
                              {it.total_installments}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {creatingInstallment
                        ? "A parcela atual e as seguintes entram em Transações automaticamente."
                        : "Vincular não avança a parcela — isso é feito na tela de Parcelamentos."}
                    </p>
                    {errors.installment_id && (
                      <p className="text-xs text-destructive">
                        {errors.installment_id}
                      </p>
                    )}
                  </div>
                )}

                {creatingInstallment && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="tx-inst-mode">Informar</Label>
                        <Select
                          value={fields.amount_mode}
                          onValueChange={(v) =>
                            updateFields(
                              "amount_mode",
                              v as "installment" | "total",
                            )
                          }
                        >
                          <SelectTrigger
                            id="tx-inst-mode"
                            className="h-11 sm:h-9"
                          >
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
                        <Label htmlFor="tx-inst-total">Nº de parcelas</Label>
                        <Input
                          id="tx-inst-total"
                          value={fields.total_installments}
                          onChange={(e) =>
                            updateFields("total_installments", e.target.value)
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
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="tx-inst-current">Parcela atual</Label>
                      <Input
                        id="tx-inst-current"
                        value={fields.current_installment}
                        onChange={(e) =>
                          updateFields("current_installment", e.target.value)
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
                  </>
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
                      {isIncome ? "Entrada fixa" : "Despesa fixa"}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {/* O backend rejeita as duas juntas com 422; aqui o controle
                      já fica travado antes de o usuário montar o estado. */}
                      {linkedToInstallment
                        ? "Indisponível: a transação está vinculada a um parcelamento."
                        : isIncome
                          ? "Recorrente, como salário ou aluguel recebido."
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
                        {transaction.installment.total_installments}. O
                        lançamento continua existindo.
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
