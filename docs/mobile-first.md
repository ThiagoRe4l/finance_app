## 📱 Mobile-first — reforma do frontend (decidido em 07/10/2026)

**Decidido em 07/10/2026, antes da implementação.** Nada implementado ainda; a ordem está em
"Fatias", no fim desta seção.

**Por quê.** O layout foi pensado para desktop. A `Sidebar` é `hidden md:flex`: abaixo de 768 px
não há navegação nem logout. A auditoria por leitura de código (07/10/2026), confirmada por
prints (Chrome Android real e DevTools), achou:

* valores vazando dos cartões do Dashboard em 360–390 px;
* a tabela de Transações (`grid-cols-12`) ilegível em **toda** largura até 768 px — ~4 px por
  coluna em 320, ~16 px em 768 com a Sidebar;
* o card de parcelamento e o Comparativo dos Relatórios estourando a largura;
* editar/excluir só no hover, invisíveis no toque, com alvos de 28 px;
* a busca de Transações com 14 px, o que dá zoom no iOS.

Já estava certo: `inputMode="decimal"` nos campos de dinheiro, e as grades começam em 1 coluna.

🔴 **Restrição: o frontend da despesa compartilhada nasce mobile-first.** O contrato está em
"👥 Multiusuário → Contrato novo com o frontend". Base desenhada para 360 px, `md:`/`lg:`
ampliando. Entregá-lo desktop e adaptar depois não é aceitável.

### M-1: barra inferior, conta na barra superior

Abaixo de `lg`: barra inferior com as 5 telas (Início, Transações, Categorias, Parcelas,
Relatórios — "Parcelamentos" não cabe em ~64 px) e uma barra superior fina com o menu da conta
(e-mail e Sair).

**Descartado: menu hambúrguer.** Esconde navegação de uso frequente atrás de dois toques.
Custo aceito: ~56 px de altura mais `safe-area-inset-bottom`.

### M-2: "Nova transação" vira botão flutuante, só onde é a ação principal

No celular, botão flutuante no Dashboard e em Transações; no desktop continua no cabeçalho.
Categorias e Parcelamentos mantêm a ação própria no cabeçalho — um flutuante de "nova
transação" ali competiria com ela. Custo: a lista precisa de folga inferior para o botão não
cobrir o último item.

### M-3: formulários — o Dialog atual, responsivo só com CSS

Sem Drawer, sem hook de largura e sem troca de componente na hidratação. No celular: ancorado
embaixo (ou altura total), `max-h` em `dvh`, rolagem interna, rodapé fixo, margem lateral e
cantos. A partir de `sm`, centrado como hoje.

As classes entram **no ponto de uso** (ou num invólucro em `components/shared/`), não em
`components/ui/`, que não se edita à mão. O `cn` usa `tailwind-merge`, então a classe do ponto
de uso vence a do shadcn.

**Descartado por ora: Drawer** (`vaul`, já instalado). O gesto de arrastar disputa com a
rolagem de formulário longo, `Select`/`Popover` do Radix dentro dele são atrito conhecido, e
escolher Drawer ou Dialog pela largura no SSR faz a página nascer desktop e trocar na
hidratação. **Volta só se o print com o teclado aberto mostrar problema.** A confirmação de
exclusão (`AlertDialog`) continua centrada, com margem lateral.

**`dvh` e teclado — o que é certo e o que depende do aparelho:**

* **Certo:** `dvh` acompanha a barra do browser que aparece e some com a rolagem (`svh`/`lvh` são
  os extremos). Suporte a partir do Chrome 108 e do Safari 15.4.
* **Depende do browser, não verificado aqui:** se o teclado virtual encolhe `dvh`. Pelo
  comportamento documentado, o Chrome Android (108+) por padrão redimensiona só o *visual
  viewport* (`interactive-widget=resizes-visual`), então `dvh` **não** encolhe com o teclado; a
  meta `interactive-widget=resizes-content` muda isso no Chrome/Firefox Android, e o Safari do
  iOS a ignora.
* **Visto no print do Android (07/10/2026):** o Dialog fixo com o teclado cobrindo a metade de
  baixo. O campo focado, no topo, ficou visível. **Campo mais baixo e rodapé não foram
  testados.**
