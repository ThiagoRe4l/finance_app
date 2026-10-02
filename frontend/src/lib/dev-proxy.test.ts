/**
 * Guarda do proxy `/api` do dev server — D-Auth-7.
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md.
 *
 * O problema que isto existe para evitar
 * --------------------------------------
 * Em produção o rewrite `/api` faz tudo ser mesma origem e o cookie de sessão
 * viaja sozinho. Em desenvolvimento o front e a API estão em portas
 * diferentes, então o cookie **não** é enviado — e a saída decidida foi um
 * proxy `/api` no dev server, mantendo a D-Vercel-3 intacta.
 *
 * ⚠️ O preset da Lovable REMOVE `server.proxy` (`cleanServerConfig` descarta
 * `proxy`, `headers` e `cors`), mas **só** quando detecta o próprio sandbox:
 * `LOVABLE_SANDBOX=1` ou `DEV_SERVER__PROJECT_PATH` definido.
 *
 * Deixar isso em comentário não impede nada, e o modo de falha é dos piores: o
 * proxy desaparece em silêncio, o cookie para de ser enviado, e o sintoma é
 * "o login não funciona" sem nenhuma pista da causa. Daí um check que falha
 * alto no boot — e a detecção, sendo função pura, tem teste.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { proxyWouldBeStripped, assertProxySurvives } from "./dev-proxy.ts";

test("ambiente normal: o proxy sobrevive", () => {
  assert.equal(proxyWouldBeStripped({}), false);
});

test("LOVABLE_SANDBOX=1 descarta o proxy", () => {
  assert.equal(proxyWouldBeStripped({ LOVABLE_SANDBOX: "1" }), true);
});

test("DEV_SERVER__PROJECT_PATH descarta o proxy", () => {
  // O preset considera sandbox pela mera presença da variável, qualquer valor.
  assert.equal(
    proxyWouldBeStripped({ DEV_SERVER__PROJECT_PATH: "/qualquer/caminho" }),
    true,
  );
});

test("LOVABLE_SANDBOX com outro valor não conta", () => {
  // O preset compara com "1" exatamente — replicar o critério importa, senão
  // o check falha onde o proxy funcionaria.
  assert.equal(proxyWouldBeStripped({ LOVABLE_SANDBOX: "0" }), false);
});

test("assertProxySurvives não faz nada em ambiente normal", () => {
  assert.doesNotThrow(() => assertProxySurvives({}));
});

test("assertProxySurvives falha alto no sandbox", () => {
  assert.throws(() => assertProxySurvives({ LOVABLE_SANDBOX: "1" }));
});

test("a mensagem de erro diz a causa e o que fazer", () => {
  // Uma exceção genérica aqui seria quase tão ruim quanto o silêncio: quem
  // esbarrar nela precisa saber que é o preset removendo o proxy, não um bug
  // do próprio proxy.
  try {
    assertProxySurvives({ LOVABLE_SANDBOX: "1" });
    assert.fail("deveria ter lançado");
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /LOVABLE_SANDBOX|DEV_SERVER__PROJECT_PATH/);
    assert.match(message, /proxy/i);
    assert.match(message, /cookie|sess/i);
  }
});
