/**
 * Queries afetadas por criar, editar ou excluir um parcelamento.
 *
 * Desde a P-1 (11/11/2026) o parcelamento grava as próprias parcelas como
 * transações: elas entram no extrato, nos totais do dashboard, no gasto da
 * categoria, nos relatórios e no saldo da conta. Antes bastavam
 * parcelamentos, dashboard e relatórios.
 */
export const INSTALLMENT_QUERY_KEYS = [
  ["installments"],
  ["transactions"],
  ["dashboard"],
  ["categories"],
  ["reports"],
  ["accounts"],
] as const;
