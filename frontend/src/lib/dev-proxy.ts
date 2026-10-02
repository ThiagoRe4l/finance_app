/**
 * Guarda do proxy `/api` do dev server — D-Auth-7.
 *
 * Em produção o rewrite do `vercel.json` faz o browser ver uma origem só, e o
 * cookie de sessão viaja sozinho (o default de `credentials` no `fetch` é
 * `"same-origin"`). Em desenvolvimento o front e a API estão em portas
 * diferentes, então o proxy do dev server é o que reproduz a mesma origem —
 * sem ele o cookie não é enviado e o login não funciona local.
 *
 * ⚠️ O preset da Lovable REMOVE `server.proxy` quando detecta o próprio
 * sandbox (`cleanServerConfig` descarta `proxy`, `headers` e `cors`). O modo de
 * falha é dos piores: o proxy desaparece em silêncio, o cookie para de ser
 * enviado, e o sintoma é "o login não funciona" sem pista da causa.
 *
 * Por isso isto não é comentário — é um check que falha no boot.
 */

/** Variáveis que o preset usa para decidir que está no próprio sandbox. */
const SANDBOX_FLAG = "LOVABLE_SANDBOX";
const SANDBOX_PATH = "DEV_SERVER__PROJECT_PATH";

type Env = Record<string, string | undefined>;

/**
 * `true` quando o preset vai descartar `server.proxy`.
 *
 * O critério replica o do preset: `LOVABLE_SANDBOX === "1"` (comparação
 * exata, não "valor presente") **ou** `DEV_SERVER__PROJECT_PATH` definida com
 * qualquer valor. Replicar com precisão importa nas duas direções — frouxo
 * demais falha onde o proxy funcionaria.
 */
export function proxyWouldBeStripped(env: Env): boolean {
  return env[SANDBOX_FLAG] === "1" || !!env[SANDBOX_PATH];
}

/**
 * Falha alto se o proxy não for sobreviver.
 *
 * A mensagem nomeia a variável culpada, diz que o proxy é removido e explica a
 * consequência — exceção genérica aqui seria quase tão ruim quanto o silêncio,
 * porque manda a pessoa depurar o proxy em vez do preset.
 */
export function assertProxySurvives(env: Env): void {
  if (!proxyWouldBeStripped(env)) return;

  const culprit = env[SANDBOX_FLAG] === "1" ? SANDBOX_FLAG : SANDBOX_PATH;

  throw new Error(
    [
      `[auth] O proxy /api NAO vai funcionar: ${culprit} esta definida.`,
      "",
      "O preset @lovable.dev/vite-tanstack-config remove server.proxy quando",
      "detecta o sandbox da Lovable (cleanServerConfig descarta proxy, headers",
      "e cors). Sem o proxy, o front e a API ficam em origens diferentes, o",
      "cookie de sessao nao e enviado, e o login falha sem erro que aponte a",
      "causa.",
      "",
      `Saida: rodar o dev server fora do sandbox (limpar ${culprit}), ou`,
      "apontar VITE_API_BASE_URL para um backend na mesma origem.",
    ].join("\n"),
  );
}
