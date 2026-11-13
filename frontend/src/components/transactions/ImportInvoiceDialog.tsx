import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarIcon, FileText, Loader2 } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategorySelect } from "@/components/shared/CategorySelect";
import { api, apiFetch } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import {
  formatFullDate,
  formatShortDate,
  parseISODate,
  toISODate,
} from "@/lib/date";
import {
  bankLabel,
  buildConfirmPayload,
  canCreateInstallment,
  importResultMessage,
  initialRows,
  invoicePreviewPath,
  type InvoiceConfirmResult,
  type InvoicePreview,
  type ReviewRow,
} from "@/lib/invoice-import";

interface Account {
  id: number;
  name: string;
}

/** O mesmo teto do backend (D-Import-2): falha aqui antes de subir 4 MB. */
const MAX_PDF_BYTES = 4 * 1024 * 1024;

/**
 * Importar fatura em PDF — `docs/importacao-fatura.md`.
 *
 * Duas etapas (D-Import-1): ler o PDF (nada é gravado) e revisar as linhas —
 * marcar, escolher categoria — antes de importar. Pagamento da fatura e
 * duplicada já vêm desmarcados pela API.
 *
 * Mobile-first desde a base: folha ancorada embaixo como os outros formulários
 * (M-3), linhas em cartão (M-4), alvos de 44 px.
 */
