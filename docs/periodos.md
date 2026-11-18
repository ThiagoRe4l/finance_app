## 🗓️ Períodos — filtro por página (decidido em 13/11/2026)

**Decidido antes da implementação**, a pedido do usuário. Problema: o Dashboard mostra o mês
corrente nos cartões e 6 meses no gráfico, os Relatórios mostram 6 meses, e nenhuma tela tem
filtro. Os testes (`tests/test_period_filter.py`) vêm antes do código.

**PER-1: cada página tem o seu filtro, e o padrão é o mês atual.** Dashboard e Relatórios
ganham um seletor de período, guardado na URL (`?periodo=`). Sem parâmetro = mês corrente, nas
duas telas. *Descartado:* um filtro único global no `AppShell` — o usuário quer filtro por
página, e o período de uma não precisa ditar o da outra.

**PER-2: gramática do período**, a mesma nas duas rotas (`?period=` no backend):
`YYYY-MM` (um mês), `YYYY` (um ano), `3m`, `6m` e `12m` (as janelas que terminam no mês corrente; a
`6m` é o recorte que os Relatórios tinham) e `all` (do primeiro lançamento até o fim do mês corrente). Qualquer outra
coisa → **422**. Ausente = mês corrente. ⚠️ **Muda o padrão dos Relatórios** de 6 meses para o
mês corrente; os testes antigos de `test_reports.py` passam a pedir `?period=6m`.

**PER-3: a soma é do backend**, em `Decimal` (D-Money). Segue o período: `total_revenues`,
`total_expenses`, `total_savings`, `total_balance`, `recent_transactions` e a distribuição por
categoria (Dashboard); os três totais, `average_savings` (dividido pelos meses do período) e
`top_categories` (Relatórios). **Não segue:** o widget de recorrências (continua "ativas hoje") e o
`monthly_flow`/`monthly_comparative`, que mostram **6 meses terminando no mês escolhido**
(`6m` e mês), os 12 meses do ano (`YYYY`) ou todos os meses (`all`) — contexto, não recorte.

**PER-4: mês futuro é projeção, e assinatura entra nela.** Parcela já é linha futura no extrato
(P-2), então aparece no mês dela sem fazer nada. Assinatura **não** é linha (R-3), então a
cobrança com data depois de hoje é **calculada na leitura** (`charge_dates`) e somada a
`total_expenses` e à barra do mês. Vale também para o que falta do mês corrente (assinatura que
cobra dia 15, hoje dia 13). Nada disso vira linha: R-3 continua valendo para o extrato e o saldo
real. A resposta traz `projected_expenses` (só a parte calculada) e `is_projection` (o período
termina depois de hoje), para a tela rotular. *Descartado:* gerar linhas futuras (R-3 já recusou:
exige rotina de renovação e põe lançamento futuro no saldo).

**PER-5: saldo do período.** Período que contém hoje (mês corrente, ano corrente, `6m`, `all`) =
saldo de hoje, como sempre (S-1). Período inteiro no passado = saldo ao fim dele. Período inteiro no
futuro = saldo até o fim dele, **menos** as cobranças de assinatura projetadas entre hoje e esse dia.

**PER-6: até onde o filtro vai.** `GET /periods/range` devolve `min_month`, `max_month` e
`current_month`. `min` = mês do lançamento mais antigo (sem dado: o corrente). `max` = o **maior**
entre "12 meses à frente" e o mês da última parcela futura. Assim as duas ideias do usuário
valem: um parcelamento até dez/2027 é alcançável, e quem só tem assinatura (que não acaba) vê 12
meses. Além do `max` o seletor não oferece; o backend, porém, aceita qualquer mês válido.

**PER-7: `month_key` em cada mês do gráfico.** `MonthlyFlow` ganha `month_key` (`"2026-11"`),
porque `"Nov"` sozinho é ambíguo com `all` e `YYYY`. `month` (o rótulo curto) não muda.

**Impacto no contrato com o frontend.** Todos os campos novos são aditivos: `period`
(`{key, start, end}`, `end` exclusivo), `projected_expenses`, `is_projection` nos dois resumos;
`month_key` em `MonthlyFlow`; a rota `GET /periods/range`. O parâmetro `period` é opcional.
Sem migration. Fatias: **1** backend (esta), **2** seletor na URL ligado às duas telas,
**3** tooltips nos gráficos, **4** favicon.

