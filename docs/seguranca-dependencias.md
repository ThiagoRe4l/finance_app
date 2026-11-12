## 🔒 Correções de segurança em dependências

### CVE-2026-102989 / GHSA-qx66-fv34-fjm8 — XSS refletido no TanStack Start (02/10/2026)

**XSS refletido crítico (CVSS 9.3)** nas respostas de *server function* do TanStack Start.
A Vercel **bloqueou a instalação** no deploy do frontend, o que foi o primeiro sinal.

| Pacote | Faixa vulnerável | Tínhamos | Passou a |
|---|---|---|---|
| `@tanstack/react-start` | `< 1.168.60` | 1.168.34 | **1.168.60** |
| `@tanstack/start-server-core` | `< 1.169.39` | 1.169.17 | **1.169.39** |

🔴 **O bypass `DANGEROUSLY_DEPLOY_VULNERABLE_TANSTACK_START_XSS` não foi usado, e não deve
ser.** Ele publicaria um XSS conhecido **dias depois** de a fatia de autenticação entrar — e
XSS é precisamente o vetor contra o qual o cookie `httpOnly` da D-Auth-3 existe. Um XSS
refletido na mesma origem contorna boa parte da proteção de sessão: com `SameSite=Lax` e
mesma origem (D-Vercel-3), script injetado fala com `/api` **já autenticado**. As duas
decisões se anulariam.

**A correção é estrutural, não só do lockfile.** `@tanstack/react-start@1.168.60` declara
dependência **exata** em `@tanstack/start-server-core: 1.169.39`, então qualquer instalação
limpa da versão nova necessariamente traz a transitiva corrigida — não depende de o lockfile
estar íntegro.

**A família TanStack subiu junto, sem editar `package.json`.** Só o range de `react-start`
mudou (`^1.167.14` → `^1.168.60`); `react-router` (1.170.18 → **1.170.41**) e `router-plugin`
(1.168.23 → **1.168.42**) subiram porque seus `^` já permitiam. 42 pacotes mudaram de versão,
todos da família ou transitivos dela. **`nitro` ficou inalterado** — então o preset `vercel`
e o layout de saída do build não foram afetados.

⚠️ **Uma incompatibilidade real veio na subida, e quem a pegou foi o `tsc`.**
`@tanstack/react-router` 1.170.41 mudou `ErrorComponentProps.error` de `Error` para
`unknown` (via `ErrorBoundaryTypes`). O `DefaultErrorComponent` de `src/router.tsx` declarava
as props num literal próprio com `error: Error` e lia `error.message` direto — deixou de
compilar.

A correção passa a usar o tipo **da biblioteca** (`ErrorComponentProps`) em vez de redeclarar,
e estreita com `error instanceof Error` antes de ler `.message`. Redeclarar é o que fez o
componente divergir em silêncio; importar faz ele acompanhar a próxima mudança.

> Isto é um argumento concreto a favor do `tsc --noEmit` ser passo bloqueante do CI:
> **componente React não tem teste neste projeto**, os 187 testes passaram sem notar nada, e
> o único sinal foi o type-check.

**Como a atualização foi feita, e por quê assim.** `npm install --package-lock-only`, que
atualiza `package.json` e lockfile **sem tocar `node_modules`**. A debt registrada em
"Testes do frontend" vale aqui: o `node_modules` foi instalado pelo Windows, e reinstalar do
Linux trocaria os binários de esbuild/rollup e quebraria o `npm run dev` do host.

A verificação foi feita numa **cópia isolada** em `/tmp`, com `npm ci` de verdade: `tsc`
limpo, 187 testes, 0 erro de lint, e `npm run build` concluído com `preset: vercel` no
`nitro.json`.

⬜ **Consequência: o `node_modules` local está ATRÁS do lockfile.** Rode `npm install` **do
Windows** para alinhar. CI e Vercel fazem instalação limpa a partir do lockfile, então o
deploy não depende disso.

### Observações registradas de passagem

* ⬜ **`@cloudflare/vite-plugin` ainda é dependência de produção** e arrasta
  `wrangler`/`miniflare`/`sharp`/`undici`, responsáveis por boa parte dos 12 avisos `high` do
  `npm audit`. Com o preset `vercel` (D-Vercel-3), **nada disso é usado**. Removê-lo é
  limpeza de superfície de segurança — fatia própria, não decidida.
* ✅ **O build emitia `dist/`, não `.vercel/output`** — e isso de fato derrubou o primeiro
  deploy do frontend. **Resolvido em 02/10/2026**; ver "Common Hurdles → 6".
  🔴 A hipótese registrada aqui estava **errada**: eu disse que o ajuste seria o *Output
  Directory* do projeto na Vercel. Não era, e não poderia ser — o *layout* estava errado, não
  o caminho. A correção é em `vite.config.ts`.

---

