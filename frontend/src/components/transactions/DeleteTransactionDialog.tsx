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
import { formatBRL } from "@/lib/money";
import { signedAmount, type Transaction } from "@/lib/transactions";

/**
 * Confirmação de exclusão de transação.
 *
 * Diferente da categoria, aqui **não há 409**: `DELETE /transactions/{id}` só
 * pode dar 204 ou 404. O que existe é um efeito colateral que o usuário precisa
 * saber antes de confirmar — o saldo da conta é estornado, porque
 * `create_transaction` o havia movido.
 */
export function DeleteTransactionDialog({
  transaction,
  onOpenChange,
}: {
  transaction?: Transaction;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.delete(`/transactions/${transaction!.id}`),
    onSuccess: () => {
      for (const key of [["transactions"], ["dashboard"], ["categories"], ["reports"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Transação excluída.");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const amount = transaction ? signedAmount(transaction) : 0;

  return (
    <AlertDialog open={transaction !== undefined} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir "{transaction?.title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {/*
              O estorno não é detalhe de implementação: é a consequência visível
              da ação. Dizer o valor evita a surpresa de ver o saldo mudar.
            */}
            Esta ação não pode ser desfeita. O saldo da conta será ajustado em{" "}
            <strong>{formatBRL(Math.abs(amount))}</strong>
            {amount < 0 ? " a mais" : " a menos"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
