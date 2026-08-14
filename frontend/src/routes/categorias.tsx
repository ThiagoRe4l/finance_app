import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, AlertCircle, RotateCw, Pencil, Trash2 } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import { categoryProgress } from "@/lib/categories";
import { resolveCategoryIcon } from "@/lib/category-icons";
import { CategoryFormDialog } from "@/components/categories/CategoryFormDialog";
import { DeleteCategoryDialog } from "@/components/categories/DeleteCategoryDialog";
import type { CategorySummary } from "@/lib/dashboard";

export const Route = createFileRoute("/categorias")({
  head: () => ({
    meta: [
      { title: "Categorias — Fisco" },
      { name: "description", content: "Organize seus gastos por categorias e acompanhe o orçamento." },
    ],
  }),
  component: CategoriasPage,
});

// Com barra: é coleção (`@router.get("/")`), e sem ela o FastAPI responde 307.
const CATEGORIES_ENDPOINT = "/categories/";

const ALERT_COLOR = "oklch(0.6 0.2 25)";

function LoadingCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="bg-card p-6 rounded-2xl border border-border shadow-sm">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-10" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full mb-4" />
          <div className="flex items-baseline justify-between">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ message, onRetry, isRetrying }: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Não foi possível carregar as categorias</p>
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

function CategoryCard({ category, onEdit, onDelete }: {
  category: CategorySummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const progress = categoryProgress(category.spent, category.budget);
  const Icon = resolveCategoryIcon(category.icon_name);

  return (
    <div className="group bg-card p-6 rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow">
      {/*
        Editar/excluir não existiam na UI — nem ícone, nem menu. Num card não há
        área natural para eles, então aparecem no hover, no canto. Em toque não
        há hover: `focus-within` mantém acessível por teclado, e os botões
        seguem no DOM (só invisíveis), então leitor de tela os encontra.
      */}
      <div className="flex justify-end gap-1 -mt-2 -mr-2 mb-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${category.name}`}
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir ${category.name}`}
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `color-mix(in oklab, ${category.color} 15%, transparent)` }}
          >
            <Icon className="h-5 w-5" style={{ color: category.color }} />
          </div>
          <div>
            <p className="text-sm font-medium">{category.name}</p>
            <p className="text-xs text-muted-foreground">
              {category.txs_count} {category.txs_count === 1 ? "transação" : "transações"}
            </p>
          </div>
        </div>
        {/*
          Texto usa `percent` (real, pode passar de 100); a barra usa `width`
          (clampada). Alimentar os dois com o valor clampado — como o mock fazia
          — faz uma categoria em 120% aparecer como exatamente "100%".
        */}
        {progress.hasBudget ? (
          <span
            className={`text-xs font-medium tabular-nums ${
              progress.isAlert ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {progress.percent!.toFixed(0)}%
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">sem orçamento</span>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
          {progress.hasBudget && (
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress.width}%`,
                backgroundColor: progress.isAlert ? ALERT_COLOR : category.color,
              }}
            />
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-xl font-semibold tabular-nums">{formatBRL(progress.spent)}</span>
        {progress.hasBudget ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            de {formatBRL(progress.budget)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">sem orçamento definido</span>
        )}
      </div>
    </div>
  );
}

function CategoriasPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<CategorySummary | undefined>();
  const [deleting, setDeleting] = useState<CategorySummary | undefined>();

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategorySummary[]>(CATEGORIES_ENDPOINT),
  });

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">
        <PageHeader
          eyebrow="Mês corrente"
          title="Categorias"
          description="Acompanhe o uso do orçamento de cada categoria."
          action={
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> Nova categoria
            </button>
          }
        />

        {isError ? (
          <ErrorBanner
            message={error instanceof Error ? error.message : "Erro desconhecido."}
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : isPending ? (
          <LoadingCards />
        ) : data.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border shadow-sm px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada ainda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onEdit={() => setEditing(category)}
                onDelete={() => setDeleting(category)}
              />
            ))}
          </div>
        )}

        {/*
          Um diálogo de formulário por modo: `category` presente = edição. O
          `key` força remontagem ao trocar de categoria, senão o estado interno
          do formulário anterior vazaria para o próximo.
        */}
        <CategoryFormDialog open={isCreating} onOpenChange={setIsCreating} />
        <CategoryFormDialog
          key={editing?.id}
          open={editing !== undefined}
          onOpenChange={(open) => !open && setEditing(undefined)}
          category={editing}
        />
        <DeleteCategoryDialog
          category={deleting}
          onOpenChange={(open) => !open && setDeleting(undefined)}
        />
      </main>
    </div>
  );
}
