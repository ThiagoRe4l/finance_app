/**
 * `config.ts` — resolução da URL base da API a partir do ambiente.
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
 * Cobre a variável `VITE_API_BASE_URL` da fatia de deploy (D-Deploy-1).
 *
 * Por que função pura em vez de ler `import.meta.env` dentro de `api.ts`
 * ---------------------------------------------------------------------
 * `import.meta.env` não existe no runner nativo do Node — só o Vite o injeta.
 * Lendo direto em `api.ts`, a regra ficaria sem teste possível hoje, que é
 * exatamente o buraco de cobertura registrado no CLAUDE.md sobre ligação de
 * props em JSX. Recebendo o ambiente por parâmetro, `api.ts` passa a ser uma
 * linha de fiação e a regra fica testável.
 *
 * ⚠️ Lembrete que vale repetir aqui: `VITE_*` é resolvida em **build**, não em
 * runtime — o preset da Lovable injeta via `define:` e o valor fica inlinado
 * no bundle. Trocar a variável e reiniciar o serviço não tem efeito.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveApiBaseUrl } from "./config.ts";

test("sem a variável, mantém exatamente o comportamento de hoje", () => {
  assert.equal(resolveApiBaseUrl({}), "http://localhost:8000/api");
});

test("usa a variável quando ela existe", () => {
  assert.equal(
    resolveApiBaseUrl({
      VITE_API_BASE_URL: "https://backend.up.railway.app/api",
    }),
    "https://backend.up.railway.app/api",
  );
});

test("variável em branco cai no default", () => {
  // Campo definido vazio no painel do Railway é indistinguível de esquecido.
  assert.equal(
    resolveApiBaseUrl({ VITE_API_BASE_URL: "   " }),
    "http://localhost:8000/api",
  );
});

test("remove barra final para não gerar '//' nos endpoints", () => {
  // `apiFetch` monta `${base}${endpoint}` e todo endpoint começa com "/".
  // Com base terminada em barra, `/accounts/` viraria `//accounts/`.
  assert.equal(
    resolveApiBaseUrl({
      VITE_API_BASE_URL: "https://backend.up.railway.app/api/",
    }),
    "https://backend.up.railway.app/api",
  );
});
