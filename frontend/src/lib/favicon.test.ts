/**
 * Ícone da página (`docs/periodos.md`, fatia 4).
 *
 * Escrito **antes** da implementação (13/11/2026). Hoje não há `public/` nem
 * `<link rel="icon">`: o navegador pede `/favicon.ico`, cai no rewrite para o
 * shell e mostra o ícone genérico. Teste sobre arquivo, como `root-shell.test.ts`.
 *
 * ⚠️ A aprovação deste teste não foi pedida em separado: "Sim, fatia 4" foi
 * tomado como o aval, dado o tamanho da fatia.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const root = readFileSync(path("../routes/__root.tsx"), "utf8");

test("o __root declara o ícone SVG e o apple-touch-icon", () => {
  assert.match(
    root,
    /rel:\s*"icon",\s*type:\s*"image\/svg\+xml",\s*href:\s*"\/favicon\.svg"/,
  );
  assert.match(
    root,
    /rel:\s*"apple-touch-icon",\s*href:\s*"\/apple-touch-icon\.png"/,
  );
});

test("favicon.svg existe, é um SVG quadrado e não depende de rede", () => {
  const file = path("../../public/favicon.svg");
  assert.ok(existsSync(file), "public/favicon.svg não existe");
  const svg = readFileSync(file, "utf8");
  assert.match(svg, /<svg[^>]*viewBox="0 0 (\d+) \1"/); // quadrado
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/); // sem fonte nem imagem externa
});

test("apple-touch-icon.png existe e é um PNG de 180×180", () => {
  const file = path("../../public/apple-touch-icon.png");
  assert.ok(existsSync(file), "public/apple-touch-icon.png não existe");
  const png = readFileSync(file);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 180); // largura, no IHDR
  assert.equal(png.readUInt32BE(20), 180); // altura
});
