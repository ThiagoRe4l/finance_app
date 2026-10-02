/**
 * Identidade da sessão e botão de sair.
 *
 * Fica no rodapé da `Sidebar` porque é onde a navegação vive. ⚠️ A `Sidebar` é
 * `hidden md:flex`, então **não há logout no mobile** — mas também não há
 * navegação nenhuma lá, limitação que é anterior a esta fatia.
 *
 * O e-mail vem da query `["auth", "me"]` que o `AuthGate` já carregou: mesma
 * chave, cache compartilhado, nenhuma requisição a mais.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api.ts";

type SessionUser = { email: string };

export function UserMenu() {
  const queryClient = useQueryClient();

  const { data } = useQuery<SessionUser>({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<SessionUser>("/auth/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const logout = useMutation({
    mutationFn: () => api.post<void>("/auth/logout", {}),
    onSuccess: () => {
      // 🔴 `clear()` e não `invalidateQueries(["auth","me"])`.
      //
      // Invalidar só a sessão deixaria no cache as transações, categorias e
      // parcelamentos da conta anterior — e a próxima conta a entrar veria
      // **dados de outra pessoa** na tela até o refetch chegar. Num app de
      // finanças com 4 contas na allowlist, isso é o caminho mais curto para
      // alguém ler o extrato de outro.
      queryClient.clear();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível sair.",
      );
    },
  });

  return (
    <div className="mt-auto flex flex-col gap-2">
      {data?.email && (
        <p
          className="truncate text-xs text-muted-foreground"
          title={data.email}
        >
          {data.email}
        </p>
      )}
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" />
        {logout.isPending ? "Saindo…" : "Sair"}
      </button>
    </div>
  );
}
