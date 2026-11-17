/**
 * Derivações da aba de assinaturas (`docs/recorrencias.md`).
 *
 * O front não calcula cobrança nem soma dinheiro: `status`, `next_charge_date` e
 * o resumo vêm prontos do backend. Sobra o texto do card.
 */

/** Espelha `SubscriptionResponse` do backend. Valores monetários são string. */
export interface Subscription {
  id: number;
  title: string;
  amount: string;
  category_id: number;
  account_id: number;
  /** Primeira cobrança que o app lança; o dia dela é o dia da cobrança. */
  first_charge_date: string;
  ended_on: string | null;
  status: "ativa" | "encerrada";
  /** Primeira cobrança depois de hoje; `null` se a assinatura já terá acabado. */
  next_charge_date: string | null;
  category: { id: number; name: string; color: string; icon_name: string };
}

/** Espelha `SubscriptionSummary`. */
export interface SubscriptionsSummary {
  active_count: number;
  monthly_amount: string;
}

/**
 * O dia do mês da cobrança. Lido da string ISO, sem `new Date`: o fuso local
 * poderia deslocar a data em um dia.
 */
export function billingDay(isoDate: string): number {
  return Number(isoDate.slice(8, 10));
}

/** `2026-12-15` → `15/12/2026`, também sem passar por `Date`. */
function formatDMY(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function describeCharge(subscription: Subscription): string {
  const day = billingDay(subscription.first_charge_date);
  if (subscription.status === "encerrada" || !subscription.next_charge_date) {
    return `Encerrada · cobrava todo dia ${day}`;
  }
  return `Todo dia ${day} · próxima em ${formatDMY(subscription.next_charge_date)}`;
}