---

### Fatia 1 — backend implementado (13/11/2026)

`app/periods.py` (`parse_period`, `Period`), `app/period_aggregates.py` (totais, fluxo, projeção e
saldo, usados pelas duas rotas), `routers/periods.py` e o parâmetro `period` em
`GET /dashboard/summary` e `GET /reports/overview`. `tests/test_period_filter.py`: 30 testes verdes.
Os testes antigos de Relatórios que assumiam 6 meses passaram a pedir `?period=6m`
(`test_calendar_edges`, `test_dashboard`, `test_money_precision`, `test_reports`).

* **`Dashboard.recent_transactions` mudou de sentido:** eram as 7 mais recentes de todo o
  histórico; agora são as 7 mais recentes **do período**. Mês corrente sem lançamento = lista vazia.
* **Variações em %** (`expenses_change_pct`, `balance_change_pct`) só existem quando o período é um
  mês; nos demais são `null`.
* **Pendência de ambiente, anterior a esta fatia:** 6 testes falham no Windows com ou sem esta
  mudança (`test_settings`, `test_database_bootstrap`, `test_balance_counts_new_years_day…`).

### Fatia 2 — seletor nas telas (implementada em 13/11/2026)

`lib/period.ts` (funções puras), `components/shared/PeriodFilter.tsx` (‹ seletor ›, lê
`GET /periods/range`) e a ligação em `routes/index.tsx` e `routes/relatorios.tsx`: o período vai
na URL (`?periodo=`, inválido é descartado), no `queryKey` e na chamada (`?period=`); o mês corrente
deixa a URL limpa. Trocar de período mantém os números antigos até os novos chegarem
(`placeholderData`). Quando `projected_expenses` não é `"0.00"`, a tela avisa que as despesas
incluem cobranças previstas de assinatura. O subtítulo do Fluxo Mensal passou a dizer quantos meses
mostra. `tsc`, eslint e 405 testes verdes.

⚠️ **Não conferido:** a tela renderizada e logada (a sessão do Google é do usuário). Falta a
conferência visual a 360, 390, 768 e desktop. Retoques em testes anteriores: `page-header-mobile.test.ts`
(o eyebrow do Dashboard deixou de ser literal) e, no teste novo, a checagem dos 44 px passou a olhar
`ARROW` e o `SelectTrigger`.

### Fatia 3 — tooltips nos gráficos (implementada em 13/11/2026)

`components/shared/MonthColumn.tsx` envolve cada mês do Fluxo Mensal e do Comparativo: é um botão
que abre um `Popover` (em portal, então a rolagem do `MonthScroller` não o corta) com o mês por
extenso, Entradas e Saídas formatadas, e "· Projeção" em mês depois do corrente. Abre com mouse por
cima, clique/toque e Enter; fecha ao sair, com novo clique, Esc ou toque fora. `lib/month-tooltip.ts`
tem o texto (puro). *Descartado:* o `Tooltip` do Radix, que não abre por toque.
**Sem "saldo do mês":** entradas − saídas seria soma de dinheiro no cliente; se quiserem o número, é
um campo novo do backend. A "Distribuição de Gastos" deixou de dizer "Mês corrente" fixo e mostra o
período (`periodLabel`), um erro da fatia 2. O teste de contrato da 1d (`month-scroller.test.ts`) passou
a procurar as classes de largura no `<MonthColumn>`, onde a coluna agora mora.

⚠️ **Não conferido na tela:** posição do tooltip perto da borda, no celular e no desktop.

### Fatia 4 — ícone da página (implementada em 13/11/2026)

> ⚠️ **Substituída em 18/11/2026 pela M-17** (`docs/mobile-first.md`): os ícones passaram a ter o
> desenho do `BrandMark` (gradiente ardósia, "F" claro com a barra verde), ganharam o
> `favicon.ico` e um teste que confere os dois desenhos. O texto abaixo é o histórico.

`frontend/public/favicon.svg` (quadrado arredondado escuro com a letra F de Fisco em verde, sem
fonte nem recurso externo) e `public/apple-touch-icon.png` (180×180, sem cantos: o iOS arredonda
sozinho), declarados no `__root.tsx`. Não há `favicon.ico`: os navegadores atuais usam o SVG; só
navegador muito antigo cairia no ícone genérico. `lib/favicon.test.ts` trava as duas declarações e a
existência e o formato dos arquivos.

