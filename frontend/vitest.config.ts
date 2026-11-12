/**
 * Vitest — testes de **componente** (arquivos `.test.tsx` em `src/`). Decisão K no
 * CLAUDE.md ("Testes do frontend").
 *
 * Config própria, sem o preset da Lovable: aqui só entram o JSX, o alias `@/`
 * e o jsdom. Os `*.test.ts` (função pura e contrato sobre arquivo) continuam
 * no runner nativo do Node (`npm test`); o `include` abaixo não os pega.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    // Fora de uma pasta `test/`: o runner nativo do Node rodaria o que
    // estivesse lá como teste.
    setupFiles: ["./src/vitest.setup.ts"],
  },
});
