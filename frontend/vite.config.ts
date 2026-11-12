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

// SPA estático (D-Vercel-7, 12/11/2026 — `docs/deploy-vercel-neon.md`).
//
// Nenhuma rota tem `loader` nem `createServerFn`: o SSR renderizava um esqueleto
// vazio e o browser buscava tudo. Agora `npm run build` emite arquivos estáticos
// em `dist/client/` — os assets e um `_shell.html` gerado pelo *prerender* da
// rota `/` — que a Vercel serve direto (`vercel.json`: `outputDirectory` e a
// reescrita de toda rota para o shell).
//
// `nitro: false` tira a função de servidor do build. Até 11/11 aqui ficavam o
// preset `vercel` e os diretórios de `.vercel/output` (o 404 silencioso do
// primeiro deploy, que um comentário de 40 linhas explicava); com o SPA nada
// disso existe mais.
export default defineConfig({
  nitro: false,
  tanstackStart: { spa: { enabled: true } },

  // Proxy `/api` para o backend local (D-Auth-7).
  //
  // Faz o desenvolvimento ser **mesma origem**, igual ao rewrite do
  // `vercel.json` em produção. É o que permite o cookie de sessão viajar sem
  // `credentials: "include"` no `apiFetch` e sem reabrir a D-Deploy-6
  // (CORS com credenciais).
  vite: {
    // O *prerender* do shell sobe o servidor de preview do Vite. Sem host, ele
    // escuta em `::` e falha em ambiente sem IPv6 (o container do agente).
    preview: { host: "127.0.0.1" },
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
