## 🎨 Tema — paleta 60 · 30 · 10 (decidido em 13/11/2026)

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
