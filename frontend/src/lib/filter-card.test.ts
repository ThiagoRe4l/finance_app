/**
 * Opção B de organização dos filtros (`docs/ux-leis.md`, F-2): abas em
 * sublinhado; em Transações, o período à esquerda e, à direita, Nova, Importar
 * fatura e a busca; em Recorrências, a ação no fim da linha das abas.
 * O período em intervalo vive em `period-range.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) =>
  readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("o cartão de filtros (opção C) saiu", () => {
  assert.ok(
    !existsSync(
      new URL("../components/shared/FilterCard.tsx", import.meta.url),
    ),
  );
  for (const p of ["../routes/transacoes.tsx", "../routes/recorrencias.tsx"]) {
    assert.doesNotMatch(read(p), /FilterCard/, p);
  }
});

test("Transações: Nova, Importar fatura e Busca, nessa ordem, depois do período", () => {
  const src = read("../routes/transacoes.tsx");
  const order = ["<PeriodFilter", "<Plus", "<FileUp", "<Search"].map((t) =>
    src.lastIndexOf(t),
  );
  assert.ok(
    order.every((i) => i >= 0),
    String(order),
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
});

test("Transações: o cabeçalho não tem mais ação", () => {
  const src = read("../routes/transacoes.tsx");
  const header = src.slice(
    src.indexOf("<PageHeader"),
    src.indexOf("/>", src.indexOf("<PageHeader")),
  );
  assert.doesNotMatch(header, /action/);
});

test("abas em sublinhado nas duas telas", () => {
  for (const p of ["../routes/transacoes.tsx", "../routes/recorrencias.tsx"]) {
    const src = read(p);
    assert.match(src, /data-\[state=active\]:border-primary/, p);
    assert.match(src, /rounded-none/, p);
  }
});

test("Recorrências: o botão de criar fica no cabeçalho da lista, não nos painéis", () => {
  const page = read("../routes/recorrencias.tsx");
  assert.match(page, /Nova assinatura/);
  assert.match(page, /Novo parcelamento/);
  for (const p of [
    "../components/subscriptions/SubscriptionsPanel.tsx",
    "../components/installments/InstallmentsPanel.tsx",
  ]) {
    assert.doesNotMatch(read(p), /Nova assinatura|Novo parcelamento/, p);
  }
});

test("o filtro de período não tem mais os atalhos soltos na tela", () => {
  const src = read("../components/shared/PeriodFilter.tsx");
  // Os atalhos continuam, mas dentro do popup (depois do <PopoverContent>).
  assert.ok(src.indexOf("periodShortcuts()") > src.indexOf("<PopoverContent"));
  assert.match(src, /Intervalo/);
});
