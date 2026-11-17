/**
 * Formulário de transação por tipo (T-1, T-2). Escrito antes da implementação.
 *
 * Roda contra um `fetch` simulado. Largura, teclado e a folha embaixo no
 * celular não são testáveis no jsdom: ficam com a conferência no aparelho.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TransactionFormDialog } from "./TransactionFormDialog";

afterEach(() => vi.unstubAllGlobals());

const CATEGORIES = [
  { id: 4, name: "Mercado", color: "#0a0", icon_name: "ShoppingCart" },
  { id: 5, name: "Salário", color: "#00a", icon_name: "Wallet" },
];

function stubApi() {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return json({ id: 1 }, 201);
    }
    if (url.endsWith("/accounts")) return json([{ id: 9, name: "Conta" }]);
    if (url.endsWith("/categories")) return json(CATEGORIES);
    if (url.endsWith("/installments")) {
      return json([
        {
          id: 7,
          title: "Geladeira",
          current_installment: 2,
          total_installments: 10,
        },
      ]);
    }
    return json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return posts;
}

function renderDialog(props: { defaultType?: "ENTRADA" | "SAÍDA" } = {}) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TransactionFormDialog open onOpenChange={() => {}} {...props} />
    </QueryClientProvider>,
  );
  return user;
}

/** "Mais opções" vem recolhido (M2, docs/ux-leis.md): abre antes de usar o raro. */
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Mais opções/ }));
}

async function pick(
  user: ReturnType<typeof userEvent.setup>,
  field: string | RegExp,
  option: string | RegExp,
) {
  await user.click(await screen.findByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("TransactionFormDialog — alternador Entrada/Saída", () => {
  it("abre em Saída por padrão, com parcelamento e despesa fixa em Mais opções", async () => {
    stubApi();
    const user = renderDialog();

    expect(screen.queryByText("Parcelamento")).toBeNull();
    await openMore(user);

    expect(
      screen.getByRole("tab", { name: "Saída", selected: true }),
    ).toBeTruthy();
    expect(screen.getByText("Parcelamento")).toBeTruthy();
    expect(screen.getByText("Despesa fixa")).toBeTruthy();
    expect(screen.queryByText("Entrada fixa")).toBeNull();
  });

  it("defaultType=ENTRADA abre em Entrada: sem parcelamento, com entrada fixa", async () => {
    stubApi();
    const user = renderDialog({ defaultType: "ENTRADA" });
    await openMore(user);

    expect(
      screen.getByRole("tab", { name: "Entrada", selected: true }),
    ).toBeTruthy();
    expect(screen.queryByText("Parcelamento")).toBeNull();
    expect(screen.queryByText("Despesa fixa")).toBeNull();
    expect(screen.getByText("Entrada fixa")).toBeTruthy();
    // Os campos comuns continuam.
    for (const label of ["Descrição", "Valor", "Data", "Categoria"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("trocar de Saída para Entrada esconde o parcelamento e descarta o vínculo", async () => {
    const posts = stubApi();
    const user = renderDialog();

    await openMore(user);
    await pick(user, "Parcelamento", /Geladeira/);
    await user.click(screen.getByRole("tab", { name: "Entrada" }));
    expect(screen.queryByText("Parcelamento")).toBeNull();

    await user.type(screen.getByLabelText("Descrição"), "Salário");
    await user.type(screen.getByLabelText("Valor"), "500000");
    await pick(user, "Categoria", "Salário");
    await user.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toMatch(/\/transactions$/);
    expect(posts[0].body).toMatchObject({
      type: "ENTRADA",
      amount: "5000.00",
      category_id: 5,
    });
    expect(posts[0].body).not.toHaveProperty("installment_id");
  });
});

describe("TransactionFormDialog — valor com máscara", () => {
  it("os dígitos preenchem a partir do centavo e o POST leva o decimal em string", async () => {
    const posts = stubApi();
    const user = renderDialog();

    const amount = screen.getByLabelText("Valor") as HTMLInputElement;
    await user.type(amount, "40000");
    expect(amount.value).toBe("R$ 400,00");

    await user.type(screen.getByLabelText("Descrição"), "Supermercado");
    await pick(user, "Categoria", "Mercado");
    await user.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.amount).toBe("400.00");
    expect(typeof posts[0].body.amount).toBe("string");
  });
});

describe("TransactionFormDialog — criar parcelamento dentro da saída", () => {
  it("'Criar novo parcelamento' mostra os campos do parcelamento", async () => {
    stubApi();
    const user = renderDialog();

    expect(screen.queryByLabelText("Nº de parcelas")).toBeNull();
    await openMore(user);
    await pick(user, "Parcelamento", "Criar novo parcelamento");

    expect(screen.getByLabelText("Nº de parcelas")).toBeTruthy();
    expect(screen.getByLabelText("Parcela atual")).toBeTruthy();
    expect(screen.getByLabelText("Informar")).toBeTruthy();
  });

  it("salvar faz só POST /installments, com os dados da saída", async () => {
    const posts = stubApi();
    const user = renderDialog();

    await user.type(screen.getByLabelText("Descrição"), "Notebook");
    await pick(user, "Categoria", "Mercado");
    await openMore(user);
    await pick(user, "Parcelamento", "Criar novo parcelamento");
    await user.type(screen.getByLabelText(/^Parcela$|^Valor/), "45000");
    await user.type(screen.getByLabelText("Nº de parcelas"), "12");
    await user.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    // Uma chamada só: o parcelamento já grava as parcelas como transações
    // (P-1). Postar também /transactions duplicaria a parcela.
    expect(posts[0].url).toMatch(/\/installments$/);
    expect(posts[0].body).toMatchObject({
      title: "Notebook",
      category_id: 4,
      installment_amount: "450.00",
      current_installment: 1,
      total_installments: 12,
      account_id: 9,
    });
    expect(posts[0].body).toHaveProperty("current_due_date");
  });

  it("despesa fixa fica indisponível enquanto há parcelamento", async () => {
    stubApi();
    const user = renderDialog();
    await openMore(user);
    await pick(user, "Parcelamento", "Criar novo parcelamento");

    const row = screen.getByText("Despesa fixa").closest("div")!
      .parentElement as HTMLElement;
    expect(within(row).getByRole("switch").hasAttribute("disabled")).toBe(true);
  });

  it("erro de parcela atual maior que o total aparece no campo", async () => {
    const posts = stubApi();
    const user = renderDialog();

    await user.type(screen.getByLabelText("Descrição"), "Notebook");
    await pick(user, "Categoria", "Mercado");
    await openMore(user);
    await pick(user, "Parcelamento", "Criar novo parcelamento");
    await user.type(screen.getByLabelText(/^Parcela$|^Valor/), "45000");
    await user.type(screen.getByLabelText("Nº de parcelas"), "3");
    const current = screen.getByLabelText("Parcela atual");
    await user.clear(current);
    await user.type(current, "5");
    await user.click(screen.getByRole("button", { name: "Criar" }));

    expect(await screen.findByText(/não pode ser maior/i)).toBeTruthy();
    expect(posts).toHaveLength(0);
  });
});
