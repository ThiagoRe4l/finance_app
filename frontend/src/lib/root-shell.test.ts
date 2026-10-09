/**
 * Contrato do shell HTML — fatia 1a da reforma mobile-first
 * (`docs/mobile-first.md` → Fatias, M-1, M-2, M-8).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
 *
 * Teste sobre **arquivo**, no espírito de `vite-config.test.ts`: o que se
 * trava é a ligação no `__root.tsx`, que é exatamente onde o bug de `tone` do
 * `MetricCard` nasceu e onde nenhum teste de função pura alcança.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { findViolations } from "./mobile-contract.ts";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const root = read("../routes/__root.tsx");
const router = read("../router.tsx");

test("viewport-fit=cover na meta viewport, sem perder width e initial-scale", () => {
  // Pré-requisito da barra inferior (M-1): sem ele, `env(safe-area-inset-*)`
  // vale zero e a barra fica embaixo do recorte da tela.
  const meta = /name:\s*"viewport",\s*content:\s*"([^"]*)"/.exec(root);
  assert.ok(meta, "meta viewport não encontrada no __root.tsx");
  const parts = meta[1].split(",").map((p) => p.trim());
  assert.ok(parts.includes("viewport-fit=cover"), `content: "${meta[1]}"`);
  assert.ok(parts.includes("width=device-width"), `content: "${meta[1]}"`);
  assert.ok(parts.includes("initial-scale=1"), `content: "${meta[1]}"`);
});

test("interactive-widget=resizes-content na meta viewport", () => {
  // O print do Android real (07/10/2026) mostra o teclado cobrindo o rodapé do
  // formulário. Desde o Chrome 108 o Android redimensiona só o *visual
  // viewport* por padrão (`resizes-visual`): `dvh` não encolhe e o `max-h` do
  // Dialog não enxerga o teclado. Com `resizes-content` o layout viewport
  // encolhe junto (MDN; developer.chrome.com/blog/viewport-resize-behavior).
  // O Safari do iOS ignora a chave.
  const meta = /name:\s*"viewport",\s*content:\s*"([^"]*)"/.exec(root);
  assert.ok(meta, "meta viewport não encontrada no __root.tsx");
  const parts = meta[1].split(",").map((p) => p.trim());
  assert.ok(
    parts.includes("interactive-widget=resizes-content"),
    `content: "${meta[1]}"`,
  );
});

test('o documento declara lang="pt-BR"', () => {
  // Hoje é "en": o leitor de tela lê o app em inglês e o Chrome Android
  // oferece tradução de uma página que já está em português.
  assert.match(root, /<html\s+lang="pt-BR"/);
});

test("o toast fica no topo, abaixo da área segura e da barra superior", () => {
  // Embaixo colidiria com a barra inferior e com o botão flutuante (M-1, M-2):
  // abaixo de 600 px o sonner estica o toast na largura toda. No topo, o
  // deslocamento no celular soma a área segura e a altura da barra superior,
  // que a fatia 1c define em `--app-topbar-height` (0 até lá).
  const toaster = /<Toaster\b[^>]*\/>/s.exec(root);
  assert.ok(toaster, "<Toaster /> não encontrado no __root.tsx");
  assert.match(toaster[0], /position="top-[a-z]+"/);
  assert.match(toaster[0], /mobileOffset=\{\{[^}]*top:/s);
  assert.match(toaster[0], /env\(safe-area-inset-top\)/);
  assert.match(toaster[0], /var\(--app-topbar-height,\s*0px\)/);
});

test("telas de erro do router e do root sem vh (fora do escopo do contrato de .tsx)", () => {
  // `src/router.tsx` não está em routes/ nem components/, então a varredura
  // de P1–P6 não o vê. A tela de erro também precisa de dvh.
  const p5 = (src: string) =>
    findViolations(src).filter((v) => v.rule === "P5");
  assert.deepEqual(p5(router), []);
  assert.deepEqual(p5(root), []);
});