export function ImportInvoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [dueDate, setDueDate] = useState(() => toISODate(new Date()));
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [missing, setMissing] = useState<Set<number>>(new Set());

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/accounts"),
    enabled: open,
  });
  const accountId = accounts.data?.[0]?.id;

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setDueDate(toISODate(new Date()));
    setPreview(null);
    setRows([]);
    setMissing(new Set());
  }, [open]);

  const read = useMutation({
    mutationFn: () =>
      apiFetch<InvoicePreview>(invoicePreviewPath(dueDate, accountId!), {
        method: "POST",
        body: file!,
        headers: { "Content-Type": "application/pdf" },
      }),
    onSuccess: (data) => {
      setPreview(data);
      setRows(initialRows(data.items));
      setMissing(new Set());
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const confirm = useMutation({
    mutationFn: (payload: unknown) =>
      api.post<InvoiceConfirmResult>("/imports/invoice/confirm", payload),
    onSuccess: (result) => {
      for (const key of [
        ["transactions"],
        ["dashboard"],
        ["categories"],
        ["reports"],
        ["accounts"],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(importResultMessage(result));
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleRead(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      toast.error("Escolha o PDF da fatura.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("O PDF passa de 4 MB.");
      return;
    }
    if (accountId === undefined) {
      toast.error(
        accounts.isPending
          ? "Carregando as contas, tente de novo em instantes."
          : "Nenhuma conta encontrada para lançar a fatura.",
      );
      return;
    }
    read.mutate();
  }

  function handleConfirm() {
    if (accountId === undefined) {
      toast.error("Nenhuma conta encontrada para lançar a fatura.");
      return;
    }
    const result = buildConfirmPayload(accountId, rows);
    if (!result.ok) {
      setMissing(new Set(result.missingCategory));
      toast.error(
        result.empty
          ? "Marque ao menos uma linha para importar."
          : "Escolha a categoria das linhas marcadas.",
      );
      return;
    }
    confirm.mutate(result.payload);
  }

  function updateRow(index: number, change: Partial<ReviewRow>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...change } : row)),
    );
    setMissing((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });
  }

  const selectedCount = rows.filter((row) => row.selected).length;
  const busy = read.isPending || confirm.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden outline-none sm:max-w-2xl max-h-[90dvh] max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] max-sm:top-auto max-sm:bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] max-sm:left-2 max-sm:right-2 max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-xl max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-bottom-8 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-bottom-8 max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100">
        <DialogHeader>
          <DialogTitle>Importar fatura</DialogTitle>
          <DialogDescription>
            {preview === null
              ? "O PDF é lido e descartado: nada é gravado antes da sua revisão."
              : `${bankLabel(preview.bank)}. ${preview.items.length} lançamento(s) reconhecido(s) em ${preview.lines_read} linha(s) lida(s). Revise antes de importar.`}
          </DialogDescription>
        </DialogHeader>

        {preview === null ? (
          <form
            id="invoice-read"
            onSubmit={handleRead}
            className="grid gap-5 py-6 min-h-0 flex-1 overflow-y-auto -mx-1 px-1"
          >
            <div className="grid gap-2">
              <Label htmlFor="invoice-file">Fatura em PDF</Label>
              <Input
                id="invoice-file"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="h-11 sm:h-9"
              />
            </div>
            <div className="grid gap-2">
              <Label>Vencimento da fatura</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start font-normal h-11 sm:h-9"
                  >
                    <CalendarIcon className="h-4 w-4" />
                    {formatFullDate(dueDate)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={parseISODate(dueDate)}
                    onSelect={(date) => date && setDueDate(toISODate(date))}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                O ano de cada linha sai daqui: compra de dezembro numa fatura de
                janeiro fica no ano anterior.
              </p>
            </div>
            {accounts.data && accounts.data.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Lançado na conta {accounts.data[0].name}.
              </p>
            )}
          </form>
        ) : preview.items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhum lançamento reconhecido nesta fatura. O leitor ainda é
            genérico: envie um exemplo do seu banco para ele aprender o formato.
          </div>
        ) : (
          <ul className="grid gap-3 py-4 min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
            {rows.map((row, index) => (
              <li
                key={index}
                className={`rounded-xl border p-3 ${
                  missing.has(index) ? "border-destructive" : "border-border"
                } ${row.selected ? "" : "opacity-60"}`}
              >
                <div className="flex items-start gap-2">
                  <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center lg:min-h-0 lg:min-w-0 lg:pt-1">
                    <Checkbox
                      checked={row.selected}
                      onCheckedChange={(checked) =>
                        updateRow(index, { selected: checked === true })
                      }
                      aria-label={`Importar ${row.item.title}`}
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm font-medium line-clamp-2 wrap-anywhere">
                        {row.item.title}
                      </p>
                      <p
                        className={`shrink-0 whitespace-nowrap text-sm font-medium tabular-nums ${
                          row.item.type === "ENTRADA"
                            ? "text-[oklch(0.55_0.15_155)]"
                            : ""
                        }`}
                      >
                        {row.item.type === "ENTRADA" ? "+" : "−"}
                        {formatBRL(row.item.amount)}
                      </p>
                    </div>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>{formatShortDate(row.item.date)}</span>
                      {row.item.installment_hint && (
                        <span>
                          Parcela {row.item.installment_hint.current}/
                          {row.item.installment_hint.total}
                        </span>
                      )}
                      {row.item.is_payment && <span>Pagamento da fatura</span>}
                      {row.item.duplicate && <span>Já existe na conta</span>}
                      {row.item.installment_match && (
                        <span>
                          {row.item.installment_match.transaction_id === null
                            ? `Vai para o parcelamento "${row.item.installment_match.installment_title}"`
                            : `Parcela de "${row.item.installment_match.installment_title}", já lançada`}
                        </span>
                      )}
                    </p>
                    {row.selected && canCreateInstallment(row.item) && (
                      // D-Import-8: desmarcado por padrão — cria as parcelas
                      // futuras na conta. A linha inteira é o alvo de toque.
                      <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-muted-foreground lg:min-h-0">
                        <Checkbox
                          aria-label={`Criar parcelamento de ${row.item.title}`}
                          checked={row.create_installment}
                          onCheckedChange={(checked) =>
                            updateRow(index, {
                              create_installment: checked === true,
                            })
                          }
                        />
                        Criar parcelamento ({row.item.installment_hint!.total}{" "}
                        parcelas; as próximas entram nas transações)
                      </label>
                    )}
                    {row.selected && (
                      <div className="mt-2">
                        <CategorySelect
                          id={`invoice-category-${index}`}
                          value={row.category_id}
                          onValueChange={(v) =>
                            updateRow(index, { category_id: v })
                          }
                          triggerClassName="h-11 sm:h-9"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="max-sm:gap-2">
          {preview !== null && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // O campo de arquivo volta vazio; o estado tem que acompanhar,
                // senão "Ler fatura" relê o PDF anterior sem avisar.
                setPreview(null);
                setFile(null);
              }}
              disabled={busy}
              className="h-11 sm:h-9"
            >
              Trocar arquivo
            </Button>
          )}
          {preview === null ? (
            <Button
              type="submit"
              form="invoice-read"
              disabled={busy || !file}
              className="h-11 sm:h-9"
            >
              {read.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Ler fatura
            </Button>
          ) : (
            preview.items.length > 0 && (
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={busy || selectedCount === 0}
                className="h-11 sm:h-9"
              >
                {confirm.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Importar {selectedCount}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
