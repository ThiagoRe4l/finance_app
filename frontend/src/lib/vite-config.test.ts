/**
 * Contrato do `vite.config.ts` — o preset do Nitro tem que estar fixado.
 *
 * Teste sobre **arquivo**, não sobre comportamento, no mesmo espírito de
 * `test_every_requirement_is_pinned` no backend. Existe porque o modo de falha
 * que ele pega é o pior desta fatia e o mais silencioso:
 *
 *   `@lovable.dev/vite-tanstack-config` v1.8 resolve o preset como
 *   `userNitroOpts.preset ?? process.env.NITRO_PRESET ?? "cloudflare-module"`.
 *
 * Ou seja, remover a linha do `vite.config.ts` não quebra nada visível — o
 * build continua "verde" e passa a produzir um Cloudflare Worker em vez da
 * saída `.vercel/output` que a Vercel consome. O deploy no Railway falha só depois, sem mensagem que aponte
 * para a causa.
 *
 * ⚠️ Este teste NÃO substitui um build de verdade. Ele confirma a declaração,
 * não o artefato: `vite build` não roda neste container (node_modules tem só
 * binários win32 de esbuild/rollup — a debt de bind mount do CLAUDE.md). A
 * validação do artefato é o próprio primeiro deploy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const viteConfig = readFileSync(
  fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
  "utf8",
);

test("o preset do Nitro está fixado como vercel", () => {
  // Era `node-server` no alvo Railway. Este teste falhou na troca de
  // plataforma, que é exatamente o trabalho dele: o preset não muda em
  // silêncio, e o fallback para `cloudflare-module` não passa despercebido.
  assert.match(viteConfig, /preset:\s*["']vercel["']/);
});

test("o preset não é lido do ambiente", () => {
  // Via variável, uma variável faltando no build reintroduz o fallback
  // silencioso para Cloudflare — que é justamente o que se quer impedir.
  //
  // A asserção mira `process.env` e não a string "NITRO_PRESET": a primeira
  // versão deste teste proibia a palavra e falhava contra o comentário do
  // próprio `vite.config.ts` que explica por que não usá-la. Proibir o
  // mecanismo permite documentar a decisão.
  assert.doesNotMatch(viteConfig, /process\.env/);
});
