/**
 * Tema 60 · 30 · 10 (`docs/tema.md`, D-Tema-1 a D-Tema-6).
 *
 * Escrito **antes** da implementação. Duas camadas:
 *
 * 1. **Tokens do `styles.css`:** a paleta pedida, o laranja como ação principal
 *    e o contraste de cada par de texto — calculado, não visto.
 * 2. **Contrato sobre arquivo:** o menu escuro usa os tokens `--sidebar*`, o
 *    laranja não é texto, e não sobra cor de entrada/saída escrita à mão.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { contrastRatio, hexToRgb, parseOklch, type Rgb } from "./color.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");

const CSS = read("../styles.css");

/** As variáveis dos blocos `:root { … }` (o escuro `.dark` fica de fora). */
function rootTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const block of CSS.matchAll(/(?:^|\n):root\s*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[m[1]] = m[2].trim();
    }
  }
  return tokens;
}

const T = rootTokens();

function rgb(name: string): Rgb {
  const value = T[name];
  assert.ok(value, `token --${name} não existe no :root`);
  return parseOklch(value);
}

const HEX = {
  cream: "#F0EDE6",
  paper: "#F7F5F0",
  green: "#1B422F",
  orange: "#FF8A1F",
};

/** Distância máxima por canal (de 0 a 1) entre a cor do token e a pedida. */
function assertColor(name: string, hex: string) {
  const got = rgb(name);
  const want = hexToRgb(hex);
  for (let i = 0; i < 3; i++) {
    assert.ok(
      Math.abs(got[i] - want[i]) < 0.012,
      `--${name} ≠ ${hex} (canal ${i}: ${got[i].toFixed(3)} × ${want[i].toFixed(3)})`,
    );
  }
}

// ── A paleta pedida ──────────────────────────────────────────────────────

test("60%: o fundo é o creme e o cartão é um tom mais claro dele", () => {
  assertColor("background", HEX.cream);
  assertColor("card", HEX.paper);
  assertColor("popover", HEX.paper);
});

test("30%: o verde é texto, marca e menu", () => {
  assertColor("foreground", HEX.green);
  assertColor("brand", HEX.green);
  assertColor("sidebar", HEX.green);
  assertColor("income", HEX.green);
});

test("10%: o laranja é a ação principal, com texto verde em cima", () => {
  assertColor("primary", HEX.orange);
  assertColor("primary-foreground", HEX.green);
  assertColor("expense", HEX.orange);
  assertColor("sidebar-primary", HEX.orange);
  assertColor("sidebar-primary-foreground", HEX.green);
  assertColor("ring", HEX.green);
});

test("o menu escuro tem texto claro e borda própria", () => {
  assertColor("sidebar-foreground", HEX.cream);
  assert.ok(T["sidebar-accent"], "sem --sidebar-accent");
  assert.ok(T["sidebar-border"], "sem --sidebar-border");
});

test("tokens novos registrados no @theme para virar classe (text-brand, bg-income…)", () => {
  for (const name of ["brand", "income", "expense", "expense-text"]) {
    assert.match(
      CSS,
      new RegExp(`--color-${name}:\\s*var\\(--${name}\\)`),
      `--color-${name} fora do @theme inline`,
    );
  }
});

test("a fonte de títulos e números é a Space Grotesk", () => {
  assert.match(CSS, /--font-display:\s*"Space Grotesk"/);
  assert.match(read("../routes/__root.tsx"), /family=Space\+Grotesk/);
});

// ── Contraste, calculado ─────────────────────────────────────────────────

/** [texto, fundo, mínimo, o que é]. 4,5 para texto; 3 para componente. */
const PAIRS: [string, string, number, string][] = [
  ["foreground", "background", 4.5, "texto no fundo"],
  ["card-foreground", "card", 4.5, "texto no cartão"],
  ["popover-foreground", "popover", 4.5, "texto em popover"],
  ["muted-foreground", "background", 4.5, "texto de apoio no fundo"],
  ["muted-foreground", "card", 4.5, "texto de apoio no cartão"],
  ["primary-foreground", "primary", 4.5, "texto do botão principal"],
  ["secondary-foreground", "secondary", 4.5, "texto no botão secundário"],
  ["accent-foreground", "accent", 4.5, "texto em destaque suave"],
  ["destructive", "background", 4.5, "erro no fundo"],
  ["destructive", "card", 4.5, "erro no cartão"],
  ["expense-text", "background", 4.5, "saída em texto no fundo"],
  ["expense-text", "card", 4.5, "saída em texto no cartão"],
  ["income", "background", 4.5, "entrada em texto"],
  ["brand", "background", 4.5, "marca em texto"],
  ["sidebar-foreground", "sidebar", 4.5, "texto do menu"],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5, "item ativo do menu"],
  ["sidebar-primary", "sidebar", 4.5, "rótulo ativo da barra inferior"],
  ["border", "background", 1.2, "a borda existe, sem gritar"],
  ["input", "card", 3, "borda de campo (WCAG 1.4.11)"],
  ["ring", "background", 3, "anel de foco"],
  ["sidebar-ring", "sidebar", 3, "anel de foco no menu"],
];

