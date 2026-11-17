/**
 * Campo de valor "caixa registradora" (T-3): cada dígito entra pela direita.
 * Escrito antes da implementação.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MoneyInput } from "./MoneyInput";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyInput aria-label="Valor" value={value} onValueChange={setValue} />
      <output data-testid="state">{value}</output>
    </>
  );
}

describe("MoneyInput", () => {
  it("mostra R$ 0,00 como placeholder e abre o teclado numérico", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Valor") as HTMLInputElement;
    expect(input.placeholder).toBe("R$ 0,00");
    expect(input.inputMode).toBe("numeric");
    expect(input.value).toBe("");
  });

  it("os dígitos preenchem a partir do centavo", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Valor") as HTMLInputElement;

    await user.type(input, "4");
    expect(input.value).toBe("R$ 0,04");
    await user.type(input, "0");
    expect(input.value).toBe("R$ 0,40");
    await user.type(input, "00");
    expect(input.value).toBe("R$ 40,00");
    await user.type(input, "000");
    expect(input.value).toBe("R$ 40.000,00");
    expect(screen.getByTestId("state").textContent).toBe("R$ 40.000,00");
  });

  it("letras e símbolos são ignorados", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Valor") as HTMLInputElement;

    await user.type(input, "a1,b2.-");
    expect(input.value).toBe("R$ 0,12");
  });

  it("backspace tira o último dígito", async () => {
    const user = userEvent.setup();
    render(<Harness initial="R$ 1.500,50" />);
    const input = screen.getByLabelText("Valor") as HTMLInputElement;

    await user.click(input);
    await user.keyboard("{End}{Backspace}");
    expect(input.value).toBe("R$ 150,05");
    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}");
    expect(input.value).toBe("R$ 0,01");
    await user.keyboard("{Backspace}");
    expect(input.value).toBe("");
  });

  it("não passa de 12 dígitos", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Valor") as HTMLInputElement;

    await user.type(input, "9999999999999");
    expect(input.value).toBe("R$ 9.999.999.999,99");
  });
});
