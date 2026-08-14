import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatBRL } from "@/lib/money";
import { categoryFormSchema, type CategoryFormInput } from "@/lib/category-form";
import { CATEGORY_ICON_NAMES, resolveCategoryIcon } from "@/lib/category-icons";
import type { CategorySummary } from "@/lib/dashboard";

/**
 * Criação e edição de categoria no mesmo componente.
 *
 * O `PATCH` aceita os mesmos quatro campos do `POST` — diferente da transação e
 * do parcelamento, onde o update recusa campos que o create exige. Por isso
 * aqui um componente serve aos dois modos sem desabilitar nada.
 *
 * Toda validação e conversão vive em `categoryFormSchema`, testado no runner
 * nativo. O componente só coleta texto, chama o schema e mostra o que voltar.
 */

// Paleta fechada, alinhada às cores do seed. Um campo de texto livre para
// `color` deixaria o usuário quebrar o `color-mix` do card sem perceber.
const COLORS = [
  "oklch(0.45 0.04 235)",
  "oklch(0.6 0.15 155)",
  "oklch(0.65 0.18 50)",
  "oklch(0.6 0.2 300)",
  "oklch(0.6 0.2 25)",
  "oklch(0.55 0.15 200)",
  "oklch(0.55 0.05 250)",
  "oklch(0.55 0.12 265)",
  "oklch(0.58 0.08 85)",
];

const EMPTY: CategoryFormInput = {
  name: "",
  icon_name: CATEGORY_ICON_NAMES[0],
  color: COLORS[0],
  budget: "",
};

type FieldErrors = Partial<Record<keyof CategoryFormInput, string>>;

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = edição; ausente = criação. */
  category?: CategorySummary;
}) {
  const isEditing = category !== undefined;
  const queryClient = useQueryClient();
  const [values, setValues] = useState<CategoryFormInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setValues(
      category
        ? {
            name: category.name,
            icon_name: category.icon_name,
            color: category.color,
            // O valor vem canônico da API ("1500.00") e o campo é pt-BR:
            // `formatBRL` sem o símbolo devolve "1.500,00".
            budget: formatBRL(category.budget).replace(/[^\d.,-]/g, ""),
          }
        : EMPTY,
    );
  }, [open, category]);

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      isEditing
        ? api.patch(`/categories/${category!.id}`, payload)
        : api.post("/categories/", payload),
    onSuccess: () => {
      // Categoria aparece no dashboard também — invalidar as duas evita a tela
      // vizinha ficar com dado velho até um reload.
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(isEditing ? "Categoria atualizada." : "Categoria criada.");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      // O backend devolve 400 com "Categoria já existe." — é erro de um campo
      // específico, então vira mensagem inline em vez de toast genérico.
      if (/já existe/i.test(error.message)) {
        setErrors({ name: error.message });
        return;
      }
      toast.error(error.message);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = categoryFormSchema.safeParse(values);

    if (!result.success) {
      const next: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof CategoryFormInput;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    mutation.mutate(result.data);
  }

  function update<K extends keyof CategoryFormInput>(field: K, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Editar categoria" : "Nova categoria"}</DialogTitle>
            <DialogDescription>
              O orçamento é mensal e pode ficar em branco.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-6">
            <div className="grid gap-2">
              <Label htmlFor="category-name">Nome</Label>
              <Input
                id="category-name"
                value={values.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Alimentação"
                autoFocus
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="category-budget">Orçamento mensal</Label>
              <Input
                id="category-budget"
                value={values.budget}
                onChange={(e) => update("budget", e.target.value)}
                placeholder="1.500,00"
                inputMode="decimal"
              />
              {errors.budget && <p className="text-xs text-destructive">{errors.budget}</p>}
            </div>

            <div className="grid gap-2">
              <Label>Ícone</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_ICON_NAMES.map((name) => {
                  const Icon = resolveCategoryIcon(name);
                  const selected = values.icon_name === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => update("icon_name", name)}
                      title={name}
                      aria-label={name}
                      aria-pressed={selected}
                      className={`h-9 w-9 rounded-lg flex items-center justify-center border transition-colors ${
                        selected
                          ? "border-primary bg-secondary"
                          : "border-border hover:bg-secondary/60"
                      }`}
                    >
                      <Icon className="h-4 w-4" style={{ color: values.color }} />
                    </button>
                  );
                })}
              </div>
              {errors.icon_name && (
                <p className="text-xs text-destructive">{errors.icon_name}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => update("color", color)}
                    aria-label={color}
                    aria-pressed={values.color === color}
                    className={`h-8 w-8 rounded-full border-2 flex items-center justify-center transition-transform ${
                      values.color === color ? "border-foreground scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {values.color === color && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
              {errors.color && <p className="text-xs text-destructive">{errors.color}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
