/**
 * Contrato do `vite.config.ts` — modo SPA, sem Nitro (D-Vercel-7, 12/11/2026).
 *
 * Teste sobre **arquivo**, no mesmo espírito de `test_every_requirement_is_pinned`
 * no backend. Até 11/11/2026 este arquivo fixava o preset `vercel` do Nitro e
 * os diretórios de `.vercel/output` (o 404 silencioso do primeiro deploy). Com o
 * SPA estático o Nitro sai do build, e o que se fixa agora é o modo SPA, o
 * Nitro desligado e o host do preview usado pelo *prerender* do shell.
 *
 * ⚠️ Não substitui o build: este confere a declaração. O build SPA foi rodado e
 * servido no container em 12/11/2026 (D-Vercel-7); a Vercel confere no
 * primeiro deploy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const viteConfig = readFileSync(
  fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
  "utf8",
);

test("o modo SPA do TanStack Start está ligado", () => {
  assert.match(viteConfig, /spa:\s*\{\s*enabled:\s*true/);
});

test("o Nitro está desligado — nada de função de servidor no frontend", () => {
  assert.match(viteConfig, /nitro:\s*false/);
  assert.doesNotMatch(viteConfig, /preset:\s*["'`]/);
  assert.doesNotMatch(viteConfig, /process\.env\.NITRO_PRESET/);
});

test("o preview escuta em 127.0.0.1 (prerender do shell sem IPv6)", () => {
  assert.match(viteConfig, /preview:\s*\{\s*host:\s*["'`]127\.0\.0\.1["'`]/);
});

// ---------------------------------------------------------------------------
// Proxy `/api` do dev server — D-Auth-7
// ---------------------------------------------------------------------------
//
// Mesma natureza dos testes acima: contrato sobre arquivo. O proxy é o que faz
// o desenvolvimento ser mesma origem, e sem ele o cookie de sessão não é
// enviado — o login simplesmente não funciona local, sem erro que aponte para
// a causa.

test("o dev server declara o proxy /api", () => {
  assert.match(viteConfig, /proxy/);
  assert.match(viteConfig, /["'`]\/api["'`]/);
});

test("o proxy aponta para a porta do backend", () => {
  assert.match(viteConfig, /localhost:8000|127\.0\.0\.1:8000/);
});

test("o guarda do sandbox é invocado no config", () => {
  // Importar a função e não chamá-la deixaria o check decorativo — que é
  // exatamente o estado que a D-Auth-7 recusou ("não deixa só em comentário").
  assert.match(viteConfig, /assertProxySurvives\s*\(/);
});
