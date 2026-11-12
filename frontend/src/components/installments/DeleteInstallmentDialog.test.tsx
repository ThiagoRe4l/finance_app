/**
 * Exclusão de parcelamento (P-6): o "Excluir" chama o `DELETE` do id certo.
 *
 * ⚠️ O defeito do título vazio durante a animação de fechar (revisão de
 * 12/11/2026) **não** é testável aqui: o jsdom não anima, e o Radix desmonta o
 * conteúdo na hora em que `open` vira falso. Um teste para ele passaria com e
 * sem a correção (verificado reintroduzindo o defeito); fica com a conferência
 * visual.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { DeleteInstallmentDialog } from "./DeleteInstallmentDialog";
import type { Installment } from "@/lib/installments";

afterEach(() => vi.unstubAllGlobals());

describe("DeleteInstallmentDialog", () => {
  it("confirma com DELETE no parcelamento aberto e fecha", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <DeleteInstallmentDialog
          installment={{ id: 7, title: "Geladeira Brastemp" } as Installment}
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Excluir "Geladeira Brastemp"?')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/installments\/7$/);
    expect(init.method).toBe("DELETE");
  });
});
