import { createFileRoute, redirect } from "@tanstack/react-router";

import { parsePeriodParam } from "@/lib/period";

/**
 * A tela de Relatórios foi unificada ao Dashboard (U-1,
 * `docs/integracao-frontend.md`): receitas, despesas, comparativo mensal,
 * maiores categorias e o insight de parcelamentos já estão lá. A rota antiga
 * continua existindo só para o link salvo e o histórico do navegador não darem
 * 404, e leva o `?periodo=` junto.
 */
export const Route = createFileRoute("/relatorios")({
  validateSearch: (search: Record<string, unknown>): { periodo?: string } => {
    const periodo = parsePeriodParam(search.periodo);
    return periodo === undefined ? {} : { periodo };
  },
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/",
      search: search.periodo === undefined ? {} : { periodo: search.periodo },
    });
  },
});
