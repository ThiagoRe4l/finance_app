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
  // ⚠️ Esta asserção já foi larga demais **duas vezes**, e as duas correções
  // ensinam a mesma coisa: ela precisa mirar o mecanismo exato, não vizinhança.
  //
  //   1ª versão: proibia a string "NITRO_PRESET" e falhava contra o próprio
  //      comentário que explica por que não usá-la.
  //   2ª versão: proibia `process.env` em qualquer lugar do arquivo, e falhou
  //      quando o guard do proxy (D-Auth-7) passou a ler `process.env`
  //      legitimamente, para outra finalidade.
  //
  // Agora proíbe só o que importa: o preset vindo do ambiente.
  assert.doesNotMatch(viteConfig, /preset:\s*process\.env/);
  assert.doesNotMatch(viteConfig, /process\.env\.NITRO_PRESET/);
  assert.doesNotMatch(viteConfig, /process\.env\[\s*["'`]NITRO_PRESET/);
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

// ---------------------------------------------------------------------------
// Diretórios de saída do Nitro — o que quebrou o primeiro deploy do frontend
// ---------------------------------------------------------------------------
//
// 🔴 Preset certo com output errado é o estado que derrubou o deploy. O
// `@lovable.dev/vite-tanstack-config` **hardcoda** os diretórios e sobrescreve
// os que o preset `vercel` do Nitro declara:
//
//     const output = {
//       dir: "dist", serverDir: "dist/server", publicDir: "dist/client",
//       ...userNitroOpts.output        // <- a única saída
//     };
//
// Resultado: `dist/` com `client/`+`server/` e um `config.json` de Build Output
// API v3 solto dentro. Não é BOA v3 válida — falta `static/` e `functions/` —,
// então a Vercel não acha output nenhum e devolve o 404 genérico dela.
//
// ⚠️ Nenhuma configuração na interface da Vercel corrige isso: o *layout* está
// errado, não o caminho. Apontar "Output Directory" para `dist` não ajudaria.
//
// Estes três asserts existem porque o teste do preset sozinho ficava verde no
// estado quebrado.

test("o diretório de saída do Nitro é .vercel/output", () => {
  assert.match(viteConfig, /dir:\s*["'`]\.vercel\/output["'`]/);
});

test("a função serverless vai para functions/__server.func", () => {
  // É o nome que a BOA v3 espera e que o próprio preset do Nitro usa nos
  // comandos de preview — mudar o nome quebra sem mensagem.
  assert.match(
    viteConfig,
    /serverDir:\s*["'`][^"'`]*functions\/__server\.func["'`]/,
  );
});

test("os assets do cliente vão para static/", () => {
  // `dist/client` era o valor hardcoded do preset da Lovable. A BOA v3 serve
  // estáticos de `static/`; com o nome errado, toda rota cai na função e os
  // assets voltam 404.
  assert.match(viteConfig, /publicDir:\s*["'`][^"'`]*\/static["'`]/);
});
