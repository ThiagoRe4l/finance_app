/**
 * `CategoryBars` deixou de dizer "Mês corrente" fixo: com o filtro de período
 * (`docs/periodos.md`), a distribuição é do período escolhido. Escrito **antes**
 * da implementação (13/11/2026): hoje o componente ignora `periodLabel` e
 * continua escrevendo "Mês corrente".
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CategoryBars } from "./CategoryBars";

describe("CategoryBars", () => {
  it("mostra o período recebido, não 'Mês corrente' fixo", () => {
    render(
      <CategoryBars
        categories={[]}
        totalExpenses="0.00"
        periodLabel="Dezembro de 2026"
      />,
    );

    expect(screen.getByText("Dezembro de 2026")).toBeTruthy();
    expect(screen.queryByText("Mês corrente")).toBeNull();
  });

  it("o estado vazio fala do período, não de 'neste mês'", () => {
    render(
      <CategoryBars
        categories={[]}
        totalExpenses="0.00"
        periodLabel="Todos os meses"
      />,
    );

    expect(
      screen.getByText("Nenhuma despesa registrada neste período."),
    ).toBeTruthy();
  });
});
