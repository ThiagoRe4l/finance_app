/**
 * Queries afetadas por criar, editar, excluir ou sincronizar assinaturas.
 *
 * A cobrança lançada é uma SAÍDA de verdade (R-3): entra no extrato, no saldo da
 * conta, nos totais do dashboard, no gasto da categoria e nos relatórios.
 */
export const SUBSCRIPTION_QUERY_KEYS = [
  ["subscriptions"],
  ["transactions"],
  ["dashboard"],
  ["categories"],
  ["reports"],
  ["accounts"],
] as const;
