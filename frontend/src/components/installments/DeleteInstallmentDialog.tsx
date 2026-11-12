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
import type { Installment } from "@/lib/installments";
import { INSTALLMENT_QUERY_KEYS } from "./query-keys";

/**
 * Confirmação de exclusão de parcelamento (P-6).
 *
 * O efeito colateral é o que o usuário precisa saber antes: as parcelas
 * **geradas** saem junto — do extrato, dos totais e do saldo. As lançadas à mão
 * ficam, só desvinculadas.
 */
export function DeleteInstallmentDialog({
  installment,
  onOpenChange,
}: {
  installment?: Installment;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  // O último parcelamento aberto fica guardado: durante a animação de fechar,
  // `installment` já é undefined e o título piscaria `Excluir ""?`.
  const [shown, setShown] = useState(installment);
  useEffect(() => {
    if (installment) setShown(installment);
  }, [installment]);

  const mutation = useMutation({
    mutationFn: () => api.delete(`/installments/${shown!.id}`),
    onSuccess: () => {
      for (const key of INSTALLMENT_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Parcelamento excluído.");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={installment !== undefined} onOpenChange={onOpenChange}>
      {/* Centrado, com margem lateral e cantos no celular (M-3, M-12). */}
      <AlertDialogContent className="max-sm:w-[calc(100%-2rem)] max-sm:rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir "{shown?.title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação não pode ser desfeita. As parcelas geradas por este
            parcelamento saem das transações e dos totais, e o saldo da conta é
            ajustado. Transações lançadas à mão continuam, sem o vínculo.
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
