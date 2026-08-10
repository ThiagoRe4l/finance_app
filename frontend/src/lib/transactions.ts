/**
 * Tipos e derivações da transação, compartilhados entre as telas.
 *
 * A API expõe dados crus (`type`, `is_fixed`, `installment`) e **não** duplica
 * lógica de apresentação — decisão registrada no CLAUDE.md. O rótulo
 * Fixa/Variável/Parcelada/Receita é derivado aqui, uma vez só.
 *
 * Antes desta unificação a regra existia em duas versões que discordavam:
 * `routes/transacoes.tsx` usava a grafia final e
 * `components/dashboard/Transactions.tsx` usava slug minúsculo sem acento com
 * uma tabela `typeLabel` própria.
 */

// Extensão explícita: o resolver ESM do Node (usado por `node --test`) não a
// infere. O Vite resolve das duas formas, e `allowImportingTsExtensions` já
// está ligado no tsconfig.
import { parseMoney } from "./money.ts";

export type TransactionType = "ENTRADA" | "SAÍDA";

export interface CategoryRef {
  id: number;
  name: string;
  color: string;
  icon_name: string;
}

export interface InstallmentProgress {
  current_installment: number;
  total_installments: number;
}

/** Espelha `TransactionResponse` do backend. Valores monetários são string. */
export interface Transaction {
  id: number;
  title: string;
  type: TransactionType;
  amount: string;
  date: string;
  category: CategoryRef;
  is_fixed: boolean;
  account_id: number;
  installment_id: number | null;
  installment: InstallmentProgress | null;
}

export type TransactionLabel = "Fixa" | "Variável" | "Parcelada" | "Receita";

export interface DerivedLabel {
  label: TransactionLabel;
  /** Progresso da parcela (`"2/12"`), quando houver. */
  meta: string | null;
}

/**
 * Rótulo exibido na badge.
 *
 * A ordem dos testes é a regra (decidida em 10/08/2026):
 *
 * 1. **ENTRADA sempre vence** — entrada fixa ou parcelada colapsa para
 *    "Receita" sem meta. Exibir "Receita 2/12" sugeriria parcela a pagar, que é
 *    o oposto do que uma entrada é.
 * 2. Parcelamento vence `is_fixed` — estado que o backend rejeita, mas o
 *    comportamento aqui é determinístico de propósito, e não fruto da ordem
 *    acidental dos `if`.
 * 3. Quem manda é o objeto `installment`, não `installment_id`: sem o progresso
 *    não há `2/12` para exibir, e "Parcelada" sem meta seria pior que
 *    "Variável".
 */
export function deriveTransactionLabel(transaction: Transaction): DerivedLabel {
  if (transaction.type === "ENTRADA") {
    return { label: "Receita", meta: null };
  }

  if (transaction.installment) {
    const { current_installment, total_installments } = transaction.installment;
    return { label: "Parcelada", meta: `${current_installment}/${total_installments}` };
  }

  if (transaction.is_fixed) {
    return { label: "Fixa", meta: null };
  }

  return { label: "Variável", meta: null };
}

/**
 * Valor com sinal, para exibição.
 *
 * A API devolve `amount` **sempre positivo** e o sentido em `type`; os mocks
 * usavam número com sinal (`-2100`). É a ponte entre os dois — por isso não
 * basta trocar `tx.amount` por `parseMoney(tx.amount)` nas telas.
 *
 * O `!== 0` evita `-0`, que o `Intl` formataria como "-R$ 0,00".
 */
export function signedAmount(transaction: Transaction): number {
  const value = parseMoney(transaction.amount);
  return transaction.type === "SAÍDA" && value !== 0 ? -value : value;
}
