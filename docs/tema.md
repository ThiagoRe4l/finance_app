## 📒 Tema — Caderno (decidido em 18/11/2026; substitui D-Tema-1, 2, 4 e 5)

**Decidido antes da implementação**, a partir do canvas "Fisco — Redesign visual" no Claude
Design (direção A, "Caderno"), aprovado pelo usuário em 18/11/2026 ("Caderno completo";
"Aprovado, seguir"). O canvas cobre login, as 4 telas, celular e todos os popups. Só frontend,
**sem impacto no contrato com o backend**: nenhum campo novo, nenhuma soma de dinheiro no cliente.

**D-Cad-1: paleta de livro-caixa.** Fundo **papel** `#F6F3EC`, cartão e popover **branco**
`#FFFFFF`, texto **tinta** `#14222B` (apoio `#5B6670`), ação principal **ardósia** `#26404F` com
texto papel `#FAF8F5`. Dinheiro: **entrada** verde `#1F7A4D` (texto), **saída** âmbar `#D08A3C`
(barra e ponto) e `--expense-text` âmbar escuro (texto, ≥ 4,5:1), **erro** vermelho `#B3261E`,
distinto de saída (D-Tema-3 continua). Valores em `oklch` saídos de `hexToOklchText`.
*Descartado:* manter verde Fisco + laranja e trocar só a forma (opção "só forma, cores atuais"),
recusada pelo usuário.

**D-Cad-2: a ação principal volta a servir de texto.** Ardósia sobre papel passa de 9:1, então
`text-primary` deixa de ser proibido (a regra de D-Tema-2 era do laranja). A regra que fica: o
**âmbar puro não é texto** (< 3:1 sobre o papel) — texto de saída usa `--expense-text`.

**D-Cad-3: o menu é claro.** Os tokens `--sidebar*` continuam sendo a fonte do menu (D-Tema-4 no
mecanismo), com outros valores: fundo `#F1EDE3`, texto tinta, borda `#E4DED1`, hover `--sidebar-accent`.
**Item ativo como no canvas:** na Sidebar, cartão branco (`--sidebar-primary`) com texto tinta e
contorno de 1 px da borda do menu; na barra inferior, o ícone do ativo numa pílula
`--sidebar-accent` e o rótulo em tinta semibold. Só as classes do estado ativo mudam (Sidebar e
BottomNav); tamanho, alvo de 44 px e empilhamento (M-10) ficam. *Descartado:* rótulo ativo em cor
de destaque na barra inferior — com o menu claro, o `--sidebar-primary` branco seria texto
invisível.

**D-Cad-4: Fraunces nos títulos e números** (`--font-display`, serifada, eixo `opsz`, pesos 400 a
600), Inter no resto. O `<link>` do `__root.tsx` troca Space Grotesk por Fraunces. As classes
`font-display` que já existem (PageHeader, MetricCard, SavingsHero…) herdam a troca sem mudar.

**D-Cad-5: contraste testado, não visto** — a D-Tema-6 continua, com os pares revistos em
`lib/theme.test.ts`.