* **Consequência:** `max-h` em `dvh` resolve a barra do browser, não garante o teclado. A prova é
  o print com um campo baixo focado e o rodapé à vista.

**`interactive-widget=resizes-content` (decidido em 08/10/2026, fatia 1a).** Verificado na
documentação: o MDN define que `resizes-content` redimensiona o próprio viewport (e com ele o
bloco que contém e as unidades de viewport), e `resizes-visual` é o default; o blog do Chrome
(developer.chrome.com/blog/viewport-resize-behavior) diz que o Chrome Android passou a
`resizes-visual` por padrão **no 108** e que a chave `interactive-widget` chegou na **mesma
versão**. Com `resizes-content`, o teclado encolhe o layout viewport: `dvh` encolhe junto, e o
`max-h-[90dvh]` do Dialog passa a caber acima do teclado. O Safari do iOS ignora a chave.
**Não verificado num aparelho** — a prova continua sendo o print com campo baixo focado.

⚠️ **Impacto previsto na fatia 1c.** O mesmo encolhimento move o que é `position: fixed`
ancorado embaixo: a **barra inferior** e o **botão flutuante** sobem junto com o teclado e
ficam colados nele, ocupando ~56 px acima do teclado enquanto se digita (o blog do Chrome:
elementos `position: fixed` "can end up elsewhere in the layout"). A 1c decide o que fazer —
aceitar, ou esconder os dois com o teclado aberto — e confere no aparelho.

### M-4: listas viram cartões

Cartões empilhados no celular. Na prática só Transações muda: as outras telas já são cards.
**Descartado: rolagem horizontal**, que esconde justamente o valor e as ações.

### M-5: gráficos

* **Fluxo Mensal (Dashboard):** ficam as 6 colunas, compactadas no celular (gap e largura de
  barra menores).
* **Comparativo (Relatórios):** no celular vira lista mês a mês com entrada e saída. ⚠️ **Sem
  coluna de saldo**: entrada − saída seria aritmética monetária no cliente, o que o front não faz
  (ver "Nenhuma soma monetária sobrou no front").
* Distribuição de gastos, Maiores categorias e Insights ficam como estão — já são listas.

### M-6: mobile-first, e a Sidebar passa de `md` para `lg`

Classes base = celular; `md:`/`lg:` ampliam. As grades já seguem isso; mudam as exceções: o
`grid-cols-12` de Transações, o `gap-8` do card de parcelamento, o `gap-6` dos gráficos, o `p-8`
dos cards e a Sidebar.

**A Sidebar aparece só a partir de `lg` (1024 px)**; abaixo, barra inferior. Em 768 com a
Sidebar sobram 416 px de conteúdo, e é ali que quase tudo quebrava. Custo aceito: tablet em pé
usa a navegação de celular.

### M-7: regressão sem teste de componente — três camadas

1. **Funções puras com teste vermelho** (por exemplo, a configuração da navegação).
2. **Teste de contrato sobre os arquivos** (abaixo).
3. **Checklist visual por tela**, em 320, 360, 390, 768 e desktop, feita pelo usuário.

**O teste de contrato.** Escopo: `src/routes/**/*.tsx` e `src/components/**/*.tsx`, **exceto**
`src/components/ui/` (shadcn gerado). Padrões proibidos:

| # | Proibido | Por quê | Exceção justificada |
|---|---|---|---|
| P1 | `grid-cols-N` com N ≥ 5 sem prefixo de breakpoint | colunas fixas em largura de celular | nenhuma |
| P2 | `opacity-0` sem prefixo junto de `group-hover:opacity-100` | ação invisível no toque | nenhuma: esconder no hover só a partir de breakpoint (`md:opacity-0 md:group-hover:opacity-100`) |
| P3 | `<input>` cru com `text-xs`/`text-sm` sem prefixo | o iOS dá zoom em fonte < 16 px | nenhuma: `text-base md:text-sm`, como o `ui/input` |
| P4 | `<button>`, `<Button>`, `<a>` ou `<Link>` com altura base explícita abaixo de `h-11` (44 px) | alvo de toque | `Sidebar.tsx`: só renderiza a partir de `lg`, com mouse |
| P5 | `100vh`, `h-screen`, `min-h-screen`, `vh` em valor arbitrário | a barra do browser no celular | nenhuma |
| P6 | largura fixa de 320 px ou mais sem prefixo (`w-[Npx]`/`min-w-[Npx]` com N ≥ 320, `w-80` = 320 px, `w-96`) | overflow horizontal | nenhuma |