⚠️ O teste foi escrito antes (visto vermelho), mas **a aprovação dele não foi pedida em separado**:
"Sim, fatia 4" foi tomado como o aval. **Não conferido no navegador:** a aba e o ícone na tela
inicial do celular. A Vercel serve `public/` antes do rewrite para o shell; confira na primeira
publicação.

### Redesenho do filtro (13/11/2026, a pedido do usuário, com referência de imagem)

O seletor deixou de ser ‹ Select › mais atalhos. Agora é um botão com o mês (`Nov/26 ⌄`) que abre uma
**grade de meses** (ano no topo com setas, 12 meses, fora do range desligados, o escolhido em
destaque) e **atalhos** `3M · 6M · 1A · Tudo`. Backend: `3m` e `12m` passaram a valer (`TRAILING_WINDOWS`,
`Period.kind == "trailing"`); `1A` = os 12 meses que terminam no corrente, não o ano-calendário (esse
continua por `?periodo=2026`, mas não tem atalho). Saíram as setas ‹ › de mês e o `periodChoices`.
Os testes foram atualizados junto; a aprovação não foi pedida em separado (o pedido de redesenho foi o aval).

---

### PER-8: Transações também filtra por período (decidido em 13/11/2026)

**Decidido antes da implementação**, a pedido do usuário ("mostrar todas as transações não funciona,
precisa de filtro, e sempre da mais nova para a mais antiga"). A tela de Transações listava o
histórico inteiro, sem recorte nem paginação.

* **`GET /transactions?period=`** com a gramática da PER-2 (`YYYY-MM`, `YYYY`, `3m`, `6m`, `12m`,
  `all`; inválido = **422**). Filtra `date >= start` e `date < end` (`end` exclusivo). **Sem
  `period` devolve tudo**, como antes — aditivo, para não quebrar quem já chama a rota.
  *Descartado:* tornar o mês corrente o padrão **no backend** — mudaria a resposta de quem não manda
  parâmetro; é a tela que manda o período.
* **A tela manda sempre o período**, e o padrão é o mês corrente (PER-1): o seletor de período
  (`PeriodFilter`) fica ao lado das abas Entradas/Saídas, na URL (`?periodo=` e `?aba=`,
  preservando um ao trocar o outro). A busca por texto continua no cliente, dentro do período.
  *Descartado:* paginação — com o recorte mensal a lista é pequena, e "tudo" segue existindo para quem
  escolhe `all`.
* **Ordem: da mais nova para a mais antiga**, `date` desc e, no mesmo dia, `id` desc (o lançado por
  último primeiro). O backend já ordena; `sortNewestFirst` (`lib/transactions.ts`) repete a regra no
  cliente, depois da aba e da busca, para a ordem não depender de quem chamou.
* **Cache:** `queryKey: ["transactions", período]`. As invalidações existentes de `["transactions"]`
  pegam todos os períodos pelo prefixo.
* **Impacto no contrato:** parâmetro novo e opcional; resposta idêntica. Sem migration.

### PER-9: intervalo entre meses (decidido em 13/11/2026)

**Decidido a pedido do usuário**, junto da opção B de layout (`docs/ux-leis.md`, F-2). Nova forma
de `?period=`: **`AAAA-MM..AAAA-MM`**, extremos **incluídos** (`2026-03..2026-08` = março a
agosto). Backend: `parse_period` devolve `kind="range"`, `start` no 1º dia do primeiro mês,
`end` exclusivo no 1º dia depois do último, `chart` com todos os meses e `months_in_period`
igual à contagem. É recusado (422) se o fim vem antes do início, se algum ano sai de
1900–2200 ou se passa de **120 meses**. Intervalo não tem variação contra o mês anterior
(`*_change_pct` fica `null`, como nas janelas e no ano). Vale para `GET /dashboard/summary`,
`/reports/overview` e `/transactions`. *Descartado:* dois parâmetros (`from`/`to`) — mudaria a
assinatura de três rotas e a URL da tela, e a chave única já é o que o resto do filtro usa.
Frontend: o popup do `PeriodFilter` ganha **Mês | Intervalo** (dois toques, em qualquer
ordem) e os atalhos 3M/6M/1A/Tudo passam para o rodapé do popup; a tela fica só com o botão
do período. Prova: `tests/test_period_filter.py` (backend) e `lib/period-range.test.ts`.
