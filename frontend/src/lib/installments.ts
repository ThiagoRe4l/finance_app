/**
 * Derivações da tela de parcelamentos.
 *
 * Sobrou pouco para o front: `remaining_amount` por item e os três totais do
 * topo vêm prontos do backend desde a fatia de 13/08/2026
 * (`GET /installments/summary`). O que resta é o progresso do card.
 */

/** Espelha `InstallmentResponse` do backend. Valores monetários são string. */
export interface Installment {
  id: number;
  title: string;
  category: { id: number; name: string; color: string; icon_name: string };
  total_amount: string;
  installment_amount: string;
  current_installment: number;
  total_installments: number;
  end_date: string;
  account_id: number;
  remaining_amount: string;
}

/** Espelha `InstallmentSummary`. */
export interface InstallmentsSummary {
  active_count: number;
  monthly_committed_amount: string;
  remaining_total_amount: string;
}

export interface InstallmentProgress {
  /** Parcelas efetivamente pagas. */
  paidCount: number;
  /** 0–100, para texto e largura da barra. */
  percent: number;
  isPaidOff: boolean;
}

/**
 * Progresso de pagamento.
 *
 * `current_installment` é a parcela **ainda a pagar** (D13), então pagas =
 * `current - 1`. O mock usava `current / total`, o que contava a parcela
 * corrente como quitada e contradizia o `remaining` exibido no mesmo card:
 * 2/12 aparecia como "17% pago" ao lado de 11 parcelas restantes de 12.
 *
 * Quitado é `current > total`, a mesma fronteira que o backend usa — e o teto
 * em `total` evita "158% pago" quando `current` está muito além do fim.
 */
export function installmentProgress(
  currentInstallment: number,
  totalInstallments: number,
): InstallmentProgress {
  if (totalInstallments <= 0) {
    // Não deveria existir, mas o schema não impede — e `NaN%` iria direto
    // para `style={{ width }}`.
    return { paidCount: 0, percent: 0, isPaidOff: false };
  }

  const paidCount = Math.max(0, Math.min(currentInstallment - 1, totalInstallments));

  return {
    paidCount,
    percent: (paidCount / totalInstallments) * 100,
    isPaidOff: currentInstallment > totalInstallments,
  };
}