* **Migração:** o teste entra na fatia 1a com uma lista de pendências (arquivo × padrão) que
  **só diminui** — cada fatia remove as suas. Acrescentar uma entrada é mudança no próprio teste,
  visível no diff.
* **Guarda contra varredura vazia:** o teste assere quantos arquivos leu, no espírito de
  `test_the_behavioural_sweep_actually_covered_something`.
* **Limite:** é heurística sobre strings de classe. Pega a volta dos padrões conhecidos, não
  problema novo de layout. P4 só vê altura **explícita**: alvo dimensionado por padding passa, e
  fica com a checklist.

**Endurecimento do contrato (09/10/2026, depois da revisão da 1a).** O detector
(`src/lib/mobile-contract.ts`) continua sendo **heurística sobre strings de classe**, agora com:

* **P2 com breakpoint no hover:** `opacity-0 md:group-hover:opacity-100` também é pego — abaixo do
  breakpoint a ação fica invisível do mesmo jeito.
* **P1 arbitrário:** `grid-cols-[…]` conta as trilhas (`repeat(N,…)` = N; senão, os pedaços
  separados por `_`) e pega a partir de 5. `repeat(auto-fill|auto-fit,…)` passa: se adapta.
* **P4 e P6 em rem:** valor arbitrário em `px` ou `rem` (1 rem = 16 px): `h-[2rem]`, `w-[20rem]`.
* **Pendências por contagem:** a lista passa a arquivo × padrão × **quantidade**. Uma ocorrência a
  mais falha; uma a menos também, para a fatia que corrigiu baixar a contagem.
* **Guarda por diretório**, no lugar do piso de arquivos: `routes/` e cada subpasta de
  `components/` (menos `ui/`) têm que contribuir com pelo menos um arquivo. A lista de pastas vem
  do disco, não da varredura.
* **Uma definição só de "classe"** (`CLASS_TOKEN`), que respeita colchetes, usada por todas as
  regras.

⚠️ **Limitação: uma violação por padrão por linha.** Uma segunda violação do mesmo padrão na
mesma linha não é detectada — nem contada na lista de pendências. A contagem é de linhas, não de
classes.

**Item futuro: Playwright.** Viewport de 360 por rota, conferindo `scrollWidth <= innerWidth`. É
a única opção que **mede** overflow. Custo estimado, não orçado: `@playwright/test` como
dependência de dev; Chromium no CI (~150 MB, cacheável); um job novo de alguns minutos; backend
real em SQLite no job, com sessão emitida pelo segredo de desenvolvimento (o `AuthGate` exige
`/auth/me`) e dados semeados. Uma fatia própria. Não roda no container do agente.

### M-8: PWA fora de escopo

Manifest e ícones são baratos; o risco é o *service worker*: cache de dado financeiro com
cookie de sessão e SSR é a mesma classe de problema do `queryClient.clear()` no logout.
`viewport-fit=cover` e `lang="pt-BR"` entram na fatia 1a como pré-requisitos da barra inferior,
não como PWA.

### M-9: `AppShell` — layout externo único (decidido em 11/10/2026, fatia 1b)

**Decidido.** `components/layout/AppShell.tsx` renderiza o que as 5 rotas repetem hoje, com as
mesmas classes: `<div className="flex min-h-dvh bg-background text-foreground">`, `<Sidebar />`
e `<main className="flex-1 p-6 md:p-12 max-w-[1400px] mx-auto">` com `children`. Conferido
token por token em 11/10/2026: o wrapper, a `Sidebar` e o `<main>` são idênticos nas 5; nada
fica entre `</main>` e `</div>`. O cabeçalho **fica fora**: o Dashboard tem `Header` local
sem o `max-w-xl` do `PageHeader`, e unificar mudaria o desktop (backlog, fatia 3).

**Descartado: rota de layout do TanStack** (pathless, `_app.tsx`). Mexe na árvore de rotas e no
`routeTree.gen.ts` — raio maior que uma extração sem mudança visual.

