/**
 * Parte pura da tela "Importar fatura" — `docs/importacao-fatura.md`.
 *
 * Nenhuma conta de dinheiro: o valor e a data vão ao `confirm` exatamente como
 * vieram do `preview`. Aqui só se monta o corpo e se valida a escolha do
 * usuário (linha marcada precisa de categoria).
 */

export interface InstallmentHint {
  current: number;
  total: number;
}

/** A linha é a parcela de um parcelamento que já existe (D-Import-8). */
export interface InstallmentMatch {
  installment_id: number;
  installment_title: string;
  /** A parcela já gerada; `null` se foi apagada. */
  transaction_id: number | null;
}

export type InvoiceBank = "itau" | "nubank" | "mercado_pago" | "generic";

/** Espelha `InvoicePreviewItem` do backend. Valor monetário é string. */
export interface InvoicePreviewItem {
  date: string;
  title: string;
  amount: string;
  type: "SAÍDA" | "ENTRADA";
  installment_hint: InstallmentHint | null;
  is_payment: boolean;
  duplicate: boolean;
  selected: boolean;
  suggested_category_id: number | null;
  installment_match: InstallmentMatch | null;
}

export interface InvoicePreview {
  bank: InvoiceBank;
  lines_read: number;
  items: InvoicePreviewItem[];
}

export interface InvoiceConfirmResult {
  created: number;
  skipped_duplicates: number;
}

/** Linha da revisão: o item da API mais a escolha do usuário. */
export interface ReviewRow {
  item: InvoicePreviewItem;
  selected: boolean;
  /** Id em string, como o `CategorySelect` fala; `""` = sem categoria. */
  category_id: string;
  /** "Criar parcelamento" marcado (D-Import-8); desmarcado por padrão. */
  create_installment: boolean;
}

export interface ConfirmPayload {
  account_id: number;
  items: {
    date: string;
    title: string;
    amount: string;
    type: "SAÍDA" | "ENTRADA";
    category_id: number;
    /** Marcada de novo depois de apontada como duplicada (D-Import-4). */
    allow_duplicate?: true;
    /** Vincular ao parcelamento que casou (D-Import-8). */
    installment_id?: number;
    installment_number?: number;
    /** Criar o parcelamento a partir desta linha (D-Import-8). */
    create_installment?: true;
    installment_current?: number;
    installment_total?: number;
  }[];
}

export type ConfirmResult =
  | { ok: true; payload: ConfirmPayload }
  | { ok: false; empty: boolean; missingCategory: number[] };

export function invoicePreviewPath(dueDate: string, accountId: number): string {
  const query = new URLSearchParams({
    due_date: dueDate,
    account_id: String(accountId),
  });
  return `/imports/invoice/preview?${query.toString()}`;
}

/** Começa com o que a API sugeriu: seleção (falsa para pagamento e
 * duplicada) e categoria do histórico. */
export function initialRows(items: InvoicePreviewItem[]): ReviewRow[] {
  return items.map((item) => ({
    item,
    selected: item.selected,
    category_id:
      item.suggested_category_id === null
        ? ""
        : String(item.suggested_category_id),
    create_installment: false,
  }));
}

export function buildConfirmPayload(
  accountId: number | undefined,
  rows: ReviewRow[],
): ConfirmResult {
  const missingCategory = rows
    .map((row, index) => (row.selected && row.category_id === "" ? index : -1))
    .filter((index) => index >= 0);
  const chosen = rows.filter((row) => row.selected);

  if (
    accountId === undefined ||
    chosen.length === 0 ||
    missingCategory.length
  ) {
    return { ok: false, empty: chosen.length === 0, missingCategory };
  }

  return {
    ok: true,
    payload: {
      account_id: accountId,
      items: chosen.map(({ item, category_id, create_installment }) => ({
        date: item.date,
        title: item.title,
        amount: item.amount,
        type: item.type,
        category_id: Number(category_id),
        // A duplicada vem desmarcada; se o usuário a marcou, é escolha dele, e
        // o servidor não pode pulá-la de novo.
        ...(item.duplicate ? { allow_duplicate: true as const } : {}),
        ...installmentFields(item, create_installment),
      })),
    },
  };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function importResultMessage(result: InvoiceConfirmResult): string {
  const { created, skipped_duplicates: skipped } = result;
  if (created === 0) {
    return `Nada importado: ${plural(skipped, "a", "as")} ${skipped} já existia${skipped === 1 ? "" : "m"}.`;
  }
  const head = `${created} ${plural(created, "transação importada", "transações importadas")}`;
  if (skipped === 0) return `${head}.`;
  return `${head}; ${skipped} já ${plural(skipped, "existia e foi ignorada", "existiam e foram ignoradas")}.`;
}

/** Os campos de parcelamento de uma linha no `confirm` (D-Import-8). */
function installmentFields(item: InvoicePreviewItem, create: boolean) {
  const hint = item.installment_hint;
  if (hint === null) return {};
  if (item.installment_match !== null) {
    // Casou e a parcela não está no extrato: grava vinculada. Se já está, a
    // linha vem desmarcada; marcada de novo, vai avulsa, como duplicada.
    return item.installment_match.transaction_id === null
      ? {
          installment_id: item.installment_match.installment_id,
          installment_number: hint.current,
        }
      : {};
  }
  return create && canCreateInstallment(item)
    ? {
        create_installment: true as const,
        installment_current: hint.current,
        installment_total: hint.total,
      }
    : {};
}

/** "Criar parcelamento" só para saída com parcela e sem parcelamento casado. */
export function canCreateInstallment(item: InvoicePreviewItem): boolean {
  return (
    item.type === "SAÍDA" &&
    item.installment_hint !== null &&
    item.installment_match === null
  );
}

const BANK_NAMES: Record<Exclude<InvoiceBank, "generic">, string> = {
  itau: "Itaú",
  nubank: "Nubank",
  mercado_pago: "Mercado Pago",
};

/** D-Import-7: os três leitores seguem o formato público, sem fatura real. */
export function bankLabel(bank: InvoiceBank): string {
  if (bank === "generic") return "Banco não reconhecido: leitor genérico";
  return `Fatura do ${BANK_NAMES[bank]} (leitor ainda não verificado com fatura real)`;
}