for (const [fg, bg, min, what] of PAIRS) {
  test(`contraste: ${what} (--${fg} sobre --${bg}) ≥ ${min}:1`, () => {
    const ratio = contrastRatio(rgb(fg), rgb(bg));
    assert.ok(ratio >= min, `${ratio.toFixed(2)}:1`);
  });
}

test("o laranja puro NÃO serve de texto sobre o creme (por isso existe --expense-text)", () => {
  // Trava a razão de D-Tema-2: se alguém trocar `text-expense-text` por
  // `text-expense`, o teste de arquivo abaixo pega; aqui fica o número.
  assert.ok(contrastRatio(rgb("expense"), rgb("background")) < 3);
});

test("erro (vermelho) e saída (laranja) são cores diferentes", () => {
  const d = rgb("destructive");
  const e = rgb("expense-text");
  const distance = Math.hypot(d[0] - e[0], d[1] - e[1], d[2] - e[2]);
  assert.ok(distance > 0.15, `distância ${distance.toFixed(3)}`);
});

// ── Contrato sobre arquivo ───────────────────────────────────────────────

const CHROME = [
  "../components/dashboard/Sidebar.tsx",
  "../components/layout/BottomNav.tsx",
  "../components/layout/TopBar.tsx",
  "../components/auth/UserMenu.tsx",
];

test("o menu (Sidebar, barras e UserMenu) usa os tokens --sidebar*, não os do conteúdo", () => {
  for (const file of CHROME) {
    const src = read(file);
    assert.match(src, /sidebar-/, `${file} sem token sidebar-*`);
    assert.doesNotMatch(
      src,
      /\b(?:bg-background|text-muted-foreground|hover:bg-secondary|text-primary(?![\w-]))/,
      `${file} ainda usa classe do conteúdo claro`,
    );
  }
  assert.match(read(CHROME[0]), /bg-sidebar\b/);
  assert.match(read(CHROME[1]), /bg-sidebar\b/);
  assert.match(read(CHROME[2]), /bg-sidebar\b/);
});

test("item ativo do menu: laranja com texto verde; na barra inferior, rótulo laranja", () => {
  assert.match(
    read(CHROME[0]),
    /data-\[status=active\]:bg-sidebar-primary[^"]*data-\[status=active\]:text-sidebar-primary-foreground/,
  );
  assert.match(read(CHROME[1]), /aria-\[current=page\]:text-sidebar-primary/);
});

test("nenhum `text-primary` sobrou: laranja não é texto (D-Tema-2)", () => {
  for (const file of [
    "../components/installments/InstallmentsPanel.tsx",
    "../components/subscriptions/SubscriptionsPanel.tsx",
    ...CHROME,
  ]) {
    assert.doesNotMatch(read(file), /\btext-primary(?![\w-])/, file);
  }
});

test("cor de entrada e saída vem de token, não de oklch escrito à mão", () => {
  for (const file of [
    "../components/dashboard/MetricCard.tsx",
    "../components/dashboard/Transactions.tsx",
    "../components/transactions/ImportInvoiceDialog.tsx",
    "../components/installments/InstallmentsPanel.tsx",
    "../routes/transacoes.tsx",
  ]) {
    assert.doesNotMatch(
      read(file),
      /oklch\(0\.\d+[_ ]0\.\d+[_ ]155\)/,
      `${file}: verde escrito à mão`,
    );
  }
  assert.match(read("../components/dashboard/MetricCard.tsx"), /text-income/);
  assert.match(read("../routes/transacoes.tsx"), /text-income/);
});

test("Fluxo Mensal e tooltip: entrada em verde, saída em laranja", () => {
  for (const file of [
    "../components/dashboard/CashFlow.tsx",
    "../components/shared/MonthColumn.tsx",
  ]) {
    const src = read(file);
    assert.match(src, /bg-income/, `${file} sem bg-income`);
    assert.match(src, /bg-expense/, `${file} sem bg-expense`);
    assert.doesNotMatch(src, /rounded-full bg-border|rounded-t bg-border/);
  }
});

test("a distribuição de gastos e o alerta de orçamento usam o laranja, não o vermelho de erro", () => {
  assert.match(
    read("../routes/categorias.tsx"),
    /ALERT_COLOR = "var\(--expense/,
  );
});

test("títulos e valores usam a fonte display", () => {
  assert.match(read("../components/dashboard/PageHeader.tsx"), /font-display/);
  assert.match(read("../components/dashboard/MetricCard.tsx"), /font-display/);
});