**Prova de "sem mudança visual":** estática — classes e estrutura idênticas, então o DOM
renderizado é o mesmo — mais o teste de contrato sobre arquivo (as 5 rotas usam `<AppShell>` e
não têm mais `<Sidebar`/`<main`; os tokens do `AppShell` escritos por extenso no teste; `Sidebar`
antes do `<main>`; varredura P1–P6 inalterada). **Conferência visual pelo usuário: a 1280 e a
768 px, nas 5 telas** (Início, Transações, Categorias, Parcelamentos, Relatórios). Sem impacto no
contrato com o backend.

**`min-w-0` no `<main>` — primeiro item da 1c, com teste vermelho.** O `<main>` é `flex-1`
dentro de um `flex`; item de flex tem `min-width: auto` e cresce até a largura mínima do
conteúdo, então um descendente largo alarga a página inteira e todos os cards vazam junto
(Parcelamentos a 768 com a Sidebar, Relatórios a 360, Dashboard a 720 — prints do usuário).
⚠️ **O `min-w-0` só confina:** o descendente largo continua saindo da própria caixa, e esse
transbordo visível ainda dá rolagem horizontal. As causas reais ficam nas fatias:
**3** — Dashboard a 720, causa não identificada por leitura, **a medir**; **4** — a grade
`md:grid-cols-3` dos cards de resumo de Parcelamentos (trilha `1fr` não encolhe abaixo de
"COMPROMETIDO/MÊS" + `p-6`); **5** — as barras do Comparativo (6 colunas × 2 barras `w-5` +
`gap-6` ≈ 396 px mínimos). **Descartado: `overflow-x-hidden`**, que cortaria valores e ações em
silêncio (M-4).

### M-10: fatia 1c — barras, medidas e empilhamento (decidido em 11/10/2026)

**Decidido antes da implementação.** Só CSS para mostrar e esconder (`lg:hidden` / `hidden lg:flex`):
sem `useIsMobile`, sem troca de componente na hidratação (mesmo motivo do M-3).

* **Ordem dos itens:** 1) `min-w-0` no `<main>` (M-9); 2) navegação em fonte única; 3) barra
  inferior; 4) barra superior; 5) Sidebar de `md` para `lg`.
* **Fonte única da navegação:** `lib/navigation.ts`, função pura e sem ícone (ícone é componente
  React; o mapa chave → ícone fica em `components/layout/`). Cada item tem `key`, `to`, `label`
  (Sidebar: "Dashboard", "Parcelamentos" — **≥ 1024 px fica idêntico a hoje**) e `shortLabel`
  (barra inferior: "Início", "Parcelas"; até 10 caracteres, para caber em ~64 px).
* **Item ativo:** `activeNavKey(pathname)`, função pura. `/` só casa com `/`; as outras casam com
  o caminho exato ou com um subcaminho (`/transacoes/…`), barra final ignorada; `/transacoesx` e
  rota desconhecida dão `null`. A barra inferior a usa e marca `aria-current="page"`. **A Sidebar
  mantém o `activeOptions={{ exact: true }}` do `Link`** — trocar o mecanismo mudaria o DOM dela.
  Para as 5 rotas de hoje, os dois dão o mesmo resultado (testado).
* **Medidas em variável CSS** (`styles.css`, `:root`): `--app-topbar-height: 3rem` (48 px; cabe o
  alvo de 44 px de "Sair") e `--app-bottombar-height: 3.5rem` (56 px, M-1). A partir de `lg`
  (`64rem`) as duas valem `0px`. A área segura vai **por fora** da variável: a barra soma
  `env(safe-area-inset-*)` no próprio padding, e quem compensa soma também.
* **Espaço do `<main>`:** abaixo de `lg`, `pt`/`pb` = altura da barra + área segura + o padding de
  hoje (`1.5rem`, `md:` `3rem`); `lg:pt-12 lg:pb-12` devolvem o `p-12` de hoje. Descartado: padding
  no wrapper, porque o pedido é o `<main>` reservar o espaço e a Sidebar `sticky h-dvh` mora no
  wrapper.
* **Toast:** `mobileOffset.top` já soma `var(--app-topbar-height, 0px)` (1a). **Falta o `offset`:**
  o sonner só usa `mobileOffset` até 600 px; de 601 a 1023 px ele usa `offset` (padrão `24px`) e o
  toast cairia sobre a barra superior. Entra
  `offset={{ top: "calc(env(safe-area-inset-top) + var(--app-topbar-height, 0px) + 24px)" }}`; a
  partir de `lg` a variável é 0 e dá os mesmos 24 px de hoje.
