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
import type { Subscription } from "@/lib/subscriptions";
import { SUBSCRIPTION_QUERY_KEYS } from "./query-keys";

/**
 * Confirmação de exclusão de assinatura (R-4).
 *
 * O que o usuário precisa saber antes: as cobranças **já lançadas** ficam no
 * extrato (o dinheiro saiu de verdade), só sem o vínculo, e nenhuma nova será
 * lançada. Para parar de cobrar mantendo o histórico, o caminho é "Encerrar".
 */
export function DeleteSubscriptionDialog({
  subscription,
  onOpenChange,
}: {
  subscription?: Subscription;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  // Guarda a última assinatura aberta: durante a animação de fechar,
  // `subscription` já é undefined e o título piscaria `Excluir ""?`.
  const [shown, setShown] = useState(subscription);
  useEffect(() => {
    if (subscription) setShown(subscription);
  }, [subscription]);

  const mutation = useMutation({
    mutationFn: () => api.delete(`/subscriptions/${shown!.id}`),
    onSuccess: () => {
      for (const key of SUBSCRIPTION_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Assinatura excluída.");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={subscription !== undefined} onOpenChange={onOpenChange}>
      {/* Centrado, com margem lateral e cantos no celular (M-3, M-12). */}
      <AlertDialogContent className="max-sm:w-[calc(100%-2rem)] max-sm:rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl font-medium wrap-anywhere">
            Excluir "{shown?.title}"?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação não pode ser desfeita. As cobranças já lançadas continuam
            no extrato, sem o vínculo com a assinatura, e nenhuma cobrança nova
            será lançada. Para só parar de cobrar e manter o histórico, use
            "Encerrar".
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={mutation.isPending}
            className="h-11 sm:h-9"
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
            className="h-11 sm:h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