**Aprovação dos testes das fatias C2 a C6 delegada pelo usuário em 18/11/2026** ("pode seguir
com todas as etapas"), como na M-14: cada fatia registra a decisão aqui, escreve os testes, roda
o vermelho e implementa até o verde, num commit próprio.

**D-Cad-6: fatia C2 — Visão Geral.**

* **Os três indicadores viram linhas de extrato dentro do "Sobrou no mês".** Entradas, Saídas e
  Saldo atual saem da grade de cartões e entram no `SavingsHero` como `children`, num painel à
  direita a partir de `md` (empilhado abaixo). Cada linha é nome, pontilhado e valor. O
  `MetricCard` ganha `variant="ledger"`; o padrão `card` não muda. O valor continua um elemento
  só, `whitespace-nowrap` e sem corte (M-13), e `tone` × `trend` continuam independentes (o bug
  de 13/08/2026). A grade dos cartões (M-15) sai do `Summary` e do `LoadingState`.
  *Descartado:* um componente novo só para as linhas — o `MetricCard` já carrega a separação
  entre cor e seta.
* **Pontilhado:** `components/shared/Leader.tsx`, `aria-hidden`, só decoração: o leitor de tela
  lê nome e valor.
* **`PanelTitle` em Fraunces** (`font-display text-xl font-medium`); o subtítulo de 13 px fica.
  Substitui o tamanho da D-Tema-8.
* **`RecurringCard`:** Parcelamentos e Assinaturas em linhas de extrato, e o "Comprometido por mês"
  num bloco ardósia (`bg-primary text-primary-foreground`), no lugar do `bg-expense/20` da
  D-Tema-7.

**D-Cad-7: fatia C3 — Transações agrupadas por dia.**

* **Função pura `groupByDay(transações, hoje)`** (`lib/day-groups.ts`): agrupa a lista já ordenada
  (mais nova primeiro) por `date`, na mesma ordem, e dá a cada grupo um rótulo: "Hoje · 17 nov",
  "Ontem · 16 nov", senão o dia da semana ("Sexta · 14 nov"); o ano entra só quando não é o de
  hoje. Datas lidas por componente, sem `new Date(iso)` (o erro de fuso do `date.ts`).
  **Sem total do dia** (backlog: soma de dinheiro no cliente).
* **Nas duas marcações:** nos cartões, cada dia é um `<li>` com um `<h3>` em Fraunces e a lista
  dos cartões do dia; na tabela, uma linha de cabeçalho do dia antes das linhas dele. Cartão,
  linha, colunas e ações ficam como estão (M-12, M-16): a data continua no cartão e na coluna.
  *Descartado:* tirar a coluna Data da tabela, como no canvas — mudaria as classes travadas da
  M-12 e o valor a 1024 px (backlog) sem ganho de leitura.

**D-Cad-8: fatia C4 — Categorias e Recorrências.**

* **Trilha de parcelas** no cartão de parcelamento: um segmento por parcela — pagas em ardósia,
  a atual em ardósia clara, as que faltam em papel. Função pura `installmentTrack(atual, total)`
  em `lib/installments.ts`, sobre a mesma regra de `installmentProgress` (pagas = atual − 1,
  quitado = atual > total). **Acima de 36 parcelas** (ou total inválido) devolve `null` e o
  cartão mantém a barra contínua: segmento de menos de ~8 px não se lê. A trilha é
  `role="img"` com "Parcela X de Y"; o texto "Parcela X de Y · N% pago" continua em cima.
* **Nomes e valores em Fraunces** nos cartões de categoria, parcelamento e assinatura
  (`font-display`); classes de quebra (M-16) e de não-corte (M-13) ficam.

**D-Cad-9: fatia C5 — popups.**

* **Títulos em Fraunces** em todo `DialogTitle` e `AlertDialogTitle` (formulários de transação,
  categoria, parcelamento e assinatura, importação de fatura e as quatro exclusões), pela
  `className` no ponto de uso — `components/ui/` não muda (M-3). O `wrap-anywhere` das
  exclusões (M-16) fica, e a exclusão de assinatura passa a tê-lo também.
* **Valor em destaque no formulário de transação:** o campo do valor em Fraunces `text-xl`, com
  a altura e o alvo de hoje (`h-11 sm:h-9`, M-12). O Tipo já é o par de botões Entrada/Saída
  (F-2) e fica.
* **Resumo do parcelamento em linhas de extrato:** cada par `dt`/`dd` numa linha com o
  pontilhado (`Leader`) e o valor em Fraunces; a semântica de `dl` continua.
* **Prévia da categoria** no formulário: ícone, cor, nome e orçamento como o cartão vai
  aparecer, `aria-hidden` (repete o que os campos já dizem). Nenhuma conta: o orçamento aparece
  como foi digitado.
* **Assinatura:** na criação, uma linha "Todo dia X · primeira cobrança em DD/MM/AAAA", função
  pura `chargePreview` em `lib/subscriptions.ts`, sobre o `billingDay` que o resto da tela já
  usa. *Descartado:* calcular a "próxima" cobrança no cliente — a regra de mês curto é do
  backend, e uma prévia divergente engana.
* **Descartado:** reescrever o Tipo, os seletores ou o calendário — já são os do canvas.

**D-Cad-10: fatia C6 — login.**

* **A tela do canvas:** fundo papel pautado (linhas de 40 px em `--border`, só CSS), a marca,
  "Fisco" em Fraunces grande, a frase "Seu caderno de contas, em ordem." e, embaixo, o texto de
  hoje ("Organizador financeiro pessoal. O acesso é restrito."). O botão do Google continua o
  oficial, renderizado pelo GSI (D-Auth-1), dentro de um cartão branco; o erro vira um aviso com
  ícone (`role="alert"` continua) e o texto vindo do backend, sem mudança.
* **Mobile-first:** no celular o conteúdo fica no alto e o cartão do botão desce para perto do
  polegar (`mt-auto`); a partir de `sm`, tudo centrado numa coluna de `max-w-sm`. `min-h-dvh`
  continua (P5). Sem mudança de autenticação, sessão ou allowlist.

### Fatias do Caderno

Um commit verde por fatia, com teste vermelho aprovado antes, como na reforma mobile.

| # | Conteúdo |
|---|---|
| C1 | Tokens (D-Cad-1/2), Fraunces (D-Cad-4) e menu claro com o item ativo do canvas (D-Cad-3) |
| C2 | Visão Geral: "Sobrou no mês" com Entradas, Saídas e Saldo atual em linhas de extrato (pontilhado entre nome e valor), Recorrências em cartão escuro |
| C3 | Transações agrupadas por dia (a data vira cabeçalho do grupo); linha de filtro do canvas |
| C4 | Categorias e Recorrências: cartões do canvas, trilha de parcelas pagas × a pagar no parcelamento |
| C5 | Popups: valor em destaque, Tipo como dois botões, prévia da categoria, resumo do parcelamento em linhas de extrato, "Todo dia X · próxima em …" na assinatura |
| C6 | Login |

**Fora do Caderno, registrado em `docs/backlog.md`:** o **total do dia** nos grupos de
Transações que o canvas mostra — é soma de dinheiro, então só entra com campo vindo da API
(decisão de backend própria). Até lá, o cabeçalho do grupo mostra só a data.

---

## 🎨 Tema — paleta 60 · 30 · 10 (decidido em 13/11/2026)

> ⚠️ **D-Tema-1, 2, 4 e 5 substituídos em 18/11/2026 pelo Caderno (acima).** D-Tema-3
> (tokens de entrada × saída) e D-Tema-6 (contraste testado) continuam, com os valores novos.

**Decidido antes da implementação**, a partir da proposta de design aprovada pelo usuário
("implemente"; autorização para seguir planejamento > implementação > teste > revisão). Só
frontend, **sem impacto no contrato com o backend**.

**D-Tema-1: três cores, três papéis.** 60% **creme** `#F0EDE6` (fundo e, em tom mais claro
`#F7F5F0`, cartões); 30% **verde Fisco** `#1B422F` (menu, barras de celular, textos, entradas);
10% **laranja** `#FF8A1F` (ação principal, saídas, alertas). Tudo em `oklch`, como exige o
`styles.css`; os valores saem de `lib/color.ts` (`hexToOklchText`), não de conta à mão.

**D-Tema-2: `--primary` passa a ser o laranja**, com `--primary-foreground` verde (4,77:1). Todo
`bg-primary` do app (botões, flutuante, chips) vira a ação principal sem mexer em cada tela.
*Descartado:* um token `--cta` novo — obrigaria a trocar `bg-primary` em ~15 pontos e os botões do
shadcn. **Consequência:** laranja **nunca é texto sobre creme** (2,0:1). Os usos de `text-primary`
(marca, ícones, item ativo) passam a `text-brand` (o verde); texto de alerta usa `--expense-text`
`#A64500` (5,2:1).

**D-Tema-3: entrada × saída têm cor própria.** Novos tokens `--income` (verde), `--expense`
(laranja, para barras e pontos) e `--expense-text` (laranja escuro, para texto). `--destructive`
fica vermelho `#B3261E`, **distinto** de saída: erro não é gasto. Saem do código os
`oklch(0.55 0.15 155)` e afins escritos à mão (`text-income`).

**D-Tema-4: o menu é escuro.** Sidebar, barra superior e barra inferior usam os tokens
`--sidebar*` (verde, creme, item ativo laranja). O `UserMenu` vive dentro delas e segue os mesmos
tokens. Nada muda em tamanho, alvo de toque ou empilhamento (M-10).

**D-Tema-5: Space Grotesk nos números e títulos** (`--font-display`), Inter no resto. É o que a
proposta mostra; entra o `<link>` da fonte no `__root.tsx`.

**Foco e campo (revisão de 13/11/2026):** `--ring` é o **verde** (o laranja só tem 2:1 sobre o
creme; o menu escuro usa `--sidebar-ring`, laranja) e `--input` (borda de campo) tem 3:1 sobre o
cartão, WCAG 1.4.11 — a borda de campo anterior (`oklch(0.92 …)`) não passava.

**D-Tema-6: contraste testado, não visto.** `lib/theme.test.ts` lê os tokens do `styles.css` e
exige ≥ 4,5:1 nos pares de texto (e 3:1 nos de componente), mais a regra de que laranja não é
texto sobre creme. O modo `.dark` **não é usado** (nenhuma tela o liga) e fica como está.

**Fora desta fatia (registrado em `docs/backlog.md`):** os módulos analíticos da proposta que
**não têm dado hoje** — projeção de sobra do mês, "Saúde financeira" (poupança, reserva, renda
comprometida), metas, "Próximas cobranças". Cada um precisa de decisão de backend (endpoint,
`Decimal`, isolamento por dono) antes da tela.

### Estrutura do Dashboard e dos cards (decidido em 13/11/2026)

**Decidido antes da implementação**, a pedido do usuário ("organize os cards, fonts, estrutura
conforme a proposta"). Só frontend, **sem impacto no contrato com o backend**.

**D-Tema-7: três linhas, na ordem da proposta.** (1) quatro indicadores — *Saldo atual*,
*Entradas*, *Saídas*, *Economia* (antes: Saldo Total, Receitas, Despesas); (2) *Entradas e saídas*
(2/3, o Fluxo Mensal) ao lado de *Recorrências* (1/3, extraída para `RecurringCard`, com o
"Comprometido por mês" em destaque laranja); (3) *Distribuição de gastos* (5/12) ao lado de
*Últimas movimentações* (7/12), esta com Entradas e Saídas **lado a lado** a partir de `md`.
Antes, Transações Recentes dividia a linha 2 com o gráfico e a distribuição dividia a 3 com
Recorrências. A grade dos indicadores (M-15) não muda.

**D-Tema-8: um cabeçalho de cartão só.** `PanelTitle` (`components/dashboard/`): título em
`text-[15px] font-semibold` e subtítulo em `text-[13px]` de apoio, como na proposta. Os quatro
cartões do Dashboard o usam; o padding passa de `p-8` a `p-6`. O `MetricCard` já tem `p-6`.

**Fica de fora, por falta de dado** (backlog): o bloco "Saúde financeira" (que a proposta põe ao
lado do gráfico), "Orçamento por categoria" com limite, "Metas" e "Próximas cobranças". A
Recorrências ocupa o lugar da Saúde financeira; a Distribuição de gastos, o do Orçamento.
