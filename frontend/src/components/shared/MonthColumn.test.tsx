/**
 * Tooltip das colunas dos gráficos de meses (`docs/periodos.md`, fatia 3).
 *
 * Escrito **antes** da implementação (13/11/2026). Hoje fica vermelho porque
 * `MonthColumn.tsx` não existe. O que se trava: abre com hover, com clique/toque
 * e com teclado; fecha do mesmo jeito; mostra Entradas e Saídas formatadas; e
 * marca mês futuro como projeção. O posicionamento (portal, colisão com a borda)
 * é do Radix e não se mede no jsdom.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { formatBRL } from "@/lib/money";
import { MonthColumn } from "./MonthColumn";

const NOV = {
  month: "Nov",
  month_key: "2026-11",
  income: "1000.00",
  outcome: "250.50",
};

// O Testing Library normaliza o espaço inseparável do `formatBRL` para espaço
// comum no texto do DOM, mas não no texto procurado.
const visible = (value: string) => formatBRL(value).replace(/\s/g, " ");

function setup(point = NOV) {
  render(
    <MonthColumn point={point} currentKey="2026-11" className="h-48">
      <span>coluna</span>
    </MonthColumn>,
  );
  return screen.getByRole("button", {
    name: /Novembro de 2026|Dezembro de 2026/,
  });
}

describe("MonthColumn", () => {
  it("é um botão com o resumo do mês no nome acessível e leva os filhos", () => {
    const column = setup();

    expect(column.getAttribute("aria-label")).toBe(
      `Novembro de 2026: entradas ${formatBRL("1000.00")}, saídas ${formatBRL("250.50")}`,
    );
    expect(column.textContent).toContain("coluna");
  });

  it("começa fechado", () => {
    setup();
    expect(screen.queryByText("Entradas")).toBeNull();
  });

  it("clique (ou toque) abre com os valores formatados, e outro clique fecha", async () => {
    const user = userEvent.setup();
    const column = setup();

    await user.click(column);
    expect(await screen.findByText("Entradas")).toBeTruthy();
    expect(screen.getByText("Saídas")).toBeTruthy();
    expect(screen.getByText(visible("1000.00"))).toBeTruthy();
    expect(screen.getByText(visible("250.50"))).toBeTruthy();
    expect(screen.getByText("Novembro de 2026")).toBeTruthy();

    await user.click(column);
    expect(screen.queryByText("Entradas")).toBeNull();
  });

  it("passar o mouse abre; tirar o mouse fecha", async () => {
    const user = userEvent.setup();
    const column = setup();

    await user.hover(column);
    expect(await screen.findByText("Entradas")).toBeTruthy();

    await user.unhover(column);
    expect(screen.queryByText("Entradas")).toBeNull();
  });

  it("teclado: Enter abre e Esc fecha", async () => {
    const user = userEvent.setup();
    setup();

    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Entradas")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Entradas")).toBeNull();
  });

  it("mês depois do corrente aparece como projeção", async () => {
    const user = userEvent.setup();
    const column = setup({ ...NOV, month: "Dez", month_key: "2026-12" });

    await user.click(column);
    expect(await screen.findByText("Dezembro de 2026 · Projeção")).toBeTruthy();
  });
});
