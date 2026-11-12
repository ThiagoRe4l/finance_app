/**
 * O defeito de 13/08/2026 (CLAUDE.md, "Primeiro caso concreto"): "Despesas
 * +325,8%" exibia seta para baixo, porque o ícone saía do `tone`. A função
 * pura `trendFromDelta` estava certa; o erro era a ligação no componente,
 * que nenhum teste da época alcançava.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MetricCard } from "./MetricCard";

function icon(container: HTMLElement) {
  return container.querySelector("svg")?.getAttribute("class") ?? "";
}

describe("MetricCard", () => {
  it("despesa subindo: seta para cima, valor vermelho", () => {
    const { container } = render(
      <MetricCard
        label="Despesas"
        value="R$ 3.382,80"
        delta="+325,8% vs mês anterior"
        tone="negative"
        trend="up"
      />,
    );
    expect(icon(container)).toMatch(/trending-up/);
    expect(screen.getByText("R$ 3.382,80").className).toMatch(
      /text-destructive/,
    );
  });

  it("saldo caindo: seta para baixo, mesmo com tom positivo", () => {
    const { container } = render(
      <MetricCard
        label="Saldo"
        value="R$ 10,00"
        delta="-3,0%"
        tone="positive"
        trend="down"
      />,
    );
    expect(icon(container)).toMatch(/trending-down/);
  });

  it("sem delta não desenha seta nem rodapé", () => {
    const { container } = render(
      <MetricCard label="Receitas" value="R$ 0,00" />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
