/**
 * Configuração vinda do ambiente.
 *
 * ⚠️ **`VITE_*` é resolvida em BUILD, não em runtime.** O preset da Lovable faz
 * `loadEnv(mode, cwd, "VITE_")` e injeta via `define:` — o valor fica inlinado
 * no bundle. Trocar `VITE_API_BASE_URL` no painel e reiniciar o serviço **não**
 * tem efeito: é preciso rebuildar o frontend. Ver "🚢 Deploy" no CLAUDE.md.
 *
 * A regra vive aqui, e não dentro de `api.ts`, porque `import.meta.env` não
 * existe no runner nativo do Node — só o Vite o injeta. Recebendo o ambiente
 * por parâmetro, a regra fica testável e `api.ts` vira uma linha de fiação.
 */

/** Valor que estava hardcoded em `api.ts` até a fatia de deploy. */
export const DEFAULT_API_BASE_URL = "http://localhost:8000/api";

type Env = Record<string, string | undefined>;

export function resolveApiBaseUrl(env: Env): string {
  const raw = env.VITE_API_BASE_URL?.trim();

  // Variável em branco e variável ausente caem no mesmo default: campo
  // definido vazio no painel do Railway é indistinguível de campo esquecido.
  if (!raw) return DEFAULT_API_BASE_URL;

  // `apiFetch` monta `${base}${endpoint}` e todo endpoint começa com "/".
  // Sem isto, uma base terminada em barra geraria `//accounts/`.
  return raw.replace(/\/+$/, "");
}
