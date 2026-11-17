import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { SUBSCRIPTION_QUERY_KEYS } from "./query-keys";

/**
 * Lança as cobranças de assinatura que venceram, uma vez ao abrir o app depois
 * do login (`docs/recorrencias.md` → R-3). Não renderiza nada.
 *
 * É uma escrita explícita (`POST`), não efeito colateral de uma leitura. O
 * backend é idempotente, então remontar (StrictMode, volta ao app) não duplica.
 * Só atualiza as telas quando algo foi lançado: sem cobrança nova, nenhuma
 * requisição extra. Falha é silenciosa de propósito — a tela já funciona sem
 * ela, e a próxima abertura tenta de novo.
 */
export function SubscriptionSync() {
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api
      .post<{ created: number }>("/subscriptions/sync", {})
      .then(({ created }) => {
        if (created === 0) return;
        for (const key of SUBSCRIPTION_QUERY_KEYS) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      })
      .catch(() => {});
  }, [queryClient]);

  return null;
}
