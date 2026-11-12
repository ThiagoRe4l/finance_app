/**
 * Contrato do `frontend/vercel.json` — o rewrite `/api`.
 *
 * Teste sobre **arquivo**, como `vite-config.test.ts` e o
 * `test_deploy_config.py` do backend: configuração de plataforma não tem teste
 * de comportamento possível localmente, mas tem invariante verificável.
 *
 * O rewrite é o que sustenta a D-Vercel-3 inteira — mesma origem para o
 * browser, logo sem CORS e com o cookie de sessão viajando sozinho. Se ele
 * estiver errado, **nenhuma** chamada da API funciona, e o sintoma não aponta
 * para este arquivo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const config = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../vercel.json", import.meta.url)),
    "utf8",
  ),
) as {
  rewrites?: Array<{ source: string; destination: string }>;
  outputDirectory?: string;
  framework?: string | null;
  buildCommand?: string;
};

const apiRewrite = config.rewrites?.find((rewrite) =>
  rewrite.source.startsWith("/api"),
);

test("existe um rewrite para /api", () => {
  assert.ok(
    apiRewrite,
    "sem o rewrite, o front chama a própria origem e tudo 404",
  );
});

test("o destino não é mais o placeholder", () => {
  // 🔴 O modo de falha que isto pega: deployar com o placeholder no lugar.
  // O build passa, o deploy passa, e toda chamada da API morre em DNS.
  assert.doesNotMatch(
    apiRewrite!.destination,
    /SUBSTITUIR|PLACEHOLDER|example\.com/i,
  );
});

test("o destino é uma URL absoluta https", () => {
  // Caminho relativo aqui apontaria o rewrite para o próprio frontend — e é
  // justamente o que derrubou o backend (ver Common Hurdles 5).
  assert.match(apiRewrite!.destination, /^https:\/\//);
});

test("o parâmetro de caminho é preservado nas duas pontas", () => {
  // Sem `:path*` no destino, TODA rota da API colapsa num caminho só. É o erro
  // mais silencioso possível aqui: o rewrite existe, o domínio está certo, e
  // `/api/accounts/` e `/api/dashboard/summary` chegam no mesmo lugar.
  assert.match(apiRewrite!.source, /:path\*/);
  assert.match(apiRewrite!.destination, /:path\*/);
});

// ---------------------------------------------------------------------------
// SPA estático — D-Vercel-7 (12/11/2026), escritos antes da mudança
// ---------------------------------------------------------------------------

test("a Vercel serve a pasta estática do build", () => {
  assert.equal(config.outputDirectory, "dist/client");
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, "npm run build");
});

test("toda rota que não é arquivo nem /api cai no shell do SPA, por último", () => {
  const rewrites = config.rewrites ?? [];
  const last = rewrites[rewrites.length - 1];
  assert.equal(last.destination, "/_shell.html");
  // O /api vem antes: senão a API também cairia no shell.
  assert.ok(rewrites.indexOf(apiRewrite!) < rewrites.length - 1);
});

// ---------------------------------------------------------------------------
// Revisão de 12/11/2026 (escritos antes da correção)
// ---------------------------------------------------------------------------

test("o shell não responde por /api nem por /assets (arquivo faltando é 404, não HTML)", () => {
  const rewrites = config.rewrites ?? [];
  const shell = rewrites.find((r) => r.destination === "/_shell.html")!;
  const pattern = new RegExp(`^${shell.source}$`);
  assert.ok(pattern.test("/parcelamentos"));
  assert.ok(pattern.test("/"));
  assert.ok(
    !pattern.test("/assets/index-abc123.js"),
    "asset velho viraria HTML com 200",
  );
  assert.ok(!pattern.test("/api/accounts"));
});

test("assets com hash têm cache longo e imutável", () => {
  const headers =
    (
      config as {
        headers?: Array<{
          source: string;
          headers: Array<{ key: string; value: string }>;
        }>;
      }
    ).headers ?? [];
  const assets = headers.find((h) => h.source === "/assets/(.*)");
  assert.ok(assets, "sem regra de headers para /assets");
  assert.deepEqual(assets!.headers, [
    { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
  ]);
});
