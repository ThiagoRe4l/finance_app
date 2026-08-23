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

// ⚠️ `nitro.preset` é OBRIGATÓRIO e vai fixado aqui, não em `NITRO_PRESET`.
//
// O default do preset é `cloudflare-module`: sem esta linha, `npm run build`
// produz um Cloudflare Worker em vez de um servidor Node, e o deploy no
// Railway falha de forma silenciosa — build "verde", serviço que não sobe.
// Via variável de ambiente, uma variável faltando reintroduz o mesmo silêncio.
//
// Saída: `.output/server/index.mjs`, executável com `node`.
// Ver "🚢 Deploy → D-Deploy-1" no CLAUDE.md.
export default defineConfig({
  nitro: { preset: "node-server" },
});