* **Barra superior:** `fixed top-0`, só abaixo de `lg`, com a marca à esquerda e o `UserMenu` à
  direita, em linha. O `UserMenu` ganha uma prop de disposição (`variant="topbar"`); **sem a prop,
  o DOM é o de hoje** (a Sidebar continua chamando `<UserMenu />`). Na barra, "Sair" tem `min-h-11`.
* **Barra inferior:** `<nav aria-label="Navegação principal">` `fixed bottom-0`, só abaixo de
  `lg`, 5 `Link` com `flex-1` e `min-h-11`, ícone + `shortLabel`, `pb` com
  `env(safe-area-inset-bottom)`.
* **(a) Teclado aberto:** com `interactive-widget=resizes-content` (1a), a barra inferior sobe e
  fica colada no teclado. **Aceito na 1c, sem JS.** Os formulários abrem em `Dialog`, cujo overlay
  (`z-50`) cobre as barras (`z-40`): com o teclado aberto num formulário a barra não aparece. O caso
  que sobra é a busca de Transações, fora de diálogo — conferir no aparelho na **fatia 2**, junto do
  botão flutuante, que tem o mesmo comportamento. **Descartado:** esconder com JS (`visualViewport`
  ou `focusin`): estado novo e heurística de "teclado aberto" que não dá para verificar no
  container; e voltar a `resizes-visual`, que desfaz o motivo da 1a.
* **(b) Empilhamento (z-index):** conteúdo (`auto`) < **barras `z-40`** < `Dialog`, `AlertDialog`,
  `Select` e `Popover` do shadcn (`z-50`, em portal) < toast do sonner (`z-index: 999999999`, do
  próprio CSS dele). As barras abaixo de 50 é o que faz o overlay do diálogo cobri-las; o botão
  flutuante da fatia 2 entra no mesmo nível das barras. A Sidebar não tem z-index (não é fixa).
* **Prova de ≥ 1024 px idêntico:** a Sidebar muda só `md:flex` → `lg:flex`; os itens dela vêm da
  fonte única com os mesmos rótulos, a mesma ordem e o mesmo `exact`; o `<main>` a partir de `lg`
  tem o mesmo padding; as barras são `lg:hidden`; o toast dá os mesmos 24 px. A única mudança
  computada é o `min-w-0`, neutro quando nada transborda. O usuário confere por olho a 1280.
  **Abaixo de 1024 px a mudança é intencional** (768 passa a usar a navegação de celular, M-6).

### Fatias

Um commit verde por fatia, na `main`, conferido num checkout limpo. Em cada uma: `tsc --noEmit`,
eslint e `npm test` rodam no container; **`vite build` não roda** (o `node_modules` é win32).

| # | Conteúdo |
|---|---|
| 0 | Esta seção, a doc desatualizada (stack, árvore de diretórios), "Ver as telas localmente" e `.claude/worktrees/` no `.gitignore` |
| 1a | `viewport-fit=cover`, `interactive-widget=resizes-content`, `lang="pt-BR"`, `dvh` no lugar de `100vh`, posição do toast escolhida para não colidir com as barras e o botão flutuante; o teste de contrato entra aqui |
| 1b | Componente de layout único (`AppShell`, M-9) no lugar das 5 cópias de `<div flex min-h-dvh><Sidebar/><main …>`, **sem mudança visual** |
| 1c | `min-w-0` no `<main>` do `AppShell` (primeiro item, M-9), barra inferior, barra superior com conta e logout, Sidebar de `md` para `lg` |
| 2 | Transações: cartões, ações visíveis com 44 px, busca com 16 px, botão flutuante, formulário de transação responsivo (M-3), que o Dashboard também usa |
| 3 | Dashboard: cartões de métrica (o print provou o vazamento; testar com "R$ 100.000,00"), Fluxo Mensal compacto, recentes com truncamento |
| 4 | Categorias e Parcelamentos: ações visíveis, card de parcelamento empilhado, os dois formulários responsivos |
| 5 | Relatórios: Comparativo em lista no celular, totais |

---

