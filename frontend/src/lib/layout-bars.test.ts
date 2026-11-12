/**
 * Contrato das barras e da Sidebar — fatia 1c da reforma mobile-first
 * (`docs/mobile-first.md` → M-1, M-6, M-10).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
 * Teste sobre arquivo, como `app-shell.test.ts`: componente React não tem
 * teste neste container, então o que se trava são as classes e as ligações.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const SIDEBAR = "../components/dashboard/Sidebar.tsx";
const TOPBAR = "../components/layout/TopBar.tsx";
const BOTTOMNAV = "../components/layout/BottomNav.tsx";
const USERMENU = "../components/auth/UserMenu.tsx";
const STYLES = "../styles.css";

/** Os tokens do `className` literal da primeira tag `<tag …>` do arquivo. */
function classesOf(source: string, tag: string): string[] {
  const m = new RegExp(`<${tag}\\b[^>]*?className="([^"]*)"`).exec(source);
  assert.ok(m, `<${tag} className="…"> não encontrado`);
  return m[1].split(/\s+/).filter(Boolean);
}

const NAV_IMPORT =
  /import \{[^}]*\bNAV_ITEMS\b[^}]*\} from "@\/lib\/navigation(\.ts)?";/;

// ── Sidebar de md para lg ────────────────────────────────────────────────

test("Sidebar: hidden lg:flex no lugar de hidden md:flex, resto do <aside> igual", () => {
  const before =
    "hidden md:flex w-64 shrink-0 border-r border-border bg-background flex-col gap-12 p-8 sticky top-0 h-dvh";
  const expected = before.replace("md:flex", "lg:flex").split(" ").sort();
  assert.deepEqual(classesOf(read(SIDEBAR), "aside").sort(), expected);
});

test("Sidebar: os itens vêm da fonte única, sem lista local", () => {
  const src = read(SIDEBAR);
  assert.match(src, NAV_IMPORT);
  assert.doesNotMatch(src, /const items\s*=/);
});

test("✅ Sidebar: Link, activeOptions exact e <UserMenu /> sem prop, como hoje", () => {
  // Regressão: já passa. Trava o que faz ≥ 1024 px ficar idêntico (M-10).
  const src = read(SIDEBAR);
  assert.ok(
    src.includes(
      'className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/60 data-[status=active]:bg-secondary data-[status=active]:text-primary data-[status=active]:font-medium"',
    ),
    "classes do Link da Sidebar mudaram",
  );
  assert.match(src, /activeOptions=\{\{ exact: true \}\}/);
  assert.match(src, /<UserMenu \/>/);
});

// ── Barra inferior ───────────────────────────────────────────────────────

test("BottomNav: <nav> fixa embaixo, só abaixo de lg, acima do conteúdo", () => {
  const src = read(BOTTOMNAV);
  assert.match(src, /<nav\b[^>]*aria-label="Navegação principal"/);
  const cls = classesOf(src, "nav");
  for (const t of ["fixed", "bottom-0", "inset-x-0", "z-40", "lg:hidden"]) {
    assert.ok(cls.includes(t), `<nav> sem ${t}: ${cls.join(" ")}`);
  }
});

test("BottomNav: área segura de baixo e altura pela variável", () => {
  const src = read(BOTTOMNAV);
  assert.match(src, /env\(safe-area-inset-bottom\)/);
  assert.match(src, /--app-bottombar-height/);
});

test("BottomNav: itens da fonte única, ativo por activeNavKey com aria-current", () => {
  const src = read(BOTTOMNAV);
  assert.match(src, NAV_IMPORT);
  assert.match(src, /\bactiveNavKey\(/);
  assert.match(src, /\bshortLabel\b/);
  assert.match(src, /aria-current=/);
});

test("BottomNav: cada item é alvo de 44 px (min-h-11) e divide a largura (flex-1)", () => {
  const cls = classesOf(read(BOTTOMNAV), "Link");
  assert.ok(cls.includes("min-h-11"), cls.join(" "));
  assert.ok(cls.includes("flex-1"), cls.join(" "));
});

// ── Barra superior ───────────────────────────────────────────────────────

test("TopBar: <header> fixo em cima, só abaixo de lg, acima do conteúdo", () => {
  const cls = classesOf(read(TOPBAR), "header");
  for (const t of ["fixed", "top-0", "inset-x-0", "z-40", "lg:hidden"]) {
    assert.ok(cls.includes(t), `<header> sem ${t}: ${cls.join(" ")}`);
  }
});

test("TopBar: área segura de cima, altura pela variável, UserMenu em linha", () => {
  const src = read(TOPBAR);
  assert.match(src, /env\(safe-area-inset-top\)/);
  assert.match(src, /--app-topbar-height/);
  assert.match(src, /<UserMenu variant="topbar" \/>/);
});

test("UserMenu: a disposição da barra tem Sair com 44 px; o padrão é o de hoje", () => {
  const src = read(USERMENU);
  assert.match(src, /variant/);
  assert.match(src, /min-h-11/);
  // A disposição de hoje (Sidebar) continua no arquivo.
  assert.ok(src.includes("mt-auto flex flex-col gap-2"));
});

// ── Empilhamento (M-10, item b) ──────────────────────────────────────────

test("z-index: as barras ficam abaixo do z-50 dos diálogos do shadcn", () => {
  const dialog = read("../components/ui/dialog.tsx");
  assert.match(
    dialog,
    /fixed inset-0 z-50/,
    "premissa: overlay do Dialog é z-50",
  );
  for (const file of [TOPBAR, BOTTOMNAV]) {
    const z = read(file).match(/\bz-(\d+)\b/g) ?? [];
    assert.ok(z.length > 0, `${file}: sem z-index`);
    for (const t of z) assert.ok(Number(t.slice(2)) < 50, `${file}: ${t}`);
  }
});

// ── Medidas em variável CSS ──────────────────────────────────────────────

test("styles.css: alturas das barras em :root", () => {
  const css = read(STYLES);
  assert.match(css, /--app-topbar-height:\s*3rem;/);
  assert.match(css, /--app-bottombar-height:\s*3\.5rem;/);
});

test("styles.css: a partir de lg (64rem) as duas alturas valem 0px", () => {
  const css = read(STYLES);
  const lg =
    /@media\s*\((?:width\s*>=\s*|min-width:\s*)64rem\)\s*\{([\s\S]*?)\n\}/.exec(
      css,
    );
  assert.ok(lg, "sem @media (width >= 64rem)");
  assert.match(lg[1], /--app-topbar-height:\s*0px;/);
  assert.match(lg[1], /--app-bottombar-height:\s*0px;/);
});
