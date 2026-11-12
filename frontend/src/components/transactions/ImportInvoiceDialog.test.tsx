/**
 * Revisão de 12/11/2026: "Trocar arquivo" voltava à primeira etapa com o campo
 * vazio, mas o estado guardava o PDF anterior — "Ler fatura" relia o arquivo
 * velho sem avisar. Também confere o fluxo de leitura com a API simulada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ImportInvoiceDialog } from "./ImportInvoiceDialog";

const PREVIEW = {
  bank: "itau",
  lines_read: 2,
  items: [
    {
      date: "2026-11-10",
      title: "PADARIA",
      amount: "12.50",
      type: "SAÍDA",
      installment_hint: null,
      is_payment: false,
      duplicate: false,
      selected: true,
      suggested_category_id: null,
      installment_match: null,
    },
  ],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/accounts")) return json([{ id: 1, name: "Itaú" }]);
      if (url.includes("/categories")) return json([]);
      if (url.includes("/imports/invoice/preview")) return json(PREVIEW);
      throw new Error(`fetch inesperado: ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("ImportInvoiceDialog", () => {
  it('"Trocar arquivo" descarta o PDF lido', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportInvoiceDialog open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Lançado na conta Itaú/)).toBeTruthy(),
    );

    const pdf = new File(["%PDF-1.4"], "fatura.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText("Fatura em PDF"), pdf);
    await user.click(screen.getByRole("button", { name: /Ler fatura/ }));

    await waitFor(() => expect(screen.getByText("PADARIA")).toBeTruthy());
    expect(screen.getByText(/Fatura do Itaú/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Trocar arquivo" }));
    const read = screen.getByRole("button", {
      name: /Ler fatura/,
    }) as HTMLButtonElement;
    expect(read.disabled).toBe(true);
  });
});
