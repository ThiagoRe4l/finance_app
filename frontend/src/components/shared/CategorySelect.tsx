import { useQuery } from "@tanstack/react-query";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
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
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<CategorySummary[]>("/categories/"),
  });

  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled || categories.isPending}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={categories.isPending ? "Carregando..." : "Selecione"} />
      </SelectTrigger>
      <SelectContent>
        {(categories.data ?? []).map((category) => {
          const Icon = resolveCategoryIcon(category.icon_name);
          return (
            <SelectItem key={category.id} value={String(category.id)}>
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" style={{ color: category.color }} />
                {category.name}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
