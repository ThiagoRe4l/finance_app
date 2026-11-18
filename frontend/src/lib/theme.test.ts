/**
 * Tema Caderno (`docs/tema.md`, D-Cad-1 a D-Cad-5; D-Tema-3 e D-Tema-6 continuam).
 *
 * Reescrito em 18/11/2026 **antes** da implementação da fatia C1: os testes da
 * paleta 60 · 30 · 10 (verde + laranja, menu escuro, Space Grotesk) deram lugar
 * aos do Caderno. Duas camadas:
 *
 * 1. **Tokens do `styles.css`:** a paleta do canvas e o contraste de cada par de
 *    texto — calculado, não visto.
 * 2. **Contrato sobre arquivo:** o menu continua nos tokens `--sidebar*`, o item
 *    ativo é o do canvas, e não sobra cor de entrada/saída escrita à mão.
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

/** As cores do canvas "Fisco — Redesign visual", direção A (D-Cad-1, D-Cad-3). */
const HEX = {
  paper: "#F6F3EC",
  white: "#FFFFFF",
  ink: "#14222B",
  inkMuted: "#5B6670",
  slate: "#26404F",
  paperText: "#FAF8F5",
  income: "#1F7A4D",
  amber: "#D08A3C",
  error: "#B3261E",
  menu: "#F1EDE3",
  rule: "#E4DED1",
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

// ── A paleta do Caderno (D-Cad-1) ────────────────────────────────────────

test("fundo papel; cartão e popover brancos; borda em tom de papel", () => {
  assertColor("background", HEX.paper);
  assertColor("card", HEX.white);
  assertColor("popover", HEX.white);
  assertColor("border", HEX.rule);
});

test("texto em tinta, apoio em cinza-ardósia", () => {
  assertColor("foreground", HEX.ink);
  assertColor("card-foreground", HEX.ink);
  assertColor("popover-foreground", HEX.ink);
  assertColor("muted-foreground", HEX.inkMuted);
});

test("ação principal em ardósia, com texto papel; foco e marca na mesma ardósia", () => {
  assertColor("primary", HEX.slate);
  assertColor("primary-foreground", HEX.paperText);
  assertColor("ring", HEX.slate);
  assertColor("brand", HEX.slate);
});

test("dinheiro: entrada verde, saída âmbar, erro vermelho", () => {
  assertColor("income", HEX.income);
  assertColor("expense", HEX.amber);
  assertColor("destructive", HEX.error);
});

test("menu claro (D-Cad-3): papel mais escuro, texto tinta, ativo em cartão branco", () => {
  assertColor("sidebar", HEX.menu);
  assertColor("sidebar-foreground", HEX.ink);
  assertColor("sidebar-primary", HEX.white);
  assertColor("sidebar-primary-foreground", HEX.ink);
  assertColor("sidebar-border", HEX.rule);
  assert.ok(T["sidebar-accent"], "sem --sidebar-accent");
  assert.ok(T["sidebar-ring"], "sem --sidebar-ring");
});

test("✅ tokens de dinheiro registrados no @theme para virar classe (text-brand, bg-income…)", () => {
  // Regressão de D-Tema-3: já passa.
  for (const name of ["brand", "income", "expense", "expense-text"]) {
    assert.match(
      CSS,
      new RegExp(`--color-${name}:\\s*var\\(--${name}\\)`),
      `--color-${name} fora do @theme inline`,
    );
  }
});

test("a fonte de títulos e números é a Fraunces (D-Cad-4)", () => {
  assert.match(CSS, /--font-display:\s*"Fraunces"/);
  const root = read("../routes/__root.tsx");
  assert.match(root, /family=Fraunces/);
  assert.doesNotMatch(
    root,
    /Space\+Grotesk/,
    "a Space Grotesk ainda é baixada",
  );
});

// ── Contraste, calculado (D-Cad-5) ───────────────────────────────────────

/** [texto, fundo, mínimo, o que é]. 4,5 para texto; 3 para componente. */
const PAIRS: [string, string, number, string][] = [
  ["foreground", "background", 4.5, "texto no fundo"],
  ["card-foreground", "card", 4.5, "texto no cartão"],
  ["popover-foreground", "popover", 4.5, "texto em popover"],
  ["muted-foreground", "background", 4.5, "texto de apoio no fundo"],
  ["muted-foreground", "card", 4.5, "texto de apoio no cartão"],
  ["primary-foreground", "primary", 4.5, "texto do botão principal"],
  ["primary", "background", 4.5, "ação principal como texto (D-Cad-2)"],
  ["secondary-foreground", "secondary", 4.5, "texto no botão secundário"],
  ["accent-foreground", "accent", 4.5, "texto em destaque suave"],
  ["destructive", "background", 4.5, "erro no fundo"],
  ["destructive", "card", 4.5, "erro no cartão"],
  ["expense-text", "background", 4.5, "saída em texto no fundo"],
  ["expense-text", "card", 4.5, "saída em texto no cartão"],
  ["income", "background", 4.5, "entrada em texto no fundo"],
  ["income", "card", 4.5, "entrada em texto no cartão"],
  ["brand", "background", 4.5, "marca em texto"],
  ["sidebar-foreground", "sidebar", 4.5, "texto do menu"],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5, "item ativo do menu"],
  [
    "sidebar-foreground",
    "sidebar-accent",
    4.5,
    "texto sobre o hover e a pílula do menu",
  ],
  ["border", "background", 1.05, "a borda existe, sem gritar"],
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

test("o âmbar puro NÃO serve de texto sobre o papel (por isso existe --expense-text)", () => {
  assert.ok(contrastRatio(rgb("expense"), rgb("background")) < 3);
});

test("erro (vermelho) e saída (âmbar) são cores diferentes", () => {
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

test("✅ o menu (Sidebar, barras e UserMenu) usa os tokens --sidebar*, não os do conteúdo", () => {
  // Regressão: o mecanismo de D-Tema-4 continua (D-Cad-3 muda só os valores).
  for (const file of CHROME) {
    const src = read(file);
    assert.match(src, /sidebar-/, `${file} sem token sidebar-*`);
    assert.doesNotMatch(
      src,
      /\b(?:bg-background|text-muted-foreground|hover:bg-secondary|text-primary(?![\w-]))/,
      `${file} ainda usa classe do conteúdo`,
    );
  }
  assert.match(read(CHROME[0]), /bg-sidebar\b/);
  assert.match(read(CHROME[1]), /bg-sidebar\b/);
  assert.match(read(CHROME[2]), /bg-sidebar\b/);
});

test("Sidebar: item ativo em cartão branco com contorno da borda do menu", () => {
  const src = read(CHROME[0]);
  assert.match(
    src,
    /data-\[status=active\]:bg-sidebar-primary[^"]*data-\[status=active\]:text-sidebar-primary-foreground/,
  );
  assert.match(
    src,
    /data-\[status=active\]:shadow-\[inset_0_0_0_1px_var\(--sidebar-border\)\]/,
  );
});

test("BottomNav: rótulo ativo em tinta semibold e ícone numa pílula --sidebar-accent", () => {
  const src = read(CHROME[1]);
  assert.match(src, /aria-\[current=page\]:text-sidebar-foreground/);
  assert.match(src, /aria-\[current=page\]:font-semibold/);
  assert.match(src, /group-aria-\[current=page\]:bg-sidebar-accent/);
  // Com o menu claro, o --sidebar-primary é branco: como texto, sumiria.
  assert.doesNotMatch(src, /text-sidebar-primary(?!-foreground)/);
});

test("✅ cor de entrada e saída vem de token, não de oklch escrito à mão", () => {
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

test("✅ Fluxo Mensal e tooltip: entrada em bg-income, saída em bg-expense", () => {
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

test("✅ o alerta de orçamento usa a cor de saída, não o vermelho de erro", () => {
  assert.match(
    read("../routes/categorias.tsx"),
    /ALERT_COLOR = "var\(--expense/,
  );
});

test("✅ títulos e valores usam a fonte display", () => {
  assert.match(read("../components/dashboard/PageHeader.tsx"), /font-display/);
  assert.match(read("../components/dashboard/MetricCard.tsx"), /font-display/);
});
