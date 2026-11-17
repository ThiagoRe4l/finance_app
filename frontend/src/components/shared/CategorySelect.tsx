import { useQuery } from "@tanstack/react-query";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { orderCategories } from "@/lib/last-category";
import { cn } from "@/lib/utils";
import { resolveCategoryIcon } from "@/lib/category-icons";
import type { CategorySummary } from "@/lib/dashboard";

/**
 * Seletor de categoria com ícone e cor.
 *
 * Extraído ao ser usado pela segunda tela (transação e parcelamento). A busca
 * fica aqui dentro, não no formulário: as duas telas precisam da mesma lista,
 * e o `queryKey` compartilhado faz o TanStack Query servir as duas do mesmo
 * cache — inclusive depois de uma categoria ser criada ou editada, já que os
 * diálogos de Categorias invalidam essa mesma chave.
 */
export function CategorySelect({
  id,
  value,
  onValueChange,
  disabled,
  triggerClassName,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /** Classe extra do gatilho; sem ela, o gatilho é o do shadcn (Parcelamentos). */
  triggerClassName?: string;
}) {
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategorySummary[]>("/categories"),
  });

  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled || categories.isPending}
    >
      {/*
        `min-w-0`: o gatilho é item de grade, e sem isto o nome longo
        selecionado o alarga além da coluna (mediu 407 px a 360, M-16). A seta
        é filha direta do gatilho, em `ui/`: sem `shrink-0` ela é espremida.
      */}
      <SelectTrigger
        id={id}
        className={cn("min-w-0 [&>svg]:shrink-0", triggerClassName)}
      >
        <SelectValue
          placeholder={categories.isPending ? "Carregando..." : "Selecione"}
        />
      </SelectTrigger>
      {/*
        O Radix dá `min-width: max-content` ao invólucro da lista: sem este
        limite, um nome longo a alarga além da tela (M-16).
      */}
      <SelectContent className="max-w-(--radix-select-content-available-width)">
        {orderCategories(categories.data ?? []).map((category) => {
          const Icon = resolveCategoryIcon(category.icon_name);
          return (
            <SelectItem key={category.id} value={String(category.id)}>
              <span className="flex min-w-0 wrap-anywhere items-center gap-2">
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: category.color }}
                />
                {/* Reticências só no gatilho; na lista, o nome quebra. */}
                <span className="min-w-0 wrap-anywhere in-[[role=combobox]]:truncate">
                  {category.name}
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
