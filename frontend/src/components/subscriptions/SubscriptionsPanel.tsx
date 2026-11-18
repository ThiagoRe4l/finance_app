import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Repeat,
  AlertCircle,
  RotateCw,
  Pencil,
  Trash2,
  Loader2,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import { toISODate } from "@/lib/date";
import {
  describeCharge,
  type Subscription,
  type SubscriptionsSummary,
} from "@/lib/subscriptions";
import { SubscriptionFormDialog } from "./SubscriptionFormDialog";
import { DeleteSubscriptionDialog } from "./DeleteSubscriptionDialog";
import { SUBSCRIPTION_QUERY_KEYS } from "./query-keys";

// Coleção sem barra final (D-Vercel-3); `/summary` é rota específica.
const SUBSCRIPTIONS_ENDPOINT = "/subscriptions";
const SUMMARY_ENDPOINT = "/subscriptions/summary";

function ErrorBanner({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Não foi possível carregar as assinaturas
          </p>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="flex items-center gap-2 px-4 py-2 min-h-11 lg:min-h-0 rounded-lg border border-border bg-card text-sm hover:bg-secondary transition-colors disabled:opacity-60 shrink-0"
      >
        <RotateCw className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
        {isRetrying ? "Tentando..." : "Tentar novamente"}
      </button>
    </div>
  );
}

function TotalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-6 rounded-2xl border border-border shadow-sm">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </p>
      {/* Dinheiro não quebra nem é cortado (M-13). */}
      <p className="text-2xl font-semibold tabular-nums whitespace-nowrap">
        {value}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="bg-card p-6 rounded-2xl border border-border shadow-sm"
          >
            <Skeleton className="h-3 w-32 mb-3" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </section>
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="bg-card p-6 rounded-2xl border border-border shadow-sm"
          >
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SubscriptionCard({
  subscription,
  onEdit,
  onDelete,
}: {
  subscription: Subscription;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const isEnded = subscription.status === "encerrada";

  /*
   * Encerrar e reativar são o `PATCH ended_on` (R-4): parar de cobrar mantendo o
   * histórico, que é diferente de excluir. Reversível, então sem confirmação.
   */
  const toggle = useMutation({
    mutationFn: () =>
      api.patch(`/subscriptions/${subscription.id}`, {
        ended_on: isEnded ? null : toISODate(new Date()),
      }),
    onSuccess: () => {
      for (const key of SUBSCRIPTION_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(
        isEnded
          ? `${subscription.title}: assinatura reativada.`
          : `${subscription.title}: assinatura encerrada.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div
      className={`bg-card p-6 rounded-2xl border border-border shadow-sm ${
        isEnded ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-secondary flex items-center justify-center">
            <Repeat className="h-5 w-5 text-brand" />
          </div>
          <div className="min-w-0">
            <p className="min-w-0 font-display text-lg font-medium wrap-anywhere">
              {subscription.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {subscription.category.name} · {describeCharge(subscription)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:gap-8">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Por mês</p>
            <p className="font-display text-base tabular-nums whitespace-nowrap">
              {formatBRL(subscription.amount)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Editar ${subscription.title}`}
              className="h-11 w-11 lg:h-8 lg:w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Excluir ${subscription.title}`}
              className="h-11 w-11 lg:h-8 lg:w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => toggle.mutate()}
              disabled={toggle.isPending}
              aria-label={`${isEnded ? "Reativar" : "Encerrar"} ${subscription.title}`}
              className="flex items-center gap-1 h-11 lg:h-8 px-3 rounded-md border border-border text-xs hover:bg-secondary transition-colors disabled:opacity-60"
            >
              {toggle.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isEnded ? (
                <PlayCircle className="h-3.5 w-3.5" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              {isEnded ? "Reativar" : "Encerrar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Aba de assinaturas da tela de Recorrências (`docs/recorrencias.md`).
 *
 * Os dois totais vêm de `GET /subscriptions/summary`; nada é somado no cliente.
 * A cobrança em si não passa por aqui: o backend a lança quando o dia chega, e
 * o `SubscriptionSync` pede isso ao abrir o app.
 */
export function SubscriptionsPanel({
  isCreating,
  onCreatingChange: setIsCreating,
}: {
  isCreating: boolean;
  onCreatingChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState<Subscription | undefined>();
  const [deleting, setDeleting] = useState<Subscription | undefined>();

  const list = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => api.get<Subscription[]>(SUBSCRIPTIONS_ENDPOINT),
  });
  const summary = useQuery({
    queryKey: ["subscriptions", "summary"],
    queryFn: () => api.get<SubscriptionsSummary>(SUMMARY_ENDPOINT),
  });

  const isPending = list.isPending || summary.isPending;
  const isError = list.isError || summary.isError;
  const error = list.error ?? summary.error;
  const isFetching = list.isFetching || summary.isFetching;

  const retry = () => {
    list.refetch();
    summary.refetch();
  };

  return (
    <>
      {isError ? (
        <ErrorBanner
          message={
            error instanceof Error ? error.message : "Erro desconhecido."
          }
          onRetry={retry}
          isRetrying={isFetching}
        />
      ) : isPending ? (
        <LoadingState />
      ) : (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
            <TotalCard
              label="Total por mês"
              value={formatBRL(summary.data.monthly_amount)}
            />
            <TotalCard
              label="Assinaturas ativas"
              value={String(summary.data.active_count)}
            />
          </section>

          {list.data.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border shadow-sm px-6 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhuma assinatura cadastrada ainda. Cadastre uma vez e a
                cobrança entra sozinha todo mês.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {list.data.map((subscription) => (
                <SubscriptionCard
                  key={subscription.id}
                  subscription={subscription}
                  onEdit={() => setEditing(subscription)}
                  onDelete={() => setDeleting(subscription)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <SubscriptionFormDialog open={isCreating} onOpenChange={setIsCreating} />
      <SubscriptionFormDialog
        key={editing?.id}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        subscription={editing}
      />
      <DeleteSubscriptionDialog
        subscription={deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
      />
    </>
  );
}
