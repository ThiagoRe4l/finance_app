/**
 * Gate de autenticação — D-Auth-6.
 *
 * ⚠️ **Isto NÃO é a proteção da API.** Quem protege é a dependency
 * `current_user` no backend: o domínio do backend continua publicamente
 * alcançável, e o rewrite `/api` é conveniência de origem, não barreira de
 * segurança. Este componente existe para a tela não piscar quebrada enquanto
 * as requisições voltam 401.
 *
 * Client-side de propósito: um guarda server-side (`beforeLoad` lendo o
 * cookie) teria zero flash de conteúdo, mas passaria a usar SSR de verdade e
 * encareceria a migração para SPA estático registrada no item 0.2 dos Itens
 * futuros.
 *
 * ⚠️ Sem teste de componente — este projeto não tem runner capaz (ver "Testes
 * do frontend" no CLAUDE.md). O que torna isso aceitável é o 401 do backend,
 * que tem 19 testes.
 */

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api } from "@/lib/api.ts";
import { GoogleSignIn } from "./GoogleSignIn.tsx";

type SessionUser = { email: string };

export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading, isError, refetch } = useQuery<SessionUser>({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<SessionUser>("/auth/me"),
    // 401 é resposta esperada, não falha de rede: repetir só atrasa a tela de
    // login e multiplica requisições inúteis.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <span className="sr-only">Verificando sessão…</span>
      </div>
    );
  }

  if (isError || !data) {
    return <GoogleSignIn onSignedIn={() => refetch()} />;
  }

  return <>{children}</>;
}
