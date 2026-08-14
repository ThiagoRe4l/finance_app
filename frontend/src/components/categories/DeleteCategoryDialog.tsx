import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import type { CategorySummary } from "@/lib/dashboard";

/**
 * Confirmação de exclusão.
 *
 * O **409** não é erro do usuário: é estado do sistema — a categoria está
 * vinculada a transações ou parcelamentos, e o `ondelete="RESTRICT"` do banco
 * impede apagá-la. Por isso o diálogo troca de conteúdo em vez de fechar com um
 * toast de erro: some o botão de confirmar, e fica só a explicação com o
 * caminho a seguir. Oferecer "tentar de novo" seria enganoso — tentar de novo
 * dá o mesmo resultado.
 *
 * A mensagem vem do `detail` do backend. `GET /categories/` devolve `txs_count`
 * do **mês corrente**, não o total, então a UI não consegue dizer quantos
 * vínculos bloqueiam sem campo novo na API — decisão registrada no CLAUDE.md.
 */
export function DeleteCategoryDialog({
  category,
  onOpenChange,
}: {
  /** Presente = diálogo aberto para esta categoria. */
  category?: CategorySummary;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  useEffect(() => {
    if (category) setBlockedReason(null);
  }, [category]);

  const mutation = useMutation({
    mutationFn: () => api.delete(`/categories/${category!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Categoria excluída.");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      // `apiFetch` já extrai o `detail` do corpo; o 409 chega como a frase do
      // backend ("Categoria em uso por transações ou parcelamentos...").
      if (/em uso/i.test(error.message)) {
        setBlockedReason(error.message);
        return;
      }
      toast.error(error.message);
    },
  });

  const isBlocked = blockedReason !== null;

  return (
    <AlertDialog open={category !== undefined} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBlocked ? "Não é possível excluir" : `Excluir "${category?.name}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isBlocked
              ? blockedReason
              : "Esta ação não pode ser desfeita. A categoria some da listagem e dos relatórios."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            {isBlocked ? "Entendi" : "Cancelar"}
          </AlertDialogCancel>
          {/*
            Some quando bloqueado: repetir a ação daria exatamente o mesmo 409.
          */}
          {!isBlocked && (
            <AlertDialogAction
              onClick={(event) => {
                // Sem isto o Radix fecha o diálogo antes da resposta, e o 409
                // nunca chegaria a ser exibido.
                event.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
