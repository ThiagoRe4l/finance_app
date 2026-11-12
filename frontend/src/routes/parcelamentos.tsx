import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  CreditCard,
  AlertCircle,
  RotateCw,
  CheckCircle2,
  Pencil,
  ChevronRight,
  Loader2,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import {
  canAdvance,
  installmentProgress,
  type Installment,
  type InstallmentsSummary,
} from "@/lib/installments";
import { InstallmentFormDialog } from "@/components/installments/InstallmentFormDialog";
import { DeleteInstallmentDialog } from "@/components/installments/DeleteInstallmentDialog";

export const Route = createFileRoute("/parcelamentos")({
  head: () => ({
    meta: [
      { title: "Parcelamentos — Fisco" },
      {
        name: "description",
        content: "Acompanhe parcelas em aberto e o valor comprometido por mês.",
      },
    ],
  }),
  component: ParcelamentosPage,
});

// Coleção precisa da barra; `/summary` é rota específica e não pode ter.
const INSTALLMENTS_ENDPOINT = "/installments/";
const SUMMARY_ENDPOINT = "/installments/summary";

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
            Não foi possível carregar os parcelamentos
          </p>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm hover:bg-secondary transition-colors disabled:opacity-60 shrink-0"
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
      {/* Dinheiro não quebra nem é cortado (M-13, M-14). */}
      <p className="text-2xl font-semibold tabular-nums whitespace-nowrap">
        {value}
      </p>
    </div>
  );
}

function LoadingTotals() {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-6 mb-8">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="bg-card p-6 rounded-2xl border border-border shadow-sm"
        >
          <Skeleton className="h-3 w-32 mb-3" />
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </section>
  );
}

function LoadingCards() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          className="bg-card p-6 rounded-2xl border border-border shadow-sm"
        >
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
            <Skeleton className="h-8 w-40" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

function InstallmentCard({
  installment,
  onEdit,
  onDelete,
}: {
  installment: Installment;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const progress = installmentProgress(
    installment.current_installment,
    installment.total_installments,
  );

  /*
   * Avançar parcela é ação própria, fora do formulário: é a mais frequente da
   * tela (uma por mês, por parcelamento) e a única que **nunca** dá 409 —
   * `current_installment` não está na lista travada pela D15. Abrir um
   * formulário de 7 campos para mudar um número seria atrito desproporcional.
   */
  const advance = useMutation({
    mutationFn: () =>
      api.patch(`/installments/${installment.id}`, {
        current_installment: installment.current_installment + 1,
      }),
    onSuccess: () => {
      for (const key of [["installments"], ["dashboard"], ["reports"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(`${installment.title}: parcela avançada.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div
      className={`bg-card p-6 rounded-2xl border border-border shadow-sm ${
        progress.isPaidOff ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-secondary flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="min-w-0 text-sm font-medium wrap-anywhere">
                {installment.title}
              </p>
              {/*
                Quitado ganha marcador em vez de sumir da listagem: cada card é
                informação discreta, diferente do widget de distribuição do
                Dashboard, onde a barra zerada não diria nada.
              */}
              {progress.isPaidOff && (
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[oklch(0.94_0.06_155)] text-[oklch(0.45_0.15_155)]">
                  <CheckCircle2 className="h-3 w-3" />
                  Quitado
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {installment.category.name} · termina em {installment.end_date}
            </p>
          </div>
        </div>
        {/*
          Abaixo de lg os valores e as ações quebram linha em vez de estourar
          o card (M-14); as ações ficam juntas, à direita.
        */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:gap-8">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Parcela</p>
            <p className="text-sm font-medium tabular-nums">
              {formatBRL(installment.installment_amount)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Restante</p>
            {/* Vem pronto do backend — o front não recalcula. */}
            <p className="text-sm font-medium tabular-nums">
              {formatBRL(installment.remaining_amount)}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Editar ${installment.title}`}
              className="h-11 w-11 lg:h-8 lg:w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {/*
              Os três alvos com 44 px abaixo de lg (M-7, P4; M-14).
            */}
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Excluir ${installment.title}`}
              className="h-11 w-11 lg:h-8 lg:w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            {/*
              Só no modo antigo e enquanto não quitou (S-4): com calendário
              (S-3) a parcela atual muda sozinha com o mês, e o backend recusa
              o PATCH. Quitado não oferece avançar (D13 aceitaria, sem sentido).
            */}
            {canAdvance(installment) && (
              <button
                type="button"
                onClick={() => advance.mutate()}
                disabled={advance.isPending}
                aria-label={`Avançar parcela de ${installment.title}`}
                title="Avançar parcela"
                className="flex items-center gap-1 h-11 lg:h-8 px-3 rounded-md border border-border text-xs hover:bg-secondary transition-colors disabled:opacity-60"
              >
                {advance.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Avançar
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            Parcela {installment.current_installment} de{" "}
            {installment.total_installments}
          </span>
          <span>{progress.percent.toFixed(0)}% pago</span>
        </div>
        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ParcelamentosPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<Installment | undefined>();
  const [deleting, setDeleting] = useState<Installment | undefined>();

  const list = useQuery({
    queryKey: ["installments"],
    queryFn: () => api.get<Installment[]>(INSTALLMENTS_ENDPOINT),
  });
  const summary = useQuery({
    queryKey: ["installments", "summary"],
    queryFn: () => api.get<InstallmentsSummary>(SUMMARY_ENDPOINT),
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
    <AppShell>
      <PageHeader
        eyebrow="Mês corrente"
        title="Parcelamentos"
        description="Compras parceladas em aberto e impacto mensal no orçamento."
        action={
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Novo parcelamento
          </button>
        }
      />

      {isError ? (
        <ErrorBanner
          message={
            error instanceof Error ? error.message : "Erro desconhecido."
          }
          onRetry={retry}
          isRetrying={isFetching}
        />
      ) : isPending ? (
        <>
          <LoadingTotals />
          <LoadingCards />
        </>
      ) : (
        <>
          {/*
              Os três totais vêm de `GET /installments/summary` — nenhum é
              somado no cliente. "Comprometido" e "Ativos" excluem quitados; o
              mock somava a listagem inteira e inflava os dois.
            */}
          <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-6 mb-8">
            <TotalCard
              label="Comprometido/mês"
              value={formatBRL(summary.data.monthly_committed_amount)}
            />
            <TotalCard
              label="Saldo a pagar"
              value={formatBRL(summary.data.remaining_total_amount)}
            />
            <TotalCard
              label="Parcelamentos ativos"
              value={String(summary.data.active_count)}
            />
            {/*
              S-2: o saldo "se todas as parcelas já tivessem saído". O saldo das
              outras telas para em hoje (S-1) e não conta as parcelas futuras.
            */}
            <TotalCard
              label="Saldo comprometido"
              value={formatBRL(summary.data.committed_balance)}
            />
          </section>

          {list.data.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border shadow-sm px-6 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum parcelamento cadastrado ainda.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {list.data.map((installment) => (
                <InstallmentCard
                  key={installment.id}
                  installment={installment}
                  onEdit={() => setEditing(installment)}
                  onDelete={() => setDeleting(installment)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <InstallmentFormDialog open={isCreating} onOpenChange={setIsCreating} />
      <InstallmentFormDialog
        key={editing?.id}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        installment={editing}
      />
      <DeleteInstallmentDialog
        installment={deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
      />
    </AppShell>
  );
}
