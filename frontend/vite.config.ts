// @lovable.dev/vite-tanstack-config (v1.8) já inclui o seguinte — NÃO adicione
// manualmente, ou o app quebra com plugins duplicados:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only),
//     componentTagger (dev-only), injeção de VITE_*, alias @, dedupe de
//     React/TanStack, plugins de log de erro e detecção de sandbox.
// Config adicional vai por defineConfig({ vite: { ... } }).
//
// ⚠️ O comentário original aqui falava em `cloudflare (build-only)` e na opção
// `cloudflare`, que a v1.8 do preset migrou para `nitro`. Estava descrevendo
// uma API que não existe mais e desorientava exatamente quem viesse configurar
// o deploy — corrigido em 23/08/2026.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

import { assertProxySurvives } from "./src/lib/dev-proxy.ts";

// Falha no boot se o preset for descartar o proxy (D-Auth-7). Invocado, não só
// importado: check importado e não chamado é decoração.
assertProxySurvives(process.env);

// ⚠️ `nitro.preset` é OBRIGATÓRIO e vai fixado aqui, não em `NITRO_PRESET`.
//
// O default do preset é `cloudflare-module`: sem esta linha, `npm run build`
// produz um Cloudflare Worker, e o deploy falha de forma silenciosa — build
// "verde", serviço que não sobe. Via variável de ambiente, uma variável
// faltando no build reintroduz o mesmo silêncio.
//
// `vercel` emite `.vercel/output` (Build Output API v3), que é o que a Vercel
// consome. Era `node-server` enquanto o alvo era o Railway; mudou com o pivô
// de 28/08/2026 — ver "🚢 Deploy — Vercel + Neon" no CLAUDE.md.
export default defineConfig({
  nitro: {
    preset: "vercel",

    // 🔴 `output` é OBRIGATÓRIO aqui, e por um motivo que não é óbvio.
    //
    // O `@lovable.dev/vite-tanstack-config` hardcoda os diretórios de saída e
    // **sobrescreve os que o preset `vercel` do Nitro declara**:
    //
    //     const output = {
    //       dir: "dist", serverDir: "dist/server", publicDir: "dist/client",
    //       ...userNitroOpts.output        // <- a única saída
    //     };
    //
    // Sem estas três linhas, o build emite `dist/` com `client/`+`server/` e um
    // `config.json` de Build Output API v3 solto dentro — que **não é BOA v3
    // válida**, porque faltam `static/` e `functions/`. A Vercel não acha output
    // nenhum e devolve o 404 genérico dela, sem erro de build.
    //
    // ⚠️ Nenhuma configuração na interface da Vercel corrige isso: o *layout*
    // está errado, não o caminho.
    output: {
      dir: ".vercel/output",
      serverDir: ".vercel/output/functions/__server.func",
      publicDir: ".vercel/output/static",
    },
  },

  // Proxy `/api` para o backend local (D-Auth-7).
  //
  // Faz o desenvolvimento ser **mesma origem**, igual ao rewrite do
  // `vercel.json` em produção. É o que permite o cookie de sessão viajar sem
  // `credentials: "include"` no `apiFetch` e sem reabrir a D-Deploy-6
  // (CORS com credenciais).
  vite: {
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: false,
        },
      },
    },
  },
});
