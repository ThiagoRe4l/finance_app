# 🚀 Contexto e Diretrizes do Projeto: Finance App

Monorepo de controle financeiro pessoal composto por um backend em FastAPI e um frontend em React + Vite.

---

## 🛠️ Arquitetura e Pilha Tecnológica

### 🐍 Backend (`/backend` ou `/workspace/backend`)
* **Framework:** Python 3 + FastAPI
* **Servidor Web:** Uvicorn
* **Modelos e Schemas:** SQLAlchemy + Pydantic
* **Testes Automatizados:** Pytest
* **Módulos Principais (`app/routers/`):**
  * `accounts.py`: Gestão de contas bancárias e saldos.
  * `transactions.py`: Entradas, saídas e movimentações.
  * `investments.py`: Histórico e acompanhamento de investimentos.
  * `categories.py`: Classificação de receitas/despesas.
  * `installments.py`: Compras parceladas.
  * `dashboard.py`: Resumo, métricas e fluxo de caixa.
  * `reports.py`: Relatórios e análises consolidadas.
* **Suíte de testes (`tests/`):** `test_accounts.py`, `test_investments.py`,
  `test_transactions.py`, `test_dashboard.py`, `test_categories.py`, `test_installments.py`,
  `test_category_fk.py`, `test_fk_cascade.py`, `test_transactions_write.py`,
  `test_categories_write.py`, `test_installments_write.py`, `test_dashboard_installments.py`,
  `test_money_precision.py`.
  * **`*_write.py` cobrem PATCH/DELETE (dias 4.1 e 4.2).** Todo teste que espera 404 assere também
    o `detail`: enquanto a rota não existia, o FastAPI devolvia 404 `"Not Found"` e a
    asserção de status sozinha ficava verde contra um endpoint ausente.
  * **`test_fk_cascade.py` testa schema, não ORM.** Os deletes são em SQL cru de propósito:
    `Account.transactions` tem `cascade="all, delete-orphan"`, então um `session.delete()`
    apaga as filhas pelo ORM e o teste ficaria verde com o PRAGMA desligado. Verificado: com
    `enable_sqlite_foreign_keys` neutralizada, 6 dos 7 testes ficam vermelhos.
  * **`conftest.py` centraliza as fixtures.** `client`/`session` (SQLite em memória,
    `StaticPool`) e os helpers `create_category`/`create_account`/`create_transaction`.
    `test_accounts.py` e `test_investments.py` ainda carregam cópia local do setup — migrar
    quando forem tocados.
  * **`fk_session`/`fk_client`** são as fixtures com enforcement de FK ligado. O listener vem
    de `app.database.enable_sqlite_foreign_keys`, não de um workaround no teste — ligar o
    PRAGMA só do lado do teste deixaria a suíte verde com a aplicação sem enforcement.
  * **`test_dashboard_installments.py` (dia 4.3)** cobre `active_installments_count` e
    `monthly_committed_amount`, que não tinham teste nenhum — `test_dashboard.py` nunca
    exercitou parcelamento. 6 dos 13 são regressão e já passavam antes da mudança;
    estão rotulados com ✅ no docstring para não serem contados como cobertura nova.
  * **`test_money_precision.py` (08/08/2026)** cobre o contrato de dinheiro como `Decimal`:
    os 4 fallbacks `or 0.0`/`coalesce` forçados em tabela vazia (cenário que nenhum teste
    exercitava — os outros arquivos sempre criam conta e transação antes), a escala de 2
    casas, e os casos de precisão (0,10 + 0,20; 100× R$ 0,01; 20 PATCHes seguidos).
  * **`money()` no `conftest.py`** é o helper de asserção monetária: converte para `Decimal`
    **e assere que o campo veio como string JSON**. A checagem de tipo é o que dá valor a
    ele — sem ela o teste passaria por acidente, porque `Decimal(342.5) == Decimal("342.50")`
    é `True` (compara por valor, ignora escala).
  * ⚠️ **`reports.py` não tem arquivo de teste próprio.** Sua única rota é coberta por
    `test_reports_overview_smoke` (`test_dashboard.py`, regressão de acoplamento com
    `get_dashboard_summary`) e por `test_reports_top_categories_grouped_by_foreign_key`
    (`test_category_fk.py`).

### 🎨 Frontend (`/frontend`)
* **Framework:** React + Vite + TypeScript — **TanStack Start com SSR**, não SPA estático
* **Roteamento:** TanStack Router (`src/routes/`)
* **Estilização e Componentes:** Tailwind CSS + Shadcn/UI (`src/components/ui/`) + Recharts
* **Comunicação com API:** Axios/Fetch centralizado em `src/lib/api.ts`
* **Build:** `@lovable.dev/vite-tanstack-config` (v1.8.0) embute `tanstackStart` + **Nitro**.
  ⚠️ O preset default do Nitro é `cloudflare-module` — sem fixar `node-server`, `npm run
  build` produz um Cloudflare Worker, não uma pasta servível. Ver "🚢 Deploy → D-Deploy-1".
  ⚠️ O comentário no topo do `vite.config.ts` descreve a **API antiga** do preset (fala em
  `cloudflare`, que a v1.8 migrou para `nitro`) — desorienta em vez de orientar.

---

## 🧰 Comandos de Execução e Desenvolvimento

> ## 🚦 Qual comando usar — leia antes de subir qualquer coisa
>
> **Para acessar a API do browser (Windows/host): só `docker compose up backend` serve.**
> É o único caminho que publica a porta 8000 no host.
>
> **Para rodar algo dentro do container (pytest, script, checagem rápida):** os comandos
> manuais das seções abaixo servem, e são mais rápidos.
>
> Os dois blocos coexistem de propósito, mas resolvem problemas diferentes. Confundi-los
> custou uma sessão inteira de depuração em 10/08/2026 — ver "Common Hurdles → 3".

### Via docker-compose (forma canônica)

`docker-compose.yml` na raiz formaliza os dois serviços. Não introduz nada novo — são as
mesmas portas, comandos e caminhos que antes rodavam à mão:

```bash
docker compose up                       # backend (8000) + frontend (5173)
docker compose up backend               # só a API
docker compose run --rm backend pytest  # suíte de testes
docker compose config --quiet           # valida o arquivo sem subir nada
```

Duas restrições do arquivo que não são estéticas:

* **`working_dir` do backend tem que ser `/workspace/backend`.** `app/database.py` tem
  `DATABASE_DIR = "/workspace/backend"` hardcoded; montar em outro caminho cria o SQLite
  fora do bind mount e os dados somem no `down`.
* **A porta 8000 tem que ser publicada no host.** Quem chama a API é o browser, usando o
  `http://localhost:8000/api` hardcoded em `src/lib/api.ts` — não é comunicação
  container→container. O `depends_on` serve para ordem de subida, não para roteamento.

> Não há Dockerfile: os serviços rodam sobre imagens oficiais (`python:3.12-slim`,
> `node:22-slim`) e instalam dependências na subida. Só vale extrair um Dockerfile se
> aparecer passo de build próprio (compilar extensão nativa, etc.).

### Backend — comandos manuais (**só dentro do container**)

```bash
cd /workspace/backend

# Suíte de testes (OBRIGATÓRIO MANTER VERDE) — este é o uso legítimo daqui.
.venv/bin/pytest

# Servidor de desenvolvimento. ⚠️ NÃO torna a API acessível do host — ver abaixo.
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0
```

> ⚠️ **`--host 0.0.0.0` não publica a porta.** Ele faz o uvicorn escutar em todas as
> interfaces **de dentro** do container — necessário, mas só metade. Publicar a porta no
> host é decidido na **criação** do container (`-p 8000:8000`), e não há como adicionar
> isso a um container já em execução.
>
> Rodar este comando num container sem o mapeamento dá um servidor que responde
> normalmente por dentro (`curl localhost:8000` local devolve 200) e é **invisível do
> Windows** — `curl` do host falha com *exit 7, failed to connect*. O sintoma não parece
> de rede: parece bug de CORS ou de frontend.
>
> **Para acessar do browser, use `docker compose up backend`.** Só ele cria o container
> com `ports: - "8000:8000"`.

### Frontend (`/frontend`)
```bash
cd /workspace/frontend

npm run dev      # servidor de desenvolvimento (Vite, --host)
npm run build    # build de produção
npm run test     # testes unitários (runner nativo do Node)
npm run lint     # ESLint
npm run format   # Prettier
```

### ⚠️ Testes do frontend: runner nativo do Node, **não** Vitest

**Decidido em 10/08/2026.** `npm run test` roda
`node --experimental-strip-types --test`, sem dependência nova.

**Vitest não roda neste container.** O `node_modules` foi instalado pelo Windows — há
`@esbuild/win32-x64/esbuild.exe` e só binários `rollup-win32-*`. O esbuild recusa
explicitamente executar em outra plataforma, e o Vitest depende do pipeline do Vite.
Reinstalar a partir do Linux trocaria esses binários e quebraria o `npm run dev` do host,
porque `/workspace` é o mesmo `C:\` — é a mesma debt de bind mount registrada em
"Ambiente de Execução". `docker compose` resolveria (mantém `node_modules` em volume
nomeado), mas o Docker não está disponível **dentro** do container onde o agente roda.

Consequências práticas:

* **Só função pura tem teste.** Componente React continua sem cobertura — mesmo estado de
  antes, agora com o motivo registrado.
* **Import relativo em código testado precisa de extensão explícita** (`./money.ts`). O
  resolver ESM do Node não a infere; o Vite resolve das duas formas e
  `allowImportingTsExtensions` já está ligado no `tsconfig.json`.
* `npm run test` sem argumento: o runner descobre `*.test.ts` recursivamente e já ignora
  `node_modules`. Sem glob no comando, funciona igual em `cmd`, PowerShell e `sh`.

> 🔓 **Decisão em aberto:** quando aparecer a primeira necessidade real de teste de
> componente, decidir entre rodar Vitest no Windows (aceitando quebrar o ciclo
> teste-vermelho-primeiro só nesse caso) ou investigar como viabilizá-lo no container.

⚠️ **Primeiro caso concreto, não hipotético (13/08/2026).** Na validação visual do
Dashboard, "Despesas +325,8%" exibia seta **↘**. O `MetricCard` decidia o ícone a partir de
`tone`, que codifica *bom/ruim* e não *subiu/desceu* — e Despesas é o único card em que os
dois divergem, porque gasto subindo é ruim. O mock nunca expôs isso: trazia despesa em queda
(`-7.1%`) marcada como negativa, onde "para baixo" e "ruim" coincidiam por acidente do dado
fictício.

A correção extraiu `trendFromDelta` (função pura, coberta pelo runner atual) e separou as
duas props. Mas **o bug nasceu na ligação das props em JSX**, que é exatamente onde a
cobertura de hoje não alcança: `trendFromDelta` e `formatDelta` estavam certos isoladamente;
errado era o `tone={...}` do `index.tsx`. Nenhum teste possível hoje pegaria isso.

Ou seja: o argumento para Vitest deixou de ser "um dia vamos precisar" e passou a ter um
defeito real que chegou à tela. Continua sem decisão — mas quem for decidir tem agora um
caso, não uma hipótese.

---

## 🧱 Ambiente de Execução e Isolamento

**O que é de fato isolado.** O processo roda em container Docker — verificado por
`/.dockerenv`, raiz em `overlay` (containerd) e `/sys` + `/proc/sys` montados read-only.
Dependências (`.venv`, `node_modules`) ficam confinadas e não poluem o sistema hospedeiro.
Nessa parte, o princípio "Ambiente Confinado (AI Jail)" do `GEMINI.md` está atendido.

### ⚠️ Debt conhecida: o filesystem do projeto **não** é isolado

`/workspace` é um bind mount 9p/drvfs vindo do Windows do host:

```
C:\ on /workspace type 9p (rw,noatime,aname=drvfs;path=C:\;...)
```

Todo write em `/workspace` — inclusive `database.db` — vai **direto para o disco do host**.
O confinamento é de **runtime e dependências**, não de filesystem.

O que isso implica na prática:

* **Comando destrutivo em `/workspace` é irreversível.** Um `rm -rf` equivocado dentro do
  container apaga arquivo do host; destruir o container não desfaz nada.
* **I/O via 9p é lento.** Relevante para `node_modules` e para a coleta do pytest.
* **Permissões Unix são sintéticas** (tudo `root`, `uid=0/gid=0` no mount) — não confie em
  bits de permissão como proteção.

**Mitigação parcial já em vigor:** o `docker-compose.yml` mantém `venv` e `node_modules` em
volumes nomeados (`backend-venv`, `frontend-node-modules`), fora do bind mount. Isso resolve
performance e conflito host↔container, **não** a exposição do código e do banco.

**Correção de verdade fica fora de escopo por ora:** exigiria mover o projeto para um volume
nomeado ou para o filesystem nativo do WSL2. Enquanto não acontecer, esta seção é o registro
consciente da limitação — não trate o container como sandbox para operações destrutivas.

---

## 📁 Estrutura de Diretórios (Frontend)

```
frontend/src/
├── routes/              # Rotas TanStack Router (file-based) — 6 arquivos
│   ├── __root.tsx       # Layout raiz
│   ├── index.tsx        # Dashboard / Visão Geral
│   ├── transacoes.tsx
│   ├── categorias.tsx
│   ├── parcelamentos.tsx
│   └── relatorios.tsx
├── components/
│   ├── dashboard/       # Componentes de domínio — 6 arquivos
│   │   ├── CashFlow.tsx       # Fluxo mensal (contém mock)
│   │   ├── CategoryBars.tsx   # Distribuição de gastos (contém mock)
│   │   ├── Transactions.tsx   # Transações recentes (contém mock)
│   │   ├── MetricCard.tsx     # Apresentacional (recebe props)
│   │   ├── PageHeader.tsx     # Apresentacional (recebe props)
│   │   └── Sidebar.tsx        # Navegação (array = config de rotas, não mock)
│   └── ui/              # Shadcn/UI — 46 arquivos, não editar à mão
├── lib/
│   ├── api.ts           # Cliente HTTP centralizado
│   └── utils.ts         # Helper `cn` (clsx + tailwind-merge)
├── hooks/
│   └── use-mobile.tsx
├── router.tsx           # Configuração do router
├── routeTree.gen.ts     # GERADO automaticamente — nunca editar
└── styles.css
```

**Onde ficam os mocks:** não existe pasta `mocks/` nem fixtures centralizadas. Os dados
mockados estão **inline**, como arrays `const` no topo de cada arquivo — nas rotas
(`transacoes.tsx`, `categorias.tsx`, `parcelamentos.tsx`, `relatorios.tsx`), nos componentes
de dashboard (`CashFlow`, `CategoryBars`, `Transactions`) e como valores literais no JSX de
`index.tsx`. Ao integrar uma tela, o mock a ser removido está no próprio arquivo.

> ⚠️ `src/components/ui/sidebar (1).tsx` tem nome com espaço e sufixo de duplicata — é um
> artefato da geração inicial. Confira se algo importa esse arquivo antes de mexer nele.

---

## 🔌 Status da Integração Frontend ↔ Backend

> **Manter esta seção atualizada conforme a integração avançar tela por tela.**

**Estado atual: as 5 telas integradas em leitura.** Nenhum mock de dado sobrou nas rotas.
**Escrita ligada nas três telas que têm endpoint** (14/08/2026). Detalhes e decisões em
"✍️ Escrita pela UI" abaixo.

| Tela | Criar | Editar | Excluir | Ação própria |
|---|---|---|---|---|
| `categorias.tsx` | ✅ | ✅ | ✅ (409 em uso) | — |
| `transacoes.tsx` | ✅ | ✅ | ✅ (estorna saldo) | busca client-side |
| `parcelamentos.tsx` | ✅ | ✅ (409 inline) | ❌ sem endpoint | avançar parcela |

**Não sobrou botão inerte.** Os três que existiam foram **removidos**: "Filtrar" em
Transações, "Buscar" no Dashboard e "Exportar" em Relatórios. Nenhum dos três tinha
endpoint, e botão que não faz nada promete recurso inexistente. Nos dois primeiros havia
agravante — a busca client-side de Transações já cobre descrição e categoria, e o Dashboard
já lista as transações recentes —, então o botão inerte ficava ao lado da coisa que
funciona.

Exportar relatório continua sem existir. Se voltar, é fatia de backend com endpoint próprio,
não um botão religado.

| Tela / Rota | Endpoint(s) | Status |
|---|---|---|
| `index.tsx` (Dashboard) | `GET /dashboard/summary` | ✅ leitura |
| `transacoes.tsx` | `GET /transactions/` | ✅ leitura |
| `categorias.tsx` | `GET /categories/` | ✅ leitura |
| `parcelamentos.tsx` | `GET /installments/` + `/installments/summary` | ✅ leitura |
| `relatorios.tsx` | `GET /reports/overview` + `/installments/summary` | ✅ leitura |

**Nenhuma soma monetária sobrou no front.** O último `reduce` sobre valores da API saiu com
a tela de Relatórios. Todo total exibido vem pronto do servidor — foi a resposta prática
para a restrição do float registrada em "Dinheiro é `Decimal`".

**Funções puras compartilhadas** (`src/lib/`, todas com teste no runner nativo do Node):

| Módulo | Responsabilidade |
|---|---|
| `money.ts` | `parseMoney`/`formatBRL` — ponto único de conversão |
| `date.ts` | `formatShortDate` — parse manual, `new Date(ISO)` erra o dia em fuso negativo |
| `transactions.ts` | rótulo Fixa/Variável/Parcelada/Receita + `signedAmount` |
| `dashboard.ts` | `formatDelta`, `trendFromDelta`, `toDistribution` |
| `categories.ts` | `categoryProgress` — percentual real × largura clampada |
| `category-icons.ts` | `icon_name` → componente lucide, com fallback |
| `installments.ts` | `installmentProgress` — pagas = `current - 1` |
| `reports.ts` | `buildReportInsights` — decide o que exibir, e se exibe |

> 🚧 **Dinheiro chega como string.** Ver "Design Patterns → Dinheiro é `Decimal`". Os mocks
> assumem `number`; a conversão está centralizada em `src/lib/money.ts` (`parseMoney` /
> `formatBRL`), que substitui as 5 cópias de `formatBRL`/`formatCurrency` que existiam
> espalhadas pelas rotas.

> ⚠️ **Converter string→`number` no front reintroduz o float que o backend eliminou.**
> `number` é IEEE 754, igual ao `float` que saiu do banco — `parseMoney("0.10") +
> parseMoney("0.20")` dá `0.30000000000000004`. Há um teste em `money.test.ts` que fixa
> isso, rotulado como limitação deliberada.
>
> Aceitável para **exibir**, que é todo o uso da tela de Transações. **Não** é aceitável
> para **somar no cliente**, e é exatamente o que os mocks de `parcelamentos.tsx`
> (`items.reduce((s, i) => s + i.installment, 0)`) e `relatorios.tsx` fazem. A resposta
> provável quando essas telas forem integradas é **usar os totais que o dashboard já
> devolve prontos** (`monthly_committed_amount`, `total_revenues`, `total_expenses`,
> `average_savings`) em vez de somar no front. Decidir quando chegar lá — não agora.

### ✍️ Escrita pela UI — decisões do dia 6 (14/08/2026)

Os endpoints de escrita existem desde o dia 4 e nunca tiveram consumidor. Esta fase liga os
botões que estavam inertes desde a geração no Lovable. Ordem: **Categorias primeiro** — é o
formulário mais simples que cobre criar/editar/excluir inteiro e exercita o 409, virando o
molde para os outros.

**Validação com `zod` + `react-hook-form`.** Nenhuma dependência nova: `zod ^3.25`,
`react-hook-form ^7.71`, `@hookform/resolvers`, `date-fns`, `react-day-picker` e os
componentes `form`/`dialog`/`alert-dialog`/`select`/`calendar` já estavam instalados e
**nunca foram usados** — o Lovable os trouxe junto do shadcn. O schema fica em função pura,
testável no runner nativo do Node, e o componente só consome.

**`<Toaster />` montado no `__root.tsx`.** Sem ele, um POST bem-sucedido não dá sinal nenhum
ao usuário além da lista mudando.

**Parcelamento: não prever trava, tratar o 409 que vier.** O `PATCH` recusa mudança em
`installment_amount`/`total_installments`/`total_amount` quando há transação lançada, mas a
API **não expõe** se há. Em vez de adivinhar, o formulário deixa editar livre e transforma o
409 em mensagem inline nos campos citados no `detail`.

**409 de categoria em uso: mensagem genérica.** `GET /categories/` devolve `txs_count` do
**mês corrente**, não o total, então a UI não consegue dizer quantas transações bloqueiam.
Usa o `detail` que o backend já manda; campo novo na API fica para quando incomodar.

#### Parcelamentos: dois acoplamentos textuais assumidos (14/08/2026)

**`end_date` é rótulo, não data.** `String(20)` livre no backend, sem validação; o seed usa
`"Ago/2026"`. O formulário usa um seletor mês/ano e **gera** a string nesse formato.

⚠️ **O front assume `"Mmm/AAAA"` e o backend não garante.** Um parcelamento criado por outro
caminho (script, `curl`, seed futuro) pode trazer qualquer coisa em `end_date`, e o seletor
não vai conseguir preencher na edição — cai num default. As abreviações vêm da mesma lista
de `dashboard.py` (`Jan`…`Dez`), duplicada no front porque não há endpoint que a exponha.

**O 409 do `PATCH` é parseado pelo texto.** O `detail` traz os campos travados ordenados e
separados por vírgula:

```
"Parcelamento já possui transações lançadas:
 installment_amount, total_amount, total_installments não pode(m) mais ser alterado(s)."
```

A UI extrai os nomes por regex para pintar cada campo. **Reformular a frase no backend
quebra o parse em silêncio** — os campos deixam de ser destacados. Mitigação: a função de
extração tem teste próprio e devolve lista vazia quando não casa, caindo no toast genérico
com a mensagem íntegra. Aceito como acoplamento conhecido; a alternativa seria o backend
devolver os campos em lista estruturada, que é mudança de contrato sem consumidor pedindo.

**`total_amount` é derivado no formulário.** `installment_amount` e `total_installments` são
editáveis; o total é calculado e somente-leitura. Os três são redundantes e o backend **não
valida coerência** — nada impede "12 × R$ 500" com total de R$ 9.000, e a tela calcula
"Saldo a pagar" a partir dos dois primeiros, então a incoerência apareceria direto na UI.

A multiplicação usa **centavos inteiros**, não `number`: `450.00 × 12` em ponto flutuante é
o mesmo risco que o backend eliminou com `Decimal`.

**Avançar parcela é botão dedicado no card**, não campo do formulário. É a ação mais
frequente da tela (uma vez por mês, por parcelamento), e a única que **nunca** dá 409 —
`current_installment` não está na lista travada. Some quando o parcelamento está quitado.

#### 🚧 Debt: `account_id` sem seletor

`POST /transactions` e `POST /installments` exigem `account_id`, mas **não existe tela de
contas** — a `Sidebar` tem 5 itens e nenhum aponta para elas, e só há `POST`/`GET
/accounts`, sem edição nem exclusão.

Decidido: **os formulários usam a primeira conta de `GET /accounts`**, sem seletor. Funciona
hoje porque o seed cria exatamente uma ("Conta Principal").

⚠️ **Quebra silenciosamente com duas contas** — os lançamentos iriam todos para a primeira,
sem o usuário perceber. O gatilho para resolver é a criação da segunda conta, não uma data.
Resolver significa: tela de contas, seletor no formulário, e provavelmente `PATCH`/`DELETE`
de conta (hoje inexistentes).

#### ⬜ Fatia futura: `DELETE /api/installments/{id}`

**Não existe.** Verificado no `openapi.json`: parcelamentos têm `POST`, `GET`, `PATCH` e
`/summary`. O dia 4 entregou só o `PATCH`, conscientemente.

Fora do escopo da fase de escrita. Quando entrar, a decisão pendente é o destino das
transações vinculadas: o `SET NULL` do `installment_id` já está testado **no banco**
(`test_fk_cascade.py`), mas nunca virou contrato de API — e a tela precisaria dizer ao
usuário que os lançamentos sobrevivem sem o vínculo.

#### ⬜ Dívida conhecida: sem paginação

"Buscar" e "Filtrar" em Transações são **client-side**, sobre o array já carregado — a API
não precisa mudar. Mas `GET /transactions/` devolve tudo, sem `limit`/`offset` em lugar
nenhum da API. Com centenas de lançamentos a tela carrega todos a cada visita. Não é
problema hoje; é o gatilho para paginação depois.

### 🎭 Os mocks são cenografia do Lovable, não especificação

**Registrado em 10/08/2026, ao mapear o Dashboard.** As telas nasceram no Lovable, a partir
de um design com **dados fictícios e estáticos**, sem lastro em cálculo nenhum. Isso não é
detalhe histórico: é a lente correta para mapear as telas que faltam.

Dois achados concretos do Dashboard mostram o padrão:

* **`CategoryBars.percent` é internamente inconsistente.** Testadas as duas fórmulas
  plausíveis: sobre o total de despesas, "Moradia" (67%) e "Alimentação" (40%) batem, mas
  "Transporte" daria 15% e o mock diz 25. Sobre o orçamento não bate nenhum. Não existe
  fórmula a recuperar — os números foram escolhidos porque ficam bem no gráfico.
* **O bloco "Fixas vs Variáveis"** (`R$ 2.205,90 / 71%` vs `R$ 914,60 / 29%`) não tem
  origem em dado nenhum, nem no front nem na API.

> **Regra ao mapear as próximas telas — `relatorios.tsx` principalmente:** número "bonito"
> que não fecha com uma fórmula clara é **decorativo**, não feature perdida. Não trate como
> spec que o backend esqueceu de implementar, e não tente adivinhar a intenção original —
> ela não existe. Manter, remover ou formalizar como dado real é decisão nossa, tomada
> agora, e vai no registro como qualquer outra.

`relatorios.tsx` é o caso mais exposto: tem 4 "Insights" em texto corrido
(`"Sua economia cresceu +18%"`, `"Despesas fixas representam 71%"`) que são exatamente esse
tipo de número.

**Derivação de rótulo é do front, e vive num lugar só.** `src/lib/transactions.ts` expõe
`deriveTransactionLabel` e `signedAmount`. A API devolve dados crus (`type`, `is_fixed`,
`installment`) e não duplica apresentação; antes disso a mesma regra existia em duas
versões divergentes — `routes/transacoes.tsx` com a grafia final e
`components/dashboard/Transactions.tsx` com slug minúsculo sem acento e uma tabela
`typeLabel` própria.

Precedência decidida em 10/08/2026: **ENTRADA sempre vence**. Entrada fixa ou parcelada
colapsa para "Receita" **sem meta** — exibir "Receita 2/12" sugeriria parcela a pagar, o
oposto do que uma entrada é. Aceito como v1.

⚠️ **Barra final: casa com o padrão da rota declarada, não "sempre use barra".** O
FastAPI responde **307** quando o caminho não bate exatamente, e cada redirect custa um
round-trip:

| Rota no router | Chamada correta | A errada |
|---|---|---|
| `@router.get("/")` (coleção) | `/transactions/`, `/categories/`, `/installments/` | sem barra → 307 |
| `@router.get("/summary")` | `/dashboard/summary` | **com** barra → 307 |

A suíte do backend não pega isso: o `TestClient` segue redirect em silêncio.

**Cliente HTTP:** `lib/api.ts` expõe `get`, `post`, `patch` e `delete`. **Não há `put` e não
deve haver** — ver a decisão em "Operações de escrita". `apiFetch` trata **204 sem corpo**
(`return undefined as T`); sem isso o `.json()` incondicional rejeitava a promise em toda
exclusão bem-sucedida. `api.delete` devolve `Promise<void>`, não `Promise<T>`.

**Dia 4.1 — operações de escrita (decidido e implementado em 07/08/2026).** O contrato está
em "🧩 Design Patterns → Operações de escrita".

| Endpoint | Fatia | Status |
|---|---|---|
| `PATCH /api/transactions/{id}` | 4.1 | ✅ implementado |
| `DELETE /api/transactions/{id}` | 4.1 | ✅ implementado (204) |
| `PATCH /api/categories/{id}` | 4.1 | ✅ implementado |
| `DELETE /api/categories/{id}` | 4.1 | ✅ implementado (204 / 409 em uso) |
| `PATCH /api/installments/{id}` | 4.2 | ✅ implementado |
| Agregações do dashboard ignorarem quitados | 4.3 | ✅ implementado |

⚠️ **Nenhuma tela tem afordância de edição ou exclusão hoje** — verificado por busca: não há
um `onClick` sequer em `routes/` ou `components/dashboard/`, e os botões existentes ("Nova",
"Filtrar", "Exportar") são inertes. Estes endpoints são backend pronto **antes** da UI, não
resposta a uma tela que já pede. Não existe tela de contas nem de investimentos — a
`Sidebar` tem 5 itens e nenhum aponta para elas.

---

## 🔐 Variáveis de Ambiente

**Decidido e implementado em 23/08/2026.** Os três pontos que eram hardcoded
(`database.py`, `main.py`, `api.ts`) passam a ler do ambiente.

⬜ **O que ainda não existe é o deploy em si** — nenhum serviço foi criado no Railway, e os
Dockerfiles e o workflow do CI nunca rodaram de verdade (Docker não existe no container do
agente e `vite build` não roda nele). Esta seção descreve código que está no repositório; a
configuração do lado do Railway continua pendente.

Até aqui o projeto não usava variável de ambiente nenhuma — verificado, não presumido: sem
`.env`/`.env.example`, sem `os.environ`/`BaseSettings` no backend, e no frontend só o
`import.meta.env.DEV` built-in do Vite (`src/router.tsx:30`). O deploy no Railway é o
primeiro consumidor real.

| Variável | Onde entra | Serviço | Momento | Default |
|---|---|---|---|---|
| `DATABASE_URL` | `backend/app/database.py` | backend | runtime | `sqlite:////workspace/backend/database.db` |
| `CORS_ALLOW_ORIGINS` | `backend/app/main.py` | backend | runtime | `*` |
| `PORT` | injetada pelo Railway | ambos | runtime | `8000` / `5173` |
| `VITE_API_BASE_URL` | `frontend/src/lib/api.ts` | frontend | **build** | `http://localhost:8000/api` |

**Toda variável tem default igual ao valor de hoje.** Não é conveniência: sem isso,
`pytest` e `docker compose up` passariam a exigir `.env` para funcionar, e a regra "suíte
verde é obrigatória" ficaria dependente de config de ambiente.

⚠️ **`DATABASE_URL` absoluto leva QUATRO barras** — `sqlite:////data/database.db`. Com três
o SQLAlchemy interpreta como caminho relativo e o banco nasce fora do volume, que é
exatamente o erro que só aparece no primeiro redeploy, quando o dado some.

⚠️ **`VITE_API_BASE_URL` é resolvida em BUILD, não em runtime.** O preset da Lovable faz
`loadEnv(mode, cwd, "VITE_")` e injeta via `define:` — o valor fica **inlinado no bundle**.
Trocar o domínio do backend e reiniciar o serviço **não** tem efeito: é preciso rebuildar o
frontend. Vale para qualquer `VITE_*` que venha a existir.

### Carregamento de `.env.local` (decidido em 28/08/2026)

Até aqui **nada no projeto lia arquivo de ambiente** — `settings.py` lê só `os.environ`. O
`.env.example` descrevia um fluxo que o código não implementava, e isso só apareceu ao
aplicar o schema no Neon: os comandos documentados rodariam contra o SQLite local e
**relatariam sucesso**.

`python-dotenv` entra em **`requirements-dev.txt`**, não em produção: na Vercel as variáveis
são injetadas pela plataforma, e carregar arquivo lá seria peso morto. Por isso o
carregamento é **duplamente condicional** — ao arquivo existir **e** à biblioteca estar
instalada. Em produção o import falha e a função é no-op silencioso.

**O arquivo é `backend/.env.local`**, não na raiz: é onde o backend roda e onde
`settings.py` procura. O arquivo estava na raiz e era ignorado por completo.

⚠️ **`override=False`: variável real de ambiente sempre vence o arquivo.** O contrário faria
um `.env.local` esquecido na máquina sobrescrever a configuração de produção, que é o pior
modo de falha possível para este arquivo.

🔴 **O risco que esta decisão cria, e o guard contra ele.** `.env.local` guarda a URL do
**Neon de produção**. Com carregamento automático, qualquer coisa rodada localmente passa a
apontar para produção por default — inclusive `pytest`, porque `app/database.py` cria o
engine no import.

A suíte está insulada por `TEST_DATABASE_URL` (default `sqlite://`), que é variável
**separada** de `DATABASE_URL` exatamente por isso. Há teste travando o invariante: o engine
da suíte continua SQLite mesmo com `.env.local` presente. Sem ele, a proteção seria
coincidência de nomes.

✅ **O esquema é normalizado automaticamente** (decidido e implementado em 28/08/2026).
`resolve_database_url` passa por `normalize_database_url`, que preenche o driver quando ele
está ausente: `postgresql://` e `postgres://` viram `postgresql+psycopg://` (D-Vercel-2).
Connection string colada direto do painel do Neon funciona sem correção manual — verificado
com o arquivo no formato cru.

Sem isso, o esquema nu resolvia para o dialeto do **psycopg2**, que não está instalado, e a
falha era `ModuleNotFoundError: No module named 'psycopg2'` — que não diz nada sobre a causa
real.

⚠️ **A normalização só preenche o que falta.** URL com driver explícito passa intacta,
inclusive `postgresql+psycopg2://` e `postgresql+asyncpg://`: reescrevê-las seria trocar em
silêncio a escolha de quem as escreveu. Há teste para cada caso.

**A resolução das três vive em função pura**, não espalhada pelo módulo:
`app/settings.py` no backend (`resolve_database_url`, `resolve_cors_origins`) e
`src/lib/config.ts` no front (`resolveApiBaseUrl`). Mesmo motivo de `periods.py` e
`money.ts`: config lida direto de `os.environ` no meio do módulo não tem como ser testada
sem `importlib.reload`, e o engine do SQLAlchemy é criado no import.

> `.env` e `.env.local` já estão no `.gitignore`. O `.env.example` versionado carrega os
> **nomes** das chaves, nunca valores ou segredos.

---

## 🚢 Deploy — Vercel + Neon (Postgres)

**Seis decisões registradas em 28/08/2026, antes da implementação.** Substituem o alvo
Railway/SQLite. Frontend e backend na Vercel, banco no Neon (Postgres gerenciado, free
tier).

**O que motiva o pivô, e o que ele resolve de graça.** Dois itens que estavam registrados
como risco e como compromisso conhecido saem de cena juntos:

* 🔴 **A pendência de backup da D-Deploy-2 deixa de existir.** Era o risco nº 1 do deploy
  anterior — arquivo SQLite único, num volume sem backup automático, guardando dado
  financeiro real. Postgres gerenciado traz backup/restore do provedor. A pendência
  "resolver antes do primeiro lançamento com dado real" fica **fechada por construção**.
* **`Numeric(12,2)` passa a ser exato.** A seção "Dinheiro é `Decimal`" registra que sob
  SQLite não há armazenamento exato — `NUMERIC` é só afinidade e o valor vai a disco como
  REAL —, e que exatidão real exigiria centavos como `Integer`, descartado por contaminar
  toda a API. O Postgres entrega sem esse custo.

### D-Vercel-1: SQLite local, Postgres em produção — e um job de Postgres no CI

Três opções foram pesadas: (A) SQLite local; (B) Postgres em tudo; (C) SQLite local **mais**
um job de CI rodando a suíte contra Postgres. Escolhida a **C**.

**Por que não a B.** Postgres em todo lugar elimina a divergência, mas exige serviço de
banco no `docker-compose.yml` e `conftest.py` reescrito para banco real com rollback por
transação — e, decisivo, **tornaria a suíte não-executável no container do agente**, que
não tem Docker nem acesso ao socket (registrado nos Common Hurdles). O fluxo inteiro deste
projeto — teste vermelho antes, implementação até o verde — depende de a suíte rodar aqui.

**Por que não a A pura.** A divergência de dialeto é real e tem candidatos concretos, não
hipotéticos:

| Divergência | Onde morde |
|---|---|
| **`GROUP BY` estrito** | ⚠️ Ver a ressalva abaixo — **não** é o risco que o mapeamento supôs |
| `LIKE` case-sensitive | prospectivo — não há `LIKE` na API hoje (busca é client-side), mas busca server-side é o próximo passo natural da dívida de paginação |
| Tipagem frouxa | SQLite aceita string em coluna numérica; Postgres recusa |
| Enforcement de FK | opcional no SQLite (via listener), sempre ligado no Postgres |

A opção C paga o custo de um job de CI e cobre exatamente esses casos.

⚠️ **Correção de uma afirmação do mapeamento (28/08/2026).** O mapeamento marcou o `GROUP BY`
como "candidato mais concreto a quebrar só em produção". **Não é.** Verificado compilando a
query para o dialeto Postgres: `accounts_with_balance` e `_aggregated_rows` agrupam por
`Account.id` e `Category.id`, que são as **chaves primárias**. O Postgres tem regra explícita
de dependência funcional — agrupando pela PK, é válido selecionar qualquer coluna daquela
tabela. As duas queries são legais como estão.

O risco real é outro e é **prospectivo**: se alguém trocar o agrupamento para uma coluna que
não seja PK, o SQLite continua aceitando e o Postgres passa a recusar. É esse invariante que
o teste trava — "agrupa por chave primária" —, não a query de hoje.



### D-Vercel-2: Neon, não Supabase

O fator decisivo não é preço nem recurso — é **comportamento do free tier em inatividade**.
O Supabase **pausa** projetos inativos e exige religar à mão; o Neon **suspende e retoma
sozinho** na próxima query, ao custo de um cold start. Para um app de finanças pessoais, que
pode passar duas semanas sem ser aberto, pausa manual é atrito recorrente no pior momento.

**Driver: `psycopg` (v3)**, não `psycopg2-binary`, que é legado. URL:
`postgresql+psycopg://...`.

### ⚠️ Pool de conexão: a string com pooler é necessária, não suficiente

`database.py` cria o engine **no import**, e cada instância serverless importa o módulo. N
instâncias simultâneas = N pools segurando conexões ociosas, e o free tier estoura rápido.
Três camadas, e a terceira é a que morde:

| Camada | Configuração |
|---|---|
| Endpoint | usar o **pooler** do Neon (host com `-pooler`), não o direto |
| SQLAlchemy | `poolclass=NullPool` — abre e fecha por request. Sem isso, dois pools empilhados |
| psycopg | 🔴 **`prepare_threshold=None`** em `connect_args` |

O psycopg3 promove queries a *prepared statements* depois de algumas execuções. O pooler em
**transaction mode** não garante a mesma sessão entre execuções, e a query falha com
`prepared statement "_pg3_0" does not exist` — **intermitente, só sob concorrência, e só
depois de algumas chamadas**. Nenhum teste pega isso: não aparece em execução sequencial nem
em conexão direta. É a razão de estar escrito aqui antes de ser descoberto.

### D-Vercel-3: dois projetos Vercel, com rewrite `/api` — CORS deixa de existir

A Vercel usa a saída do framework quando ela existe, e o frontend Nitro emite
`.vercel/output` (Build Output API v3). Isso não compõe bem com funções Python `api/*.py`
no mesmo projeto, então são **dois projetos** no mesmo repositório — mas o projeto do
frontend declara um **rewrite** de `/api/:path*` para o domínio do backend.

Dois problemas caros somem de uma vez:

* **CORS deixa de ser configuração.** O browser fala com uma origem só. A D-Deploy-6 (origem
  restrita, `allow_credentials=False`) vira desnecessária.
* **`VITE_API_BASE_URL` passa a ser `/api`, relativa.** Some o ovo-e-galinha dos domínios e
  some o problema de a variável ser inlinada em build — que era a armadilha mais registrada
  do plano anterior.

Custo: um hop a mais por request, e o **307 de barra final atravessando o rewrite** merece
verificação própria. O 307 não desapareceu com o uvicorn; só mudou de proxy.

### D-Vercel-4: o listener de FK fica, condicional por dialeto

`enable_sqlite_foreign_keys` **não pode simplesmente sair**, e a razão decorre da D-Vercel-1:
com SQLite ainda no ambiente local, remover o listener faz o dev local voltar a aceitar linha
órfã em silêncio e transforma `test_fk_cascade.py` inteiro em teste de nada.

Passa a ser aplicado condicionalmente (`engine.dialect.name == "sqlite"`). No Postgres a FK
é nativa e sempre ativa; as fixtures `fk_session`/`fk_client` continuam existindo para o
SQLite e viram equivalentes a `session`/`client` no job de Postgres.

### D-Vercel-5: os Dockerfiles do Railway saem, em commit próprio

Os dois `Dockerfile` e os dois `.dockerignore` viram código morto — serverless não tem
imagem nem entrypoint. Saem num commit isolado cuja mensagem documenta o pivô, em vez de
serem mantidos "por portabilidade": arquivo que ninguém testa envelhece errado e engana
quem o encontra depois.

Some junto o que dependia de container: `os.makedirs`/`sqlite_path_from_url` em
`database.py` (não há filesystem persistente) e `init_db.py` no boot — **não há boot**. Cada
invocação é fria e isolada, o que é exatamente o que torna o Alembic pré-requisito.

### D-Vercel-6: Alembic como pré-requisito, seed como script one-off

**Alembic antes do primeiro deploy**, não depois — a D-Deploy-3 dizia "depois do deploy
verde" porque havia `create_all()` num entrypoint. Sem entrypoint, não há onde ele rodar.

Uma migration só, `initial schema` — o banco de produção não existe, não há histórico a
reconstituir. Conteúdo: as 6 tabelas, os índices e unique constraints, as colunas
`NUMERIC(12,2)`, e as **6 cláusulas `ondelete`**:

| FK | ondelete |
|---|---|
| `transactions.category_id` → `categories` | RESTRICT |
| `transactions.account_id` → `accounts` | CASCADE |
| `transactions.installment_id` → `installments` | SET NULL |
| `installments.category_id` → `categories` | RESTRICT |
| `installments.account_id` → `accounts` | CASCADE |
| `investment_history.investment_id` → `investments` | CASCADE |

⚠️ **Correção de contagem (28/08/2026):** o registro dizia "5 cláusulas ... CASCADE nos dois
de investimento". São **6**, e só existe **uma** FK de investimento — `Investment` não tem
FK nenhuma. Contado programaticamente sobre `Base.metadata`, não de leitura.

⚠️ **As cláusulas `ondelete` não são conferidas por leitura.** Elas são o coração de
`test_fk_cascade.py`; se saírem erradas, os testes ficam verdes localmente e o
comportamento diverge em produção.

Na prática o `--autogenerate` **acertou as 6** — verificado. Mas "acertou desta vez" não é
garantia, e ler o arquivo gerado não é verificação. A proteção é executável e tem duas
camadas:

1. **Local:** a suíte roda contra o schema construído pela **migration**, não por
   `create_all()`. Divergência entre migration e models aparece como teste vermelho.
2. **CI:** o job de Postgres roda `alembic upgrade head` e executa `test_fk_cascade.py`
   contra o banco real. É o único lugar onde CASCADE/RESTRICT/SET NULL são efetivamente
   exercitados pelo motor que roda em produção.

⚠️ **`accounts` não tem `current_balance`** — foi removida na fatia do saldo derivado. A
migration reflete os models de hoje, não a história.

**Seed fora da migration.** Migration é schema; misturar dado gera migration que não pode
ser reaplicada. O seed vira **script one-off com `--yes`**, rodado à mão uma vez contra o
banco de produção. `init_db.py` deixa de ser entrypoint e vira isso.

### O que o pivô invalida no que já está no repositório

| Item | Destino |
|---|---|
| `vite.config.ts` preset `node-server` | vira `vercel` (o preset existe no Nitro instalado, emite `.vercel/output`) |
| `vite-config.test.ts` | assere `node-server` — **o teste fez o trabalho dele**: a mudança de plataforma não passou silenciosa |
| Dockerfiles + `.dockerignore` | removidos (D-Vercel-5) |
| CORS em `main.py` | desnecessário com o rewrite (D-Vercel-3) |
| `sqlite_path_from_url`, `os.makedirs` | mortos em produção; ficam só no caminho SQLite local |
| `.env.example`, `settings.py`, workflow de CI | **sobrevivem**, com valores novos |

---

## 🔑 Autenticação — Google + allowlist de 4 e-mails

**Oito decisões registradas e implementadas em 02/10/2026.**

⬜ **O que falta é configuração fora do repositório:** o passo a passo do Google Cloud Console
(abaixo), as 4 variáveis nos dois projetos da Vercel, e os 4 e-mails em
`AUTH_ALLOWED_EMAILS`. Enquanto `AUTH_ALLOWED_EMAILS` estiver vazia, **ninguém entra** — é o
*fail closed* da D-Auth-2 funcionando, não um defeito.

Antes desta fatia as 7 rotas eram públicas e não existia autenticação nenhuma.

### D-Auth-1: Google Identity Services + verificação de ID token (só client ID)

O botão do Google roda no front e devolve um **ID token** (JWT assinado pelo Google). O front
manda em `POST /api/auth/google`; o backend valida assinatura contra o JWKS do Google, confere
`aud`/`iss`/`exp`/`email_verified`, checa a allowlist e emite o cookie de sessão.

**Exige apenas o client ID, que é público. Nenhum client secret em lugar nenhum.**

**Alternativa descartada: OAuth 2.0 Authorization Code (redirect completo).** É o padrão
clássico e dispensa script de terceiro no front, mas exige **client secret**, um `state`
anti-CSRF que precisaria ser persistido em cookie assinado próprio (serverless não tem
memória), cliente HTTP em produção e dois redirects. Para um app com 4 usuários que não
consome nenhuma API do Google além da identidade, é mais segredo e mais código sensível
nosso para o mesmo resultado.

Custo aceito: carrega `accounts.google.com/gsi/client` no front, a aparência do botão é
limitada, e o Google está migrando para FedCM — a API pode mudar.

### D-Auth-2: allowlist em variável de ambiente, reconferida a cada requisição

`AUTH_ALLOWED_EMAILS`, lista separada por vírgula. É exatamente a forma de
`resolve_cors_origins`, que já existe: função pura, `strip` por item, testável sem tocar o
ambiente do processo.

**Alternativas descartadas:** tabela no banco (exigiria migration, endpoint de gestão que não
existe e **uma query por requisição**, para 4 e-mails fixos); hardcoded (põe 4 e-mails
pessoais no repositório e exige commit para alterar).

⚠️ **Sem a variável, ninguém entra.** O default é lista vazia — *fail closed*. É o oposto do
padrão "todo default equivale ao comportamento de hoje" que vale para as outras variáveis, e
aqui é de propósito: allowlist ausente não pode significar allowlist aberta.

**A allowlist é reconferida em TODA requisição, não só no login.** Isso dá revogação sem
tabela de sessão: tirar um e-mail da variável corta o acesso na requisição seguinte. Foi o
argumento decisivo contra a tabela.

Normalização obrigatória, travada por teste: comparação **case-insensitive**, e o Google
precisa ter devolvido `email_verified == true`.

### D-Auth-3: cookie `httpOnly` assinado, 30 dias deslizante

Stateless, sem tabela de sessão — serverless não tem memória nem filesystem, e tabela custaria
query por requisição. Conteúdo: e-mail + instante de emissão, assinado com HMAC.

| Atributo | Valor | Por quê |
|---|---|---|
| `HttpOnly` | sim | JS não lê o cookie — tira XSS do caminho do roubo de sessão |
| `Secure` | sim em produção | |
| `SameSite` | `Lax` | Com mesma origem basta; já bloqueia POST/PATCH/DELETE cross-site |
| `Domain` | 🔴 **ausente (host-only)** | Ver a armadilha abaixo |
| `Path` | `/` | |

🔴 **O `Set-Cookie` não pode trazer `Domain`.** Sem `Domain`, o cookie cola no host que o
browser pediu — o domínio do **frontend** — e volta pelo rewrite `/api`. Com `Domain`
apontando para o domínio do backend, o browser **descarta** o cookie e o login falha sem erro
legível em lugar nenhum.

Não há revogação individual. A reconferência da allowlist (D-Auth-2) cobre o caso real
("tirar alguém"), e rotacionar `SESSION_SECRET` derruba todas as sessões de uma vez.

### D-Auth-4: `PyJWT[crypto]` faz os dois lados

Uma biblioteca para RS256 (verificar o Google) e HS256 (nossa sessão). O `PyJWKClient`
embutido usa `urllib` da stdlib, então **nenhum cliente HTTP novo entra em produção**.

**Alternativas descartadas:** `google-auth` oficial (arrasta `requests`, `rsa`, `pyasn1`,
`cachetools` — 5 pacotes onde 2 bastam); endpoint `tokeninfo` do Google (zero cripto, mas um
round-trip ao Google por login, e o Google desaconselha em produção).

⚠️ `cryptography` é wheel binário grande e pesa no cold start. Mitigado por construção: RS256
só roda **no login**; toda requisição seguinte valida um HMAC local, sem rede e sem cripto
assimétrica.

### D-Auth-5: `SESSION_SECRET` sem default em produção — quebra consciente de padrão

🔴 **Esta decisão rompe deliberadamente a regra "toda variável tem default igual ao valor de
hoje"**, registrada em "🔐 Variáveis de Ambiente". A razão é direta: **segredo com default é
segredo conhecido**, e um default commitado no repositório assinaria sessões que qualquer
pessoa com acesso ao código poderia forjar.

A regra existia para `pytest` e `docker compose up` não passarem a exigir `.env`. Isso é
preservado por um conceito único: **ambiente local é aquele cujo banco é SQLite** — que é
literalmente a D-Vercel-1. Em SQLite há default de desenvolvimento; em Postgres, a ausência
de `SESSION_SECRET` é **erro de inicialização**.

`is_local_environment(url)` é esse conceito nomeado **uma vez**, e usado também pela D-Auth-8.
Duas checagens ad-hoc de "estamos em produção?" é como as duas divergiriam depois.

### D-Auth-6: guarda de rota client-side, e ele NÃO é a proteção

**A proteção de verdade é a dependency do FastAPI.** O domínio do backend continua
publicamente alcançável — o rewrite `/api` é conveniência de origem, **não** barreira de
segurança. Quem protege é o servidor.

O gate no `__root.tsx` consulta `GET /api/auth/me`: carregando → splash; 401 → tela de login;
ok → `Outlet`. É **UX**, não segurança: evita a tela piscar quebrada.

**Alternativa descartada: guarda server-side** (`beforeLoad` lendo o cookie no servidor).
Seria mais robusto — zero flash de conteúdo —, mas passaria a usar SSR de verdade e
**encareceria a migração para SPA estático** registrada no item 0.2 dos Itens futuros. O
débito fica do tamanho que já tem.

⚠️ Consequência registrada: o gate é componente React, e **não existe teste de componente
neste projeto** (ver "Testes do frontend"). Essa parte entra sem cobertura, como todo
componente — o que a torna segura é o 401 do backend, que tem.

### D-Auth-7: proxy `/api` no dev server do Vite, com check que falha alto

Em produção o rewrite faz tudo ser mesma origem, e o default `credentials: "same-origin"` do
`fetch` manda o cookie sozinho — **`apiFetch` não muda**. Em desenvolvimento o front está numa
porta e a API em `8000`: cross-origin, o cookie não é enviado, e o login não funciona local.

Um proxy `/api` no dev server resolve mantendo a D-Vercel-3 intacta.

**Alternativa descartada:** `credentials: "include"` + `allow_credentials=True` + origem fixa.
Reabriria a D-Deploy-6, fechada justamente por isso, e deixaria produção com configuração de
CORS que ela não precisa.

🔴 **O preset da Lovable REMOVE `server.proxy`** — `cleanServerConfig` descarta `proxy`,
`headers` e `cors`. Verificado: isso só acontece quando `LOVABLE_SANDBOX=1` ou
`DEV_SERVER__PROJECT_PATH` está definido; fora do sandbox o proxy passa normalmente.

⚠️ **Isso não fica só em comentário.** Comentário não impede nada, e o modo de falha é o pior
possível: o proxy desaparece em silêncio, o cookie para de ser enviado, e o sintoma é "login
não funciona" sem nenhuma pista da causa. Há um **check no boot do dev server** que detecta a
condição e **falha alto e visível**, com a mensagem dizendo o que aconteceu e o que fazer. A
detecção é função pura, com teste.

### D-Auth-8: `/docs` e `/openapi.json` desabilitados em produção

Com a API fechada, o schema aberto descreve a superfície inteira. Não é vulnerabilidade, é
exposição de informação gratuita.

`docs_url`/`redoc_url`/`openapi_url` passam a `None` quando `is_local_environment()` é falso —
o mesmo conceito único da D-Auth-5. Localmente o `/docs` continua servindo.

O `openapi.json` **versionado** continua sendo gerado por `app.openapi()`, que não depende das
rotas de documentação — o item 3 do Checklist Pós-Implementação segue funcionando.

### Variáveis de ambiente novas

| Variável | Natureza | Projeto | Momento | Observação |
|---|---|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | pública | frontend | **build** | ⚠️ Inlinada no bundle — trocar exige **rebuild**, não restart |
| `GOOGLE_CLIENT_ID` | pública | backend | runtime | Mesmo valor da de cima; duplicada porque são dois projetos Vercel |
| `SESSION_SECRET` | 🔴 secreta | backend | runtime | Sem default em produção (D-Auth-5) |
| `AUTH_ALLOWED_EMAILS` | sensível (dado pessoal) | backend | runtime | Lista por vírgula; vazia = ninguém entra |

### Passo a passo no Google Cloud Console (executado à mão, fora do repositório)

1. Criar/selecionar projeto no console.
2. **Tela de consentimento OAuth** → tipo **External**; nome do app, e-mail de suporte e de
   contato.
3. **Escopos:** apenas `openid`, `email`, `profile`. Escopo a mais é permissão a mais a
   justificar.
4. **Usuários de teste:** os 4 e-mails. Mantendo o app em **"Testing"**, só eles entram e
   **não é preciso passar por verificação do Google** — é exatamente o que uma allowlist de 4
   quer. (App em Testing expira refresh token em 7 dias; irrelevante aqui, porque a D-Auth-1
   não usa refresh token.)
5. **Credenciais → ID do cliente OAuth → Aplicativo da Web.**
6. **Origens JavaScript autorizadas:** o domínio do frontend em produção **e** a origem de
   desenvolvimento. ⚠️ Confirmar qual é: o `docker compose` sobe o front em `5173`, mas o
   preset da Lovable tem default `8080`.
7. **URIs de redirecionamento:** vazio. A D-Auth-1 não usa redirect.
8. Copiar o **client ID** (não há client secret a copiar) e preencher as variáveis nos dois
   projetos da Vercel.
9. **Redeployar os dois.** O frontend porque `VITE_GOOGLE_CLIENT_ID` é de build; o backend
   porque a Vercel só aplica variável nova em deploy novo.

### ⚠️ Raio de impacto: 301 testes de uma vez

São **251 chamadas à API em 19 arquivos**, todas hoje sem autenticação. No instante em que a
dependency entra nos routers, a suíte inteira vira 401.

A saída é de fixture: o `client` do `conftest.py` passa a vir **autenticado por default** (via
`app.dependency_overrides`), e nasce um **`anon_client`** para os testes de 401. Os 301 testes
seguem válidos sem edição individual.

🔴 **O risco que essa escolha cria, e o que o contém.** Override largo demais deixa a suíte
verde com a aplicação real desprotegida — exatamente o falso positivo que as fixtures
`fk_session`/`fk_client` existem para evitar. O contrapeso é um **teste de enumeração de
rotas**, que percorre `app.routes` e assere que toda rota de dados exige autenticação, com
allowlist explícita de rotas públicas (`/health`, `/`, `/api/auth/*`) — e que roda **sem** o
override. É o análogo de `test_every_foreign_key_declares_ondelete`: impede que um router novo
nasça desprotegido em silêncio.

### ⚠️ Preview deployments da Vercel não vão autenticar

As origens autorizadas do Google não aceitam wildcard, e cada preview tem URL própria. Preview
funcional exigiria um domínio estável apontado para ele. Registrado antes de ser descoberto.

---

## 🗃️ Deploy — Railway (**SUPERADO em 28/08/2026**, mantido como histórico)

> 🔴 **Esta seção não descreve o alvo atual.** O projeto migrou para
> **Vercel + Neon (Postgres)** — ver "🚢 Deploy — Vercel + Neon" logo abaixo.
> Nenhum serviço chegou a ser criado no Railway, então nada aqui foi para produção.
>
> O que **sobreviveu** ao pivô e continua em vigor: D-Deploy-4 (format + lint, já
> fechada), D-Deploy-5 (`requirements` pinados) e o workflow de CI. O que **morreu**:
> os dois Dockerfiles, o volume de SQLite, a D-Deploy-6 (CORS deixa de existir com o
> rewrite `/api`) e o preset `node-server` da D-Deploy-1.
>
> Fica registrada porque as alternativas descartadas aqui — e o motivo de cada uma —
> continuam informando as decisões novas.

**Seis decisões registradas em 23/08/2026, antes da implementação.** Um projeto, dois
serviços (`backend` e `frontend`), mesmo repositório, cada um com seu *root directory* e
seus *watch paths* — sem watch paths, um ajuste de CSS redeploya a API.

### D-Deploy-1: o frontend roda em Nitro `node-server`, fixado no `vite.config.ts`

**O frontend não é um SPA estático**, e isso não estava registrado em lugar nenhum. O
`vite.config.ts` delega para `@lovable.dev/vite-tanstack-config` (v1.8.0), que embute
`tanstackStart` + **Nitro** com preset default `cloudflare-module`:

```js
const preset = userNitroOpts.preset ?? process.env.NITRO_PRESET ?? "cloudflare-module";
```

Confirmado por três sinais: não existe `index.html` na raiz do frontend, `router.tsx`
exporta `getRouter` (convenção do TanStack Start) e o preset orquestra o build por Nitro.
Ou seja, **`npm run build` hoje produz um Cloudflare Worker**, não uma pasta servível — e o
builder automático do Railway falharia de forma silenciosa, com build "verde" e serviço que
não sobe.

O preset vai **fixo no `vite.config.ts`** (`nitro: { preset: 'node-server' }`), não via
`NITRO_PRESET` no ambiente. Se a variável faltasse, o build voltaria para Cloudflare sem
erro nenhum.

**Alternativas descartadas:** deployar o frontend na Cloudflare Workers (parte o deploy em
duas plataformas, contra o pedido de um projeto só); virar SPA estático agora (mexer no modo
de renderização de um app que funciona não é trabalho de fatia de deploy).

⬜ **Débito consciente registrado junto: o SSR não traz benefício real hoje.** Não há um
`loader:` nem um `createServerFn` em nenhuma rota — todo fetch é client-side via `useQuery`,
então o SSR entrega casca HTML e nada mais. É candidato a virar SPA estático numa fatia
própria, **sem prazo** e sem gatilho definido. Ver "Itens futuros".

### D-Deploy-2: SQLite em volume — e o backup manual é pendência com gatilho

Volume do Railway montado em `/data`, `DATABASE_URL=sqlite:////data/database.db`. O
`os.makedirs(..., exist_ok=True)` que já existe em `database.py` cobre a criação do
diretório.

🔴 **O risco que decide esta seção não é precisão decimal — é backup.** A questão do
`Numeric` gravado como `REAL` já está documentada em "Dinheiro é `Decimal`" e é conhecida e
tolerada. O risco novo é outro: **volume do Railway não tem backup automático**, e o alvo é
um arquivo único guardando dado financeiro real. Perder o volume é perder tudo, sem cópia
em lugar nenhum.

> ⬜ **PENDÊNCIA COM GATILHO — resolver antes do primeiro lançamento com dado real, não
> "algum dia".** Um processo de backup manual documentado e testado (`sqlite3 .backup` para
> um arquivo baixável, com periodicidade explícita e um restore já exercitado pelo menos uma
> vez). Backup que nunca foi restaurado não é backup. O gatilho é a primeira transação real
> digitada na UI em produção — não uma data.

Outras duas restrições, para estarem escritas antes de serem descobertas:

* **Volume prende o serviço a uma réplica.** Volume anexa a um serviço e não é compartilhado
  entre instâncias — escalar horizontalmente deixa de ser possível. Irrelevante para
  finanças pessoais, mas é decisão, não acidente.
* **Redeploy troca o container e o volume sobrevive** — é justamente o que se quer.

**Alternativa descartada por ora: Postgres gerenciado.** Resolveria de graça o compromisso
do `Numeric` (tem `NUMERIC(12,2)` exato) e traria backup gerenciado junto. Foi descartada
para o **primeiro** deploy por ser o passo maior — driver novo, o listener de
`PRAGMA foreign_keys` perde o objeto, e a suíte continuaria em SQLite, criando divergência
entre teste e produção. Escolher `DATABASE_URL` como nome da variável agora é o que deixa
essa porta aberta sem custo depois.

### D-Deploy-3: Alembic depois do deploy verde, antes do primeiro dado real

Não há Alembic e `create_all()` não faz `ALTER TABLE`. **Subir para produção é criar dado
real**, e a partir daí a próxima fatia que tocar `models.py` não tem caminho de deploy sem
perder dado — o histórico deste projeto mostra que essas fatias aparecem.

Antes do primeiro deploy seria atrasar sem necessidade (banco vazio, `create_all` basta).
Muito depois é tarde. A janela é: **deploy verde → Alembic → primeiro lançamento real**, a
mesma janela do backup da D-Deploy-2.

### D-Deploy-4: `npm run format` em commit isolado, e só então lint bloqueante no CI

O `npm run lint` acusa hoje **844 erros e 7 avisos**, todos de formatação Prettier, em
arquivos que ninguém tocou. Ligar o gate assim o faria nascer vermelho, e gate que nasce
vermelho é ignorado em uma semana.

O `format` vai em **commit sozinho**, sem nenhuma mudança de comportamento junto — o diff é
enorme e é a única forma de ele ser revisável. Só depois o lint entra como passo bloqueante.

**Alternativa descartada:** lintar só arquivo alterado. É menos trabalho hoje e deixa o
débito vivo indefinidamente.

### D-Deploy-5: `requirements` separado por ambiente e com versões pinadas

Hoje `requirements.txt` mistura produção e teste (`pytest`, `httpx` ao lado de
`fastapi`/`sqlalchemy`) e **não pina nada** — tudo `>=`. Duas consequências: a imagem de
produção carrega o runner de testes, e um rebuild daqui a meses pode puxar Pydantic ou
FastAPI com breaking change e quebrar o deploy sem ninguém ter tocado no código.

Passa a `requirements.txt` (produção) + `requirements-dev.txt` (`-r requirements.txt` mais
pytest e httpx), com versões exatas nos dois. É a mesma natureza da bomba-relógio de data em
teste já registrada: passa hoje, quebra sozinho depois.

### D-Deploy-6: CORS com origem restrita e `allow_credentials=False`

Hoje é `allow_origins=["*"]` **com** `allow_credentials=True`. Essa combinação é inválida
pela especificação de CORS; o Starlette contorna refletindo a origem da requisição em vez de
mandar `*`, o que na prática significa **"aceita qualquer origem, com credenciais"**.

O `apiFetch` não manda `credentials` em nenhuma chamada, então fechar não custa nada
funcionalmente: `CORS_ALLOW_ORIGINS` com o domínio do frontend e `allow_credentials=False`.

### Ordem de subida, e o ovo-e-galinha

O frontend precisa do domínio do backend **para buildar** (D-Deploy-1 + `VITE_API_BASE_URL`);
o backend precisa do domínio do frontend para o CORS (D-Deploy-6). A ordem que funciona:

1. Criar os dois serviços apontando para o mesmo repo, com root directory `/backend` e `/frontend`.
2. **Gerar os dois domínios públicos antes de qualquer deploy.**
3. Preencher `VITE_API_BASE_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}/api` e `CORS_ALLOW_ORIGINS`.
4. Deployar.

Tentar na ordem natural trava — cada serviço espera o outro.

### ⚠️ O 307 de barra final vira bug de conteúdo misto atrás do proxy

O FastAPI redireciona `/api/accounts` → `/api/accounts/` com **307**. Atrás do TLS do
Railway, o uvicorn por default só confia em `X-Forwarded-Proto` vindo de `127.0.0.1`, então
o `Location` sai como `http://` e o browser bloqueia por conteúdo misto. Por isso o `CMD`
leva `--forwarded-allow-ips='*'`.

**Hoje isto é latente, não ativo** — auditadas as 7 chamadas do front, todas batem exatamente
no padrão da rota declarada (`/accounts/`, `/categories/`, `/installments/`,
`/transactions/` com barra; `/dashboard/summary`, `/installments/summary`,
`/reports/overview` sem). A tabela de barra final está sendo respeitada à risca. Mas é uma
chamada mal escrita de distância de virar bug difícil de ler em produção.

### Primeiro deploy: só o seed

Volume novo e vazio; `init_db.py` cria `Conta Principal` (saldo inicial 10.000) e as 10
categorias padrão. **Nenhum dado local é migrado** — e não há tentação, porque o
`database.db` local tem exatamente o seed desde o reset da fatia do saldo derivado.

⚠️ **`init_db.py` passa a rodar a cada boot do container**, não mais só à mão: numa
plataforma com volume, é o único ponto que garante as tabelas num volume novo. Isso torna a
**idempotência do seed um requisito de produção**, não uma conveniência — se ela falhar,
cada redeploy duplica as 10 categorias. Há teste travando isso.

Smoke pós-deploy, nesta ordem: `/health` → `/api/accounts/` (saldo `"10000.00"`) →
`/api/dashboard/summary` (`total_balance` idêntico) → as cinco telas do frontend.

`.dockerignore` nos dois serviços (`database.db`, `.venv`, `__pycache__`, `node_modules`,
`.output`, `dist`), para o caso de alguém buildar da máquina local.

### CI: o gate é convenção enquanto o auto-deploy estiver ligado

Workflow do GitHub Actions com dois jobs paralelos, em PR e em push para `main`:

| Job | Passos |
|---|---|
| `backend` | `setup-python@3.12` → `pip install -r requirements-dev.txt` → `pytest` |
| `frontend` | `setup-node@22` + cache npm → `npm ci` → `tsc --noEmit` → `npm test` → `npm run lint` |

`package-lock.json` existe, então `npm ci` é viável — e em Linux ele resolve os binários
nativos sozinho; o problema de esbuild/rollup `win32` é local, não do CI.

⚠️ **O Railway auto-deploya no push para `main` e não espera o Actions.** Enquanto for
assim, "CI antes do deploy" é **convenção, não mecanismo** — mesma distinção que a seção
0.1 faz sobre teste dependente de data. Aceito conscientemente para a primeira subida.
Virar mecanismo exige desligar o auto-deploy e disparar o deploy pelo CLI dentro do
workflow, depois dos testes verdes.

---

## 🧩 Design Patterns do Projeto

### Serialização Pydantic direta do ORM (`from_attributes=True`)

**Decisão tomada e a ser seguida em endpoints futuros.** Quando os dados já existem no objeto
SQLAlchemy — inclusive através de **relações** — o router deve **retornar o objeto ORM
diretamente** e deixar o FastAPI/Pydantic serializar. Não monte a resposta manualmente.

Referência: `TransactionResponse` (`schemas.py`) declara `installment: Optional[InstallmentProgress]`,
e `InstallmentProgress` tem `model_config = ConfigDict(from_attributes=True)`. Com isso,
`create_transaction`/`list_transactions` (`routers/transactions.py`) apenas retornam a entidade
e o progresso da parcela (`2/12`) aparece aninhado no JSON sem uma linha de código de montagem.

**Sempre acompanhe de `joinedload` ao listar.** Serializar uma relação dispara lazy-load por
item (problema N+1). As listagens que expõem `installment` usam
`.options(joinedload(models.Transaction.installment))` — ver `routers/transactions.py` e o
`recent_txs` em `routers/dashboard.py`.

**A exceção legítima:** quando o valor **não existe no model** e precisa ser calculado por
agregação, aí sim monte a resposta. É o caso de `routers/categories.py`, que instancia
`CategoryResponse(...)` à mão porque `spent` e `txs_count` vêm de `func.sum`/`func.count`.

### Categoria é foreign key, não string

**Decisão registrada antes da implementação em 07/08/2026.**

`Transaction.category_id` e `Installment.category_id` são FK **NOT NULL** para `categories.id`,
com `ondelete="RESTRICT"`. Categoria inexistente retorna **404** no router — mesmo padrão de
`installment_id`.

**Alternativa descartada:** manter string e normalizar (lower/trim) na comparação. Resolveria
só a case-sensitivity e deixaria de pé o caso pior — transação com categoria não cadastrada
era aceita e sumia da agregação. Normalizar não cria vínculo.

**Impacto no contrato:** `POST /transactions` e `POST /installments` exigem `category_id: int`;
as responses trocam a string por `category: CategoryRef` aninhado (`id`, `name`, `color`,
`icon_name`), para o front pintar a badge sem uma segunda chamada.

Pontos que os testes travam (`test_category_fk.py`):

* **`spent` filtra `type == "SAÍDA"`, `txs_count` conta a categoria inteira** (ENTRADA
  incluída). A assimetria é intencional; não "corrija" sem olhar o teste.
* **O join em `list_categories` é OUTER.** Categoria sem movimento tem que continuar
  aparecendo zerada — um `INNER JOIN` a faz sumir da listagem e do `category_distribution`
  do dashboard, que reusa a mesma função.
* **Validar a FK antes de mutar saldo.** Em `create_transaction` a checagem de categoria vem
  antes do débito, senão um ID inválido deixa `current_balance` corrompido.

> A agregação por FK substituiu um loop que rodava duas queries por categoria. Se precisar
> mexer, é um `GROUP BY` com `CASE` — não volte para o loop.

### Saldo é derivado do ledger, não armazenado

**Decidido em 15/08/2026, implementado em 22/08/2026.** Fecha o item 1 dos "Candidatos ao dia 5".

`Account.current_balance` era coluna mutável, e cada caminho de escrita precisava lembrar
de ajustá-la. Eram **três** (`POST`, `PATCH`, `DELETE` de transação), todos cobertos por
teste — mas a proteção era por disciplina, não por construção.

**O que decidiu a mudança:** qualquer escrita que não passe pelos routers deixa o saldo
obsoleto — seed, script de importação, migração, SQL cru. Dois testes provam isso
(`test_derived_balance.py`), falhando contra o mecanismo armazenado.

⚠️ **Correção de um argumento usado ao decidir.** O mapeamento afirmou que o `ON DELETE
CASCADE` já provava a divergência. **Não provava.** O CASCADE de `Transaction.account_id`
dispara ao apagar a *conta*, então conta e transações somem juntas e não sobra saldo
obsoleto. O teste de CASCADE passa antes e depois da mudança — é regressão, não motivação.
O argumento verdadeiro é sobre caminhos externos ou futuros, não sobre defeito já presente.

**A coluna foi removida**, não mantida como campo morto: campo que ninguém mais atualiza é
campo que alguém preenche errado. `AccountResponse.current_balance` passa a ser **campo
derivado** — exceção declarada ao padrão de serialização direta do ORM, mesma natureza de
`spent`/`txs_count` em `categories.py`.

Fórmula: `initial_balance + SUM(ENTRADA) − SUM(SAÍDA)`, sem recorte de data — saldo é
acumulado por definição, ao contrário de `spent`, que é do mês.

`_apply_to_balance` e as três escritas **sumiram**. O `PATCH` deixou de precisar estornar e
reaplicar; o `DELETE`, de estornar. A ordem "valide as FKs antes de mutar saldo" perdeu o
objeto — não há mais saldo a corromper no meio de uma requisição.

`dashboard.total_balance` passa de `SUM(current_balance)` para
`SUM(initial_balance) + SUM(ENTRADA) − SUM(SAÍDA)`.

**`app/account_balance.py` centraliza a regra**, no mesmo espírito de `periods.py` e
`installment_metrics.py`. São dois consumidores — `GET /accounts` e o `total_balance` do
dashboard — e o que se compartilha é o `CASE` de sinal (`ledger_delta()`), a parte que
inverteria de um lado só e faria a mesma métrica ter dois valores no mesmo app. As duas
agregações continuam independentes (uma agrupa por conta, a outra é global);
`test_total_balance_matches_the_sum_of_the_accounts` é o que trava a igualdade entre elas.

⚠️ **O `outerjoin` de `accounts_with_balance` não é estético** — é o mesmo motivo do OUTER
em `_aggregated_rows`: com `INNER JOIN`, conta sem transação nenhuma sumiria da listagem. O
`coalesce(..., Decimal("0.00"))` é o par disso, senão o saldo dela viria `null` no JSON em
vez do saldo inicial.

`POST /accounts` responde pela **mesma** agregação, não por `initial_balance` direto. Conta
recém-criada não tem transação e os dois valores coincidem hoje — repetir a fórmula é
exatamente como os dois endpoints começariam a divergir depois.

**Custo de leitura.** `GET /accounts` vira `LEFT JOIN` + `GROUP BY` em vez de `SELECT` de
coluna. A agregação cresce com o **total histórico de transações**, não com o número de
contas — 5 anos de uso pessoal são ~5.000 linhas, triviais com o índice de `account_id` que
a FK já cria. O ponto de virada realista exigiria dezenas de milhares de lançamentos **e**
`/accounts` sendo chamado com frequência; hoje é uma vez por formulário aberto.

### Dinheiro é `Decimal`, nunca `float`

**Decidido e implementado em 08/08/2026.** As 8 colunas monetárias usam o alias `MONEY =
Numeric(12, 2)` (`models.py`); os campos correspondentes em `schemas.py` são `Decimal`.

⚠️ **O que isso resolve, com precisão.** O SQLite **não** tem tipo decimal nativo: `NUMERIC`
é só afinidade e o valor é gravado como `REAL` (apurado à mão com `typeof()`; **não há teste
cobrindo isso** — ver a ressalva abaixo). O
ganho é a conversão float→`Decimal` **na leitura**, quantizada na escala, que absorve o
epsilon antes de o valor chegar a uma comparação ou ao JSON. **Não é armazenamento exato** —
exatidão real exigiria centavos como `Integer`, descartado por contaminar o tipo de todo
campo monetário da API.

**Contrato: dinheiro é string no JSON.** O Pydantic v2 serializa `Decimal` como string —
`{"amount": "342.50"}`, não `342.5`. É o default, não configuração.

> 🚧 **Restrição para a integração do front.** Toda resposta monetária precisa ser parseada
> antes de formatar ou somar. `formatBRL`/`Intl.NumberFormat` e as reduções que estão nos
> mocks (`items.reduce((s, i) => s + i.installment, 0)`) **não funcionam direto sobre
> string**. Vale para `amount`, `current_balance`, `initial_balance`, `budget`, `spent`,
> `total_amount`, `installment_amount`, `income`/`outcome`, `value` e os `total_*` do
> dashboard.

**Percentuais e médias continuam `float`**: `balance_change_pct`, `expenses_change_pct`,
`savings_pct_of_revenue` e `average_savings`. São razões, não dinheiro — divisão em `Decimal`
gera dízima de 28 dígitos e obrigaria a arredondar arbitrariamente. Os routers fazem
`float(...)` explícito na saída desses três.

**A escala faz parte do contrato.** Os fallbacks são `Decimal("0.00")`, não `Decimal(0)` nem
`0.0` — inclusive o `coalesce`/`case` de `categories.py`, que é o caminho da categoria sem
movimento. Duas razões:

* `"0.00"` previsível é o que torna a string parseável sem caso especial no front.
* Misturar `Decimal` com `float 0.0` levanta **TypeError**, não devolve número errado. E o
  erro **não** aparece quando as duas pontas caem no fallback (`0.0 - 0.0` é válido) — só no
  caso misto, tipo "mês em que só entrou salário". `test_money_precision.py` força cada
  combinação.

`sum()` sobre `Decimal` precisa de `start` explícito (`sum(..., ZERO)`): sem ele, uma
sequência vazia devolve `int 0` e a conta seguinte volta a misturar tipos.

### Agregação de categoria é do **mês corrente**, não acumulada

**Decidido em 10/08/2026, antes da implementação.** Corrige bug de produção, não só
inconsistência nova.

**O defeito.** `_aggregated_rows` (`categories.py`) fazia `outerjoin` em `Transaction` sem
filtro de data: `spent` e `txs_count` eram acumulados de todos os tempos. Mas `budget` é
**orçamento mensal** (está no próprio `Field(description=...)`), e `categorias.tsx` desenha
`spent / budget`. Consequência: a barra de progresso só cresce, e depois de alguns meses
**toda** categoria aparece permanentemente estourada. Já estava entregue e já valia para o
`PATCH` de budget do dia 4.1.

No dashboard o mesmo dado divergia de `total_expenses`, que é do mês — verificado: 900 no
mês passado + 100 neste dava `spent: "1000.00"` contra `total_expenses: "100.00"`, e uma
participação de 1000%.

**A correção.** `_aggregated_rows` filtra `[primeiro_dia_do_mês, primeiro_dia_do_mês_seguinte)`.
`txs_count` acompanha o mesmo recorte. Mês corrente fixo — sem `?month=`, que seria
superfície de API nova sem consumidor pedindo.

**O teto que faltava.** `total_revenues`/`total_expenses` usavam `date >= first_day` **sem
limite superior**, então contavam lançamento datado no futuro (parcela agendada, boleto a
vencer). O laço do `monthly_flow` sempre usou o intervalo semiaberto correto. Verificado:
uma transação do mês seguinte dava `total_expenses: "500.00"` e
`monthly_flow[-1].outcome: "0.00"` — dois números divergentes na mesma tela. Os três passam
a usar o mesmo recorte semiaberto.

**Mudança de contrato:** `GET /api/categories/` → `spent` e `txs_count` deixam de ser
acumulados. Consumidores hoje: o dashboard e `categorias.tsx` (ainda mockada).

⚠️ **A suíte tinha uma bomba-relógio que esta fatia desarma.** `conftest.create_transaction`
usava `date="2026-08-07"` fixo — 15 usos em 7 arquivos, 20 asserções sobre `spent`. Com o
filtro de mês, essas asserções passariam em agosto/2026 e ficariam vermelhas em setembro,
**sem ninguém tocar em código**. O default passou a ser a data de hoje. Teste que precise de
data específica deve derivá-la de `datetime.date.today()`, no padrão que
`test_dashboard.py::_month_offset` já usava.

### `insights` sai do contrato da API — texto é apresentação

**Decidido em 13/08/2026, antes da implementação.** Mudança de contrato, feita junto da
integração da tela de Relatórios.

**Por quê.** `ReportSummary.insights: List[str]` devolvia **frases prontas em português**,
montadas no servidor. Isso contraria o padrão firmado no dia 3 — *o backend expõe dados
crus e não duplica lógica de apresentação* —, que foi exatamente a regra que tirou o rótulo
Fixa/Variável/Parcelada do backend e o pôs em `lib/transactions.ts`. Idioma, redação e
formatação são do front.

**Três defeitos concretos, todos em produção**, encontrados na auditoria:

* **O insight de "Moradia" mentia.** Era condicionado à *presença* da categoria no top 4, não
  a ela ser a maior. Verificado com Moradia em **último lugar** com R$ 1,00: a API afirmava
  "Despesas com Moradia representam a maior fatia do seu orçamento".
* **Formatação em locale errado.** `f"R$ {avg_saving:,.2f}"` produz `R$ 1,915.94` — vírgula
  de milhar e ponto decimal, formato americano, num app em português.
* **O `else` era conselho genérico** (*"Mantenha o foco em reduzir gastos variáveis"*), sem
  dado nenhum por trás.

**Dos 4 insights do mock, só 1 tinha lastro:** o de parcelamentos. Os outros três eram
decoração — "economia cresceu +18% nos últimos 3 meses" (não existe janela de 3 meses),
"despesas fixas representam 71%" (é o "Fixas vs Variáveis" já removido do Dashboard) e
"Alimentação 17% acima da média trimestral" (não existe média trimestral por categoria).

E os textos do mock **nunca tiveram relação** com os que a API devolvia: eram 4 de um lado e
3 outros do outro, e o front ignorava o campo.

**O que fica.** A tela monta o insight de parcelamentos a partir de
`GET /api/installments/summary` (`active_count`, `monthly_committed_amount`), em função pura
testável — mesmo padrão de `formatDelta`. A tela de Relatórios passa a consumir dois
endpoints.

**Impacto no contrato:** `GET /api/reports/overview` deixa de devolver `insights`. Único
consumidor era `relatorios.tsx`, que ignorava o campo.

### `top_categories` do relatório usa a mesma janela do resto do relatório

**Decidido em 13/08/2026, antes da implementação.** Bug em produção, encontrado na
auditoria de `reports.py` durante o mapeamento da tela de Relatórios.

**O defeito.** `get_report_overview` monta `total_revenues`/`total_expenses` somando os 6
meses de `monthly_flow`, mas `top_cats_query` filtra apenas `type == "SAÍDA"` — **sem
recorte de data**. As duas metades do mesmo relatório falavam de períodos diferentes.

Verificado: com R$ 9.000 gastos há 13 meses e R$ 850 nos últimos 6,
`total_expenses` = `"850.00"` e `top_categories[0].value` = `"9050.00"`. A "maior categoria"
sozinha valendo 10× o total de despesas do período, lado a lado na mesma tela.

É o mesmo defeito de `_aggregated_rows` corrigido em 10/08 — sobreviveu aqui porque
**`reports.py` nunca teve arquivo de teste próprio**.

**A correção.** `top_cats_query` passa a usar a janela dos últimos 6 meses, a mesma do
`monthly_flow`, via `periods.trailing_months_bounds(6)`. O recorte volta a ser semiaberto,
`[primeiro dia de 5 meses atrás, primeiro dia do mês seguinte)`.

**A lacuna estrutural também fecha:** a fatia cria `tests/test_reports.py`. Até aqui a única
rota de `reports.py` era coberta de raspão por dois testes que moram em outros arquivos.

**Invariante que o teste trava:** a soma de `top_categories` não pode passar de
`total_expenses`. Com 4 categorias ou menos, é igualdade.

### Enforcement de foreign key precisa ser ligado explicitamente

O SQLite abre **toda** conexão com `PRAGMA foreign_keys = 0`. Sem isso ligado, os `ondelete`
declarados nos models são decorativos: o banco aceita linha órfã e ignora
`CASCADE`/`SET NULL`/`RESTRICT` em silêncio. Foi o estado do projeto até 07/08/2026 — o
`CASCADE` de `account_id` e o `SET NULL` de `installment_id` nunca foram aplicados.

`app/database.py` expõe `enable_sqlite_foreign_keys(engine)` e o aplica ao engine da
aplicação. **Todo engine novo precisa passar por ela** — inclusive os de teste. Se você criar
um engine e esquecer, as FKs voltam a ser decorativas só naquele contexto, que é o tipo de
divergência que só aparece em produção.

### Validação de regra de negócio no schema, não no router

Regras que dependem só do payload ficam em `@model_validator(mode="after")` no schema e
retornam **422** automaticamente. Exemplo: `TransactionCreate.check_fixed_and_installment_exclusive`
rejeita `is_fixed=True` junto de `installment_id`. Já validações que precisam do banco ficam no
router e retornam **404** (ex.: `installment_id` inexistente).

**Ordem importa no router:** valide todas as FKs **antes** de mutar saldos. Em
`create_transaction`, a checagem do parcelamento vem antes do débito/crédito na conta — senão
um ID inválido deixaria o `current_balance` corrompido.

> ⚠️ **Exceção aberta em 07/08/2026 para os PATCH parciais.** Ver "Operações de escrita"
> abaixo: num payload parcial o validador de schema deixa de funcionar, e a regra
> `is_fixed` × `installment_id` migra para o router com status **400**.

### Operações de escrita (PATCH/DELETE) — decisões do dia 4

**Registrado em 07/08/2026, antes da implementação.** Até aqui nenhum router expunha
`PUT`/`PATCH`/`DELETE`. O dia 4 fecha isso em duas fatias: **4.1 = transactions +
categories** (bloco de risco, mexe em saldo), **4.2 = installments** (`current_installment`,
não toca saldo). Contas e investimentos ficam fora — sem tela e sem consumidor previsto.

**Só `PATCH`, nunca `PUT`.** Toda edição de tela é parcial e cada verbo novo custa um método
em `lib/api.ts`. Alternativa descartada: `PUT` com payload completo — obrigaria o front a
reenviar campos que ele não editou, e reintroduziria a possibilidade de zerar campo por
omissão.

**`DELETE` devolve 204 sem corpo.** Isso **quebra o `api.delete` atual**: `apiFetch`
(`frontend/src/lib/api.ts`) faz `return response.json()` incondicionalmente, e parsear corpo
vazio rejeita a promise mesmo em sucesso. O ajuste no `apiFetch` faz parte da entrega, não é
tarefa futura.

#### Saldo: toda escrita que mexe em transação reexecuta o efeito

`create_transaction` faz `current_balance ±= amount`. Logo:

* **`PATCH` estorna o efeito antigo e aplica o novo** — nunca aplica delta sobre o valor já
  gravado. Editar valor/tipo sem estornar faz o saldo derrapar em silêncio a cada edição, e
  o erro só aparece meses depois, irreconciliável.
* **`DELETE` estorna** o efeito da transação apagada.
* **`type` pode trocar** (ENTRADA↔SAÍDA). É a operação de maior oscilação: `2 × amount`. Tem
  teste dedicado conferindo o saldo final aritmeticamente, não por sinal.
* **`account_id` NÃO pode trocar na v1** — mudaria dois saldos numa requisição. Para mover
  uma transação de conta: apagar e recriar.

#### Transação: o que pode mudar depois de criada

| Campo | Regra |
|---|---|
| `title`, `amount`, `date`, `category_id` | livres (`category_id` inexistente → 404) |
| `is_fixed` | livre |
| `type` | livre, com estorno + reaplicação |
| `installment_id` | **só desvincular** (`→ null`). Vincular uma avulsa ou trocar de parcelamento → 400 |
| `account_id` | rejeitado (**422**, campo não existe no schema de update) |

**`account_id` é 422 por `extra="forbid"`, não por omissão.** Se o schema apenas ignorasse o
campo, `PATCH {"account_id": 2}` seria aceito com 200 e não faria nada — o cliente acharia
que moveu a transação. Mesmo raciocínio de `test_legacy_category_string_is_no_longer_accepted`:
contrato recusado tem que falhar barulhento.

> **Regra geral (07/08/2026): IDs de relacionamento central são imutáveis via `PATCH` em
> toda a API.** Vale para `Transaction.account_id` e `Installment.account_id`. Os motivos
> são diferentes — na transação o veto é concreto (mover mexeria em dois saldos), no
> parcelamento é uniformidade de contrato, já que ele não toca saldo. A regra é única de
> propósito: o mesmo campo não deveria mudar de mutabilidade conforme o endpoint. Para
> mover de conta: excluir e recriar.

#### Parcelamento: o que pode mudar depois de criado (dia 4.2)

| Campo | Regra |
|---|---|
| `title`, `end_date`, `category_id` | livres (`category_id` inexistente → 404) |
| `current_installment` | livre, **inclusive acima de `total_installments`** (= quitado) |
| `installment_amount`, `total_installments`, `total_amount` | **409** se houver transação vinculada |
| `account_id` | rejeitado (**422**), pela regra geral acima |

**Avanço de parcela é `PATCH` genérico, não ação dedicada.** Alternativa descartada:
`POST /installments/{id}/advance`. Seria padrão novo no projeto para um `UPDATE` de uma
coluna, e exigiria registro de arquitetura próprio sem ganho sobre o `PATCH`.

**`current_installment > total_installments` é estado válido**, não erro. Uma validação
`current <= total` parece defensiva e quebraria justamente o caso de negócio (parcelamento
quitado). Não adicione.

**O bloqueio dos três valores é por _mudança_, não por presença do campo.** Reenviar
`installment_amount: 500.0` quando já é `500.0` passa. Um formulário de edição manda o
objeto inteiro, então bloquear por presença tornaria a tela inutilizável em qualquer
parcelamento que já tenha parcela lançada.

**`total_amount` entrou na trava depois.** A decisão original nomeava só
`installment_amount` e `total_installments`; deixar o terceiro aberto permitiria 12 parcelas
de 500 com `total_amount` = 9000, e a tela de parcelamentos calcula "Saldo a pagar" a partir
desses campos — a incoerência apareceria direto na UI.

**409 e não 400** porque o bloqueio vem da *existência de uma linha relacionada*, mesma
natureza de C9/C10, e não de uma combinação inválida de campos. Isso estende a convenção de
status de "exclusão bloqueada por referência" para "**escrita** bloqueada por referência".

#### `GET /api/installments/summary` — totais da tela de parcelamentos

**Decidido em 13/08/2026, antes da implementação.**

A tela precisa de três números no topo: parcelamentos ativos, comprometido/mês e saldo a
pagar. Os dois primeiros já existiam em `DashboardSummary`; o terceiro não existia em lugar
nenhum e o mock o calculava somando no cliente.

**Endpoint próprio, não campo novo no dashboard.** Alternativa descartada: pendurar
`remaining_total_amount` em `DashboardSummary` e a tela de parcelamentos buscar o resumo do
dashboard. Funcionaria, mas deixaria a tela com duas requisições e leria mal — tela de
parcelamentos consultando o resumo geral para preencher o próprio cabeçalho. Com endpoint
próprio é uma requisição e o contrato do dashboard não incha.

**Alternativa também descartada: somar no front** com aritmética de centavos inteiros. Era
mais barata (uma função pura, zero backend), mas espalharia a regra de negócio — "saldo a
pagar é parcela × parcelas restantes" — para o cliente, enquanto `monthly_committed_amount`
já vive no servidor. Metade da conta de cada lado é pior que qualquer um dos dois inteiro.

**`app/installment_metrics.py` centraliza a regra**, no mesmo espírito de `periods.py`:
`dashboard.py` e o router novo compartilham a definição de "ativo"
(`current_installment <= total_installments`) em vez de duplicá-la. Duplicar é como o `<=`
frágil do 4.3 viraria `<` num dos dois lados sem ninguém notar.

**`remaining_amount` entra em `InstallmentResponse` como campo derivado**, e é **exceção
declarada ao padrão de serialização direta do ORM** — mesmo tratamento de `spent`/`txs_count`
em `categories.py`. Fórmula: `installment_amount × (total_installments - current_installment + 1)`,
com a contagem de parcelas limitada a `[0, total_installments]`.

O `+1` é coerente com a D13: `current` é a parcela **ainda a pagar**, então 2/12 tem 11 pela
frente. Para quitado (13/12) a conta dá zero naturalmente, sem caso especial.

⚠️ **Ordem de rotas.** `@router.get("/summary")` tem que vir **antes** de qualquer
`GET /{installment_id}` que venha a existir, senão o FastAPI tenta converter `"summary"` em
`int` e devolve 422. Hoje não há `GET` por id, mas o teste que assere 200 no `/summary` é o
que pega isso quando houver.

#### Correção junto: `percent` da tela de parcelamentos

O mock calculava `percent = current / total` ("% pago") e `remaining = parcela × (total -
current + 1)` no mesmo card. Os dois discordam sobre o que `current` significa: o primeiro
assume as `current` parcelas já pagas, o segundo assume que a `current` ainda vai ser paga.
Em 2/12: "17% pago" ao lado de 11 parcelas restantes de 12.

Pela D13 a segunda leitura é a correta. `percent` passa a ser `(current - 1) / total`.

#### Dia 4.3 — agregações do dashboard ignoram parcelamento quitado

**Bug latente exposto pela D13, não decisão de arquitetura.** Antes do 4.2 não havia como um
parcelamento passar de `total_installments` pela API; o `PATCH` tornou o estado alcançável e
com ele o defeito virou real. `get_dashboard_summary` agregava sem filtro nenhum, então um
`13/12` seguia contado em `active_installments_count` e somado em `monthly_committed_amount`
— dinheiro que já não sai do bolso aparecendo como comprometido.

`get_dashboard_summary` (`routers/dashboard.py`) filtra
`current_installment <= total_installments` nas duas agregações.

⚠️ **O `<=` é a parte frágil.** `current == total` é a **última parcela**, ainda a pagar;
quitado começa em `total + 1`. Trocar por `<` derruba o mês final de todo parcelamento do
app, e o número continua parecendo plausível. `test_last_installment_still_counts_as_active`
existe só para isso.

**O filtro é da métrica, não do recurso.** `GET /installments` continua devolvendo o
histórico completo, quitados incluídos (decidido no 4.2) — implementá-lo em
`list_installments` faria o parcelamento sumir da tela em vez de sair do indicador. O 409 de
`DELETE /categories/{id}` também não olha progresso: `RESTRICT` é integridade referencial,
"quitado" é conceito de agregação, e misturar os dois reintroduziria o 500 que o C10
removeu.

#### Desvio: o validador exclusivo sai do schema e vira 400

`check_fixed_and_installment_exclusive` **não funciona em payload parcial**. `PATCH
{"is_fixed": true}` numa transação que já tem `installment_id` passa pelo schema, porque o
payload sozinho parece válido — a regra depende do **estado mesclado** (payload + linha no
banco), que o schema não enxerga.

Por isso, **só no caminho de update**, a checagem vive no router e retorna **400**. O `POST`
continua com o validador no schema e **422** — os dois status coexistem de propósito e não
devem ser uniformizados.

Convenção de status adotada no dia 4:

* **400** — regra de negócio sobre estado mesclado (fixa × parcelada, revincular parcelamento).
* **404** — FK que não resolve (categoria/transação inexistente).
* **409** — exclusão bloqueada por referência existente (ver abaixo).
* **422** — payload malformado ou campo proibido, direto do Pydantic.

#### Exclusão bloqueada é 409, não 500

`ondelete="RESTRICT"` faz o banco levantar `IntegrityError`, que **não tratado dentro de um
router vira 500** — erro de servidor para um caso de negócio esperado. O router checa a
referência antes e devolve **409**:

* **Categoria com transação vinculada** → 409.
* **Categoria usada só por parcelamento**, sem transação nenhuma → 409 também. O `RESTRICT`
  de `Installment.category_id` pega esse caminho e ele não tinha teste até aqui.
* **Renomear categoria em uso é livre** — não quebra FK. Reescreve relatório histórico, e
  isso é aceito.

> `test_category_in_use_cannot_be_deleted` (`test_category_fk.py`) **não** cobre isso: ele
> deleta via `fk_session` e só prova que o banco recusa. Garantia de dado ≠ contrato de API.

---

## 🧭 Itens futuros — **não decididos**

**Sem prazo. Nenhum é bug: a suíte está verde e o comportamento atual está correto.** Cada
um se resolve quando aparecer motivo concreto para investir, e passa pelo processo normal —
decisão registrada, teste vermelho, implementação.

| Item | Onde está registrado |
|---|---|
| Bloco "Fixas vs Variáveis" do Dashboard | aqui, item 0 |
| Mecanismo contra teste dependente de data | aqui, item 0.1 |
| Vitest para teste de componente | "Testes do frontend: runner nativo do Node" |
| SSR sem benefício → virar SPA estático | "🚢 Deploy → D-Deploy-1", e item 0.2 abaixo |

### 0. "Fixas vs Variáveis" no Dashboard — removido, não implementado

**Decidido em 10/08/2026.** O bloco existia em `index.tsx` com valores inventados
(`R$ 2.205,90 / 71%` vs `R$ 914,60 / 29%`) e **nenhum dado correspondente na API**.
`DashboardSummary` não devolve a divisão fixa/variável das despesas.

Removido na integração do Dashboard. Calcular no front a partir de `recent_transactions`
seria errado — são 7 itens, não o mês.

Se voltar, é **fatia de backend**: dois `func.sum` sobre `Transaction.amount` filtrando por
`is_fixed`, dois campos novos em `DashboardSummary`, com decisão registrada e teste antes.
Não é urgente e não tem consumidor pedindo.

### 0.2. O SSR do frontend não paga o que custa

**Levantado em 23/08/2026**, ao mapear o deploy. Registrado como débito na D-Deploy-1.

O app é TanStack Start com SSR via Nitro, mas **não há um `loader:` nem um
`createServerFn` em nenhuma rota** — todo dado é buscado client-side por `useQuery`. O
servidor renderiza casca HTML e o browser refaz tudo. Em troca disso o projeto carrega: um
runtime Node em produção onde bastaria um servidor de arquivos, um build por Nitro com
preset que precisa ser fixado à mão, e uma classe inteira de erro (SSR/hidratação) que um
SPA não tem.

Virar SPA estático simplificaria build, deploy e custo. Não foi feito junto do deploy de
propósito: **mudar o modo de renderização de um app que funciona não é trabalho de fatia de
deploy**, e o ganho é operacional, não de produto.

Sem prazo e **sem gatilho definido** — ao contrário do backup e do Alembic, que têm um. Se
for feito, é fatia própria, com o cuidado de que hoje não existe teste de componente para
pegar regressão de renderização (ver o item do Vitest acima).

### 0.1. Não há mecanismo contra teste que depende do mês em que roda

**Levantado em 10/08/2026**, ao introduzir o recorte mensal das agregações.

Data literal num teste que assere `spent`/`txs_count`/`total_expenses` passa no mês em que
foi escrita e fica vermelha na virada, sem ninguém tocar em código. A suíte tinha exatamente
isso (`conftest.create_transaction` com `date="2026-08-07"` fixo, 15 usos em 7 arquivos) e
foi corrigida — mas **a proteção hoje é convenção, não mecanismo**: nada impede o próximo
teste de reintroduzir o problema, e ele passaria por semanas antes de quebrar sozinho.

Duas saídas possíveis, nenhuma decidida:

* **Relógio controlável** (`freezegun`, `time-machine`) e um teste que rode as agregações com
  a data adiantada. Dependência nova.
* **Fixture `autouse`** que rejeite data literal em teste que assere agregação. Sem
  dependência, mas é heurística sobre o código do próprio teste.

> Tentei construir a verificação com um plugin de relógio falso durante a implementação da
> fatia e não fechou — a instrumentação ficou mais frágil que o que ela verificava. A
> auditoria foi feita estaticamente (cruzando "arquivo tem data literal" com "função assere
> campo filtrado por mês"), que funciona uma vez mas não protege o futuro.

---

## 🧭 Candidatos ao dia 5 — **não decididos**

**Isto não é decisão registrada.** São duas observações levantadas ao revisar a lógica de
saldo do dia 4.1 (07/08/2026), deixadas explicitamente em aberto porque são **mudança de
arquitetura, não fix pontual**. Nenhuma das duas é bug: a suíte está verde e o
comportamento atual está correto. Ambas tratam de *exposição a risco futuro*.

Quem for implementar qualquer uma precisa passar pelo processo normal — decisão registrada
primeiro, depois teste vermelho, depois código.

### 1. ✅ `current_balance` armazenado vs. saldo derivado do ledger — **resolvido em 22/08/2026**

> Implementado. O registro abaixo fica como histórico da observação; o contrato em vigor
> está em "🧩 Design Patterns → Saldo é derivado do ledger, não armazenado".

**Observação.** `Account.current_balance` é campo mutável gravado no banco, e cada caminho
de escrita precisa lembrar de ajustá-lo. Até o dia 4.1 havia **um** (`create_transaction`);
agora há **três** (`POST`, `PATCH`, `DELETE` de transação). A superfície de erro triplicou
num único dia.

Os três estão cobertos, mas a proteção é por teste, não por construção: o quarto caminho que
alguém adicionar — um endpoint de importação, um script de seed, uma transferência entre
contas — não herda nada e pode gravar transação sem mexer no saldo. O sintoma é silencioso e
só aparece quando os números já não reconciliam.

**Alternativa a avaliar.** Saldo derivado: `initial_balance + SUM(ENTRADA) − SUM(SAÍDA)`
sobre as transações da conta, calculado na leitura. Torna o drift **estruturalmente
impossível** — não há o que esquecer de atualizar. Custo: uma agregação por leitura de conta
(hoje é um `SELECT` de coluna), e `AccountResponse.current_balance` deixa de vir do ORM
direto, virando exceção legítima do padrão "serialização direta" (mesma natureza do
`spent`/`txs_count` de `categories.py`).

**O que decidir:** vale trocar três pontos de escrita disciplinados por um custo de leitura
recorrente, num app de finanças pessoais onde o volume de transações é baixo.

### 2. ✅ `Float` → `Numeric`/`Decimal` — **resolvido em 08/08/2026**

> Implementado. O registro abaixo fica como histórico da decisão; o contrato em vigor está
> em "🧩 Design Patterns → Dinheiro é `Decimal`".

**Observação.** Todo valor monetário do projeto é `Float` (`models.py`: `amount`,
`current_balance`, `initial_balance`, `budget`, `total_amount`, `installment_amount`, mais
`Investment.current_balance` e `InvestmentHistory.balance` — 8 colunas ao todo) — ou seja,
ponto flutuante binário, que não representa exatamente frações decimais como `0.1`.

Isso é anterior ao dia 4.1, mas o `PATCH` aumentou a exposição: cada edição faz **duas**
operações sobre o saldo (estorno + reaplicação) onde antes havia uma. Erro de arredondamento
não some — acumula na coluna.

⚠️ **Os testes não pegariam isso.** Toda asserção de saldo usa `pytest.approx`, que tolera
justamente a diferença que um erro de centavo produziria. Não é falha da suíte — comparar
`Float` com `==` seria frágil pelo motivo oposto —, mas significa que **a suíte verde não é
evidência de exatidão monetária**.

**Decidido em 08/08/2026: `Numeric(12, 2)` + `Decimal` no Pydantic, nas 8 colunas.**

⚠️ **Correção de uma imprecisão registrada aqui antes.** A versão anterior desta seção dizia
que `Decimal` "eliminaria o risco de erro de centavo acumulado". **Não elimina, no SQLite.**
Apurado à mão em 08/08/2026 (SQLAlchemy 2.0.51 / SQLite 3.40.1): o SQLite não tem tipo decimal
nativo, `NUMERIC` é só afinidade, e o valor é gravado como `REAL` — `typeof()` devolve
`real`. O que o SQLAlchemy faz é **converter float→Decimal na leitura, quantizando na escala
declarada**.

Ou seja, o que se ganha é **arredondamento na leitura absorvendo o epsilon**, não
armazenamento exato. Na prática resolve o problema observável — `0.30000000000000004` nunca
chega ao JSON nem a uma comparação — porque o erro de ponto flutuante é menor que meio
centavo e some no arredondamento para 2 casas. Exatidão real de armazenamento só viria com
**centavos como `Integer`** (apurado do mesmo modo: `typeof=integer`, `SUM` exato), descartado por
contaminar o tipo de todo campo monetário na API e forçar conversão em toda fronteira.

**Impacto no contrato:** o Pydantic v2 serializa `Decimal` como **string** JSON —
`{"amount": "342.50"}`, não `342.5`. Não é configuração, é o default. Restrição registrada
para a integração do front: **toda resposta monetária vem como string e precisa ser parseada
antes de formatar ou somar**. `formatBRL`/`Intl.NumberFormat` e as reduções dos mocks
(`items.reduce((s, i) => s + i.installment, 0)`) não funcionam direto sobre string.

Percentuais e médias (`balance_change_pct`, `expenses_change_pct`,
`savings_pct_of_revenue`, `average_savings`) **continuam `float`** — são razões, não
dinheiro; divisão em `Decimal` gera dízima de 28 dígitos e obrigaria a arredondar
arbitrariamente.

Custo: migração de coluna — e **não há Alembic no projeto**, então isso esbarra na mesma
restrição do checklist (`create_all()` não faz `ALTER TABLE`). Enquanto o banco só tiver
dados de seed, o recreate resolve; depois do primeiro dado real, passaria a exigir
migrations. **Foi o que tornou este item sensível a prazo** e o motivo de ser feito agora.

---

## 📐 Processo: decisão de arquitetura **antes** da implementação

**Compromisso assumido. Vale para todo trabalho daqui em diante.**

Toda feature nova que introduza **modelo, endpoint, dependência ou padrão novo** tem sua
decisão de arquitetura registrada **neste arquivo antes** de a implementação ser pedida.
Documentação escrita depois do código não conta como decisão registrada — conta como relato.

**Registro mínimo: 3 a 5 linhas, não um RFC.**

1. O que se decidiu.
2. Qual alternativa foi descartada e por quê.
3. O impacto no contrato com o frontend (se houver).

**Onde escrever:** decisão de padrão vai em "🧩 Design Patterns do Projeto"; mudança de
contrato de API vai em "🔌 Status da Integração Frontend ↔ Backend".

### Por que a regra existe

Porque até aqui o projeto fez o contrário, e isso é verificável no git:

* `GEMINI.md` — a "constitution" com o plano técnico — entrou no commit `ab2e67e`, **o mesmo
  commit** que já trazia `models.py`, `schemas.py`, 3 routers e 3 arquivos de teste. O plano
  não precedeu o código; nasceu junto.
* `CLAUDE.md` só apareceu no commit `c827f21`, **8 dias depois do backend** e 3 dias depois
  dos routers de `categories`/`installments`/`reports`.
* A seção "🧯 Common Hurdles" descreve problemas **já resolvidos** ("Como foi resolvido:
  adicionados a `Transaction`..."). É documentação forense — útil, mas não é decisão prévia.

O `GEMINI.md` já declarava o princípio "Anti-Vibe Coding" (*"nenhuma linha de código deve ser
escrita sem plano técnico aprovado"*). Ele nunca teve mecanismo. Esta seção é o mecanismo.

**Quando a regra não for seguida** — e vai acontecer —, escreva isso explicitamente no
registro ("documentado retroativamente em DD/MM") em vez de redigir a doc como se fosse
prévia. Um registro honestamente rotulado como tardio vale mais que um que finge não ser.

### Teste antes da implementação (a partir de 07/08/2026)

**Todo código novo exige teste escrito e aprovado antes da implementação.** Não é mais
aceitável entregar código com teste retroativo.

O ciclo é:

1. Decisão de arquitetura registrada aqui (regra acima).
2. **Testes escritos e submetidos para aprovação** — vermelhos, porque a implementação não
   existe. O vermelho é o entregável desta etapa, não um problema a esconder.
3. Aprovação explícita dos testes.
4. Só então a implementação, até o verde.

**O teste vermelho tem que falhar pelo motivo certo.** Antes de submeter, rode e leia a
mensagem: `assert 422 == 404` porque o campo ainda não existe é sinal válido; `ImportError`
por typo no nome do arquivo não é. Um teste que falha por erro de digitação não valida nada e
vai ficar verde pelo motivo errado depois.

**Cuidado com o falso verde na etapa 2.** Teste novo que já passa contra o código antigo em
geral está testando outra coisa. Ex.: ao escrever `test_category_fk.py`, dois testes passaram
de cara — porque o POST era rejeitado com 422 pelo contrato *velho*, e a asserção "nada foi
persistido" se sustentava por acidente. Sinalize esses casos ao submeter em vez de contá-los
como cobertura.

**A exceção, e como sinalizá-la.** Código com teste escrito depois só é aceitável quando
**explicitamente rotulado como tal** no momento da entrega — foi o caso de
`test_categories.py` e `test_installments.py` (06/08/2026), escritos para cobrir routers que
já existiam há dias. Cobertura retroativa de código legado é trabalho legítimo; o que a regra
proíbe é escrever código novo hoje e o teste depois, sem dizer.

---

## ✅ Checklist Pós-Implementação

Rodar após **qualquer** mudança em `models.py` ou `schemas.py`:

0. **A decisão de arquitetura estava registrada antes?** Se estava, confira que o que foi
   implementado bate com o que foi escrito. Se não estava, registre agora e marque como
   retroativo — ver "📐 Processo" acima.

1. **Testes verdes (obrigatório):**
   ```bash
   cd /workspace/backend && .venv/bin/pytest
   ```

2. **Resetar o banco se o schema mudou.** `Base.metadata.create_all()` **não** executa
   `ALTER TABLE` — ele ignora tabelas que já existem. Um `database.db` antigo continua com o
   schema desatualizado e o servidor quebra com `no such column`. Como o banco só contém dados
   de seed, recrie:
   ```bash
   cd /workspace/backend
   rm -f database.db
   PYTHONPATH=/workspace/backend .venv/bin/python app/init_db.py
   ```
   Confira as colunas novas:
   ```bash
   python3 -c "import sqlite3; print(*sqlite3.connect('database.db').execute('PRAGMA table_info(transactions)'), sep='\n')"
   ```

   > ⚠️ **O reset só é seguro enquanto o banco tiver apenas dados de seed.** Não há Alembic no
   > projeto: `create_all()` não migra nada. A partir do primeiro dado real, mudança de schema
   > deixa de ser possível assim — é o gatilho para introduzir migrations.

3. **Regenerar o `openapi.json`.** O arquivo é versionado, então não basta o `/docs` em
   runtime — mas **nunca** edite à mão:
   ```bash
   cd /workspace/backend
   PYTHONPATH=/workspace/backend .venv/bin/python -c "import json; from app.main import app; json.dump(app.openapi(), open('openapi.json','w',encoding='utf-8'), indent=2, ensure_ascii=False)"
   ```
   Confira também o `/docs` com o servidor no ar (`http://localhost:8000/docs`).

4. **Atualizar a seção "Status da Integração"** deste arquivo ao integrar uma tela.

---

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

## 🧯 Common Hurdles (Problemas Recorrentes)

### 1. Desalinhamento entre o schema do frontend (gerado no Lovable) e o do backend

**Sintoma:** as telas exibem informação que a API simplesmente não devolve. Concretamente: um
**título** por transação separado da categoria ("Salário", "Aluguel"), badges de
**Fixa / Variável / Parcelada / Receita**, e o progresso da parcela (`2/12`).

**Causa:** o frontend foi gerado no Lovable a partir de um design com dados fictícios próprios,
enquanto o backend foi modelado de forma independente. Os mocks viraram, na prática, um
contrato implícito que o backend nunca implementou. O model `Transaction` só tinha
`type` (`ENTRADA`/`SAÍDA`) e `category`.

**Como foi resolvido:** adicionados a `Transaction` (model + schemas):
* `title` — `String(150)`, obrigatório.
* `is_fixed` — booleano, default `False`.
* `installment_id` — FK nullable para `installments` (`ondelete="SET NULL"`), com a relação
  `installment` serializada como `InstallmentProgress` aninhado.

O rótulo exibido continua sendo derivado **no frontend** a partir de `type` + `is_fixed` +
`installment` — o backend expõe dados crus e não duplica lógica de apresentação.
`DashboardSummary` também ganhou `balance_change_pct`, `expenses_change_pct` e
`savings_pct_of_revenue` para os deltas dos `MetricCard`.

**Lição:** antes de integrar uma tela, compare o mock inline dela com o schema real da API. É
mais barato descobrir o gap lendo o mock do que depurando um `undefined` no JSX.

### 2. `ModuleNotFoundError: No module named 'app'` ao rodar o pytest

**Sintoma:** `.venv/bin/pytest` falhava na coleta de **todos** os arquivos de teste, mesmo os
que não haviam sido tocados:

```
tests/test_transactions.py:7: in <module>
    from app.database import Base, get_db
E   ModuleNotFoundError: No module named 'app'
```

**Causa:** não havia arquivo de configuração do pytest, então a raiz do backend não entrava no
`sys.path` e o pacote `app` ficava invisível. O comando documentado neste próprio arquivo não
funcionava; só passava com `PYTHONPATH=/workspace/backend` na frente.

**Como foi resolvido:** criado `backend/pytest.ini`:

```ini
[pytest]
pythonpath = .
testpaths = tests
```

Agora `.venv/bin/pytest` roda direto, sem `PYTHONPATH`. Se o erro voltar, confirme que o
`pytest.ini` existe e que você está executando a partir de `/workspace/backend`.

### 5. Backend deployado devolvia 404 em TODA rota, inclusive `/health`

**Sintoma (02/10/2026).** `{"detail":"Not Found"}` em `/health` e em
`/api/accounts` no backend deployado na Vercel. `/health` não exige
autenticação, então não era 401 disfarçado.

**Como o diagnóstico foi fechado sem acesso ao deploy.** Duas evidências
independentes:

* **O formato da resposta.** `{"detail":"Not Found"}` é do FastAPI/Starlette —
  a Vercel devolveria HTML. `content-length: 22` casa **exatamente** com esse
  corpo. E um caminho inexistente de propósito devolveu resposta idêntica: tudo
  chegava ao app, sempre no mesmo caminho errado.
  * ⚠️ O `vary: Origin` da resposta **não** é do nosso `CORSMiddleware` —
    verificado local, com e sem header `Origin`. Vem do edge da Vercel. A
    impressão digital do app é o corpo de 22 bytes.
  * A prova decisiva foi `/api/accounts/`: com o caminho íntegro, a resposta
    seria **401 em português**. Vindo `Not Found`, o app nunca viu essa rota.
* **O log de build**, que explicitou o mecanismo:

      WARNING! Internal rewrites in backend framework projects now route
      requests using the rewritten destination path. This behavior was
      previously unsupported and may change which application route handles
      a request.

**Causa.** `backend/vercel.json` tinha
`{"rewrites": [{"source": "/(.*)", "destination": "/api/index"}]}`. O
`destination` passou a ser o caminho que **roteia** a requisição, então o app
ASGI recebia `/api/index` em toda chamada — rota que ele não tem.

Duas coisas se encaixam no aviso: o comportamento era *"previously
unsupported"*, ou seja **mudou depois** de a configuração ser escrita; e o log
chama o projeto de *"backend framework project"*, indicando que a Vercel
**detecta o FastAPI nativamente** (instalou de `backend/requirements.txt` sem
nenhum `builds` declarado). O rewrite competia com a detecção e vencia.

**Como foi resolvido.** `backend/vercel.json` **removido** — a detecção nativa
já roteia para o app ASGI, e o arquivo só existia para fazer o que ela faz.
`tests/test_deploy_config.py` impede o retorno: se o arquivo voltar a existir,
nenhum rewrite pode ter `destination` de caminho, e `routes` legado também é
recusado.

> O teste **não** exige que o arquivo não exista: um dia pode ser preciso
> declarar `headers`, `regions` ou `maxDuration`. O que não pode voltar é o
> rewrite por caminho.

**Achado secundário do mesmo log: produção rodava Python 3.12.**

      No Python version specified in .python-version, pyproject.toml, or
      Pipfile.lock. Using python version: 3.12

A `.venv` e os dois jobs de CI rodavam **3.11**. Divergência dev/prod
silenciosa — nada havia quebrado, e é a classe de problema que a D-Vercel-1
existe para evitar.

🔴 **A primeira correção pinou 3.11 e quebrou o deploy.** A Vercel não oferece
3.11 no ambiente gerenciado do uv:

      No interpreter found for Python 3.11 in managed installations or
      search path

**A direção foi invertida: produção manda.** `.python-version`, os dois
`setup-python` do CI e a imagem do `docker-compose.yml` passaram todos a
**3.12** — o invariante "nenhuma divergência entre dev/CI/produção" é o mesmo,
com o valor que a plataforma realmente aceita em vez do que o container de
desenvolvimento usa.

⚠️ **O erro de direção foi barato porque a intenção estava certa.** O que
custaria caro seria pinar e não verificar: o valor errado só aparece na
instalação do build, não em teste nenhum.

**Verificado sob 3.12 de verdade**, não por "é só uma minor acima": instalado
um CPython 3.12.15 pelo próprio uv, venv limpo com as mesmas versões pinadas de
`requirements-dev.txt`, e a suíte rodada completa — **379 passed**, incluindo a
simulação dos dois jobs de CI de um checkout fora de `/workspace`. Zero
`DeprecationWarning` originada em `app/`, e nenhum uso de API removida em 3.12
(`utcnow`, `distutils`, `pkg_resources`).

**Três testes guardam o invariante, e a divisão entre eles importa:**

| Teste | Natureza |
|---|---|
| `..._is_pinned_to_what_vercel_supports` | **absoluto** — literal `3.12` |
| `..._matches_every_ci_job` | **relativo** — pin × `setup-python` |
| `..._dev_container_image_matches_the_pinned_version` | **relativo** — pin × `docker-compose.yml` |

O literal do primeiro não é a mesma coisa que o caminho hardcoded do item 4:
ele codifica uma **restrição externa**, não um fato derivável do repositório. E
é ele que impede alguém de subir dev e CI juntos para 3.13 sem confirmar a
Vercel — os dois relativos ficariam verdes, e só o deploy falharia.

> Observado ao escrever: com tudo uniformemente em 3.11, **só o teste absoluto
> ficou vermelho**. Os relativos passavam, porque consistência errada ainda é
> consistência. É a demonstração de por que os três existem.

⬜ **Divergência que sobra e não tem como fechar aqui:** o container do agente
tem só Python 3.11, então a `.venv` usada no dia a dia continua 3.11 enquanto
CI, compose e produção são 3.12. Não é corrigível pelo repositório — a imagem do
container do agente não é nossa. A mitigação é o **job de CI ser a autoridade**:
ele roda 3.12 em todo push, e foi em 3.12 que esta fatia foi validada. Quem
rodar a suíte só aqui está num interpretador que não é o de produção.

**Lição.** Configuração de plataforma não tem teste de comportamento possível
localmente, mas tem **contrato verificável sobre arquivo** — e foi isso que
sobrou como proteção nos dois casos. Vale também registrar que o aviso estava
no log desde o primeiro deploy: o diagnóstico levou duas rodadas por ele não
ter sido lido antes.

### 4. `PermissionError` no CI ao criar `/workspace` — caminho de máquina no código

**Sintoma (primeiro CI, 02/10/2026).** Os jobs `backend` **e** `backend-postgres` falharam com
o mesmo traceback: `PermissionError` em `os.makedirs`, tentando criar `/workspace` no runner
do GitHub Actions.

⚠️ **A causa não é a que o traceback sugere.** O `makedirs` parecia rodar
incondicionalmente, inclusive no job de Postgres — mas ele **sempre** foi guardado por
`sqlite_path_from_url`, que devolve `None` para Postgres. Verificado, não suposto. O
mecanismo real tem quatro passos:

1. **Nenhum dos dois jobs definia `DATABASE_URL`.** O de Postgres definia só
   `TEST_DATABASE_URL`, que governa o engine da **suíte**, não o da aplicação.
2. No runner não existe `backend/.env.local`, então nada preenchia a variável.
3. `resolve_database_url()` caía no **default**: `sqlite:////workspace/backend/database.db` —
   caminho absoluto do bind mount **deste** container.
4. O guard então acertava ao ver uma URL SQLite, e tentava criar `/workspace`, o que exige
   escrever na raiz do filesystem.

O guard funcionava; o defeito era o **default**. O sintoma apareceu no `makedirs` porque é a
primeira linha que toca o disco.

**Consequência que passou despercebida junto:** no job `backend-postgres`, o engine da
**aplicação** nunca foi Postgres — era o SQLite do default. O job testava Postgres apenas no
engine da suíte, e `test_foreign_keys_are_enforced_on_app_engine` rodava o ramo SQLite ali.

**Como foi resolvido.**

* `BACKEND_DIR` derivado de `__file__`, e `DEFAULT_DATABASE_URL` construído a partir dele —
  mesmo padrão que `ENV_FILE` já usava. O default acompanha o checkout.
* `prepare_sqlite_directory(url, makedirs=...)` extraída, com `makedirs` **injetável**: o
  comportamento que importa é *não haver chamada* no caminho Postgres, e com `monkeypatch`
  global não há como distinguir "não chamou" de "chamou outra coisa".
* O job `backend-postgres` passa a definir `DATABASE_URL` também, então nenhum caminho de
  SQLite é tocado nele e o ramo Postgres é de fato exercitado.
* O job `backend` **continua sem** `DATABASE_URL`, de propósito: é o único lugar que exercita
  o default num filesystem que não é este container. Definir a variável deixaria o default
  sem cobertura e o bug voltaria sem ninguém notar.

⚠️ **Um dos testes novos é falso verde nesta máquina, e está rotulado como tal.**
`test_the_default_database_lives_inside_the_backend_package` compara o caminho derivado de
`__file__` com o esperado — e aqui os dois **coincidem**, porque o checkout realmente mora em
`/workspace/backend`. Ele só ficaria vermelho na máquina onde o bug aparece, que é a máquina
onde não rodamos. O teste que **consegue** distinguir varre `app/` e proíbe literal
`/workspace` no código — contrato sobre arquivo, no mesmo espírito de
`test_every_requirement_is_pinned`.

### O CI seguinte falhou, e a falha confirmou a correção

`test_database_url_defaults_to_todays_hardcoded_path` comparava
`resolve_database_url({})` com `"sqlite:////workspace/backend/database.db"` **escrito à
mão**. Depois da correção, no runner o default passou a resolver para o checkout real
(`/home/runner/work/.../backend/database.db`) e o teste ficou vermelho — a expectativa era a
única coisa que seguia presa ao caminho deste container.

É a **imagem espelhada** do falso verde acima: o mesmo acoplamento, visível só na máquina
oposta. Localmente passava e no CI falhava; o outro passava no CI e falhava localmente.

A expectativa agora é **derivada do local do próprio arquivo de teste**, não de
`settings.BACKEND_DIR`. São duas derivações independentes do mesmo fato: concordarem é
verificação, enquanto reusar a constante da implementação seria tautologia — passaria mesmo
se `BACKEND_DIR` apontasse para o lugar errado. O nome passou a
`test_database_url_defaults_to_the_file_inside_the_backend_package`, porque "hardcoded path"
deixou de descrever o que o teste verifica.

Junto entrou `test_the_default_database_stays_inside_the_package`, que expressa o invariante
sem depender de qual é o caminho: o nome do arquivo pode mudar, mas o default não pode sair
de `backend/`.

**Verificado rodando a suíte de um checkout copiado para fora de `/workspace`**, sem
`.env.local` e sem `DATABASE_URL` — as mesmas condições do runner: 374 passed, nos dois
cenários de job.

**Lição.** Caminho absoluto escrito à mão é bomba-relógio de ambiente: funciona na máquina de
quem escreveu e falha em toda outra. A seção "Ambiente de Execução" já registra que
`/workspace` é bind mount específico deste container — faltava a consequência de que ele não
pode vazar para o código.

### 6. Frontend deployado devolvia o 404 **da Vercel** — artefato no lugar e formato errados

**Sintoma (02/10/2026).** `This page doesn't exist` — o 404 genérico da plataforma, não um
erro da aplicação. Indício de que a Vercel não achou output nenhum para servir.

⚠️ **Sintoma oposto ao do item 5, e a diferença é o diagnóstico.** No backend o 404 era
`{"detail":"Not Found"}` — formato do FastAPI, prova de que o app era alcançado. Aqui o 404
é HTML da Vercel: nada nosso respondeu.

**A causa.** O preset `vercel` do Nitro declara corretamente a Build Output API v3:

```js
output: {
  dir: "{{ rootDir }}/.vercel/output",
  serverDir: "{{ output.dir }}/functions/__server.func",
  publicDir: "{{ output.dir }}/static/{{ baseURL }}"
}
```

Mas o **`@lovable.dev/vite-tanstack-config` sobrescreve**, hardcodando `dist` para qualquer
preset:

```js
const output = {
  dir: "dist", serverDir: "dist/server", publicDir: "dist/client",
  ...userNitroOpts.output        // <- a única saída
};
```

O resultado é um **híbrido que não é BOA v3 válida**: `dist/` com `client/`+`server/` e um
`config.json` de BOA v3 solto dentro, faltando `static/` e `functions/`. Reproduzido com
build real: `.vercel` e `*.func` não existiam em lugar nenhum do projeto.

Coerente com o `nitro.json` gerado, que referenciava `../../static` e
`./functions/__server.func/index.mjs` — nomes da BOA v3 — enquanto os diretórios reais eram
outros. O preset *queria* emitir BOA v3 e era impedido.

🔴 **Nenhuma configuração na interface da Vercel corrigiria isso.** Minha hipótese registrada
antes — "o ajuste é o *Output Directory* do projeto" — estava **errada**: o layout estava
errado, não o caminho. Apontar a Vercel para `dist` não ajudaria, porque sem `static/` e
`functions/*.func` não há o que ela consuma em diretório nenhum.

**O log de build confirmou as duas pontas.** Três linhas:

      [start] [nitro] Building [Nitro] (preset: `vercel`, ...)   <- preset ativo
      [success] [nitro] Generated public dist/client             <- publicDir sobrescrito
      [info] Generated dist/nitro.json                           <- dir sobrescrito

E respondeu a dúvida que sobrava: **a Vercel NÃO detectou framework no frontend.** O log vai
de `vercel build` direto para `Installing dependencies` e `npm run build`, sem nenhuma linha
de detecção — ao contrário do backend, que anunciou *"backend framework projects"*. Logo não
há *Framework Preset* a ajustar: a Vercel só executa o build e coleta o que achar em
`.vercel/output`.

**Como foi resolvido.** `nitro.output` explícito no `vite.config.ts` — a última linha do
objeto da Lovable (`...userNitroOpts.output`) é o que permite. Verificado por build real: o
artefato passou a trazer `config.json`, `static/assets/` e
`functions/__server.func/` com `index.mjs` e `.vc-config.json`
(`launcherType: Nodejs`), e `dist/` deixou de ser criado. A linha do log virou
`Generated public .vercel/output/static`.

`.vercel/` entrou no `.gitignore` — o artefato passou a ser candidato a commit acidental.

**Três asserts novos em `vite-config.test.ts`**, porque o teste do preset sozinho ficava
**verde no estado quebrado**: preset certo com output sobrescrito era exatamente a falha.

**Lição, a mesma dos itens 4 e 5 por outro caminho:** valor default de biblioteca de terceiro
sobrescrevendo configuração de preset é invisível no código do projeto — o `vite.config.ts`
dizia `preset: "vercel"` e parecia correto. O que expôs foi **ler o código do preset
instalado**, não o nosso.

### 3. API "no ar" mas inacessível do Windows (`curl` exit 7)

**Sintoma:** o uvicorn sobe sem erro, loga `Uvicorn running on http://0.0.0.0:8000`, e
`curl http://localhost:8000/...` **de dentro do container** devolve 200. Do Windows, o
mesmo `curl` falha com *exit code 7 — failed to connect*, e o browser não carrega nada.

Parece erro de CORS ou de frontend. Não é: não há rota de rede até o processo.

**Causa:** o servidor foi iniciado **à mão dentro de um container que não publica a porta
8000**. `--host 0.0.0.0` resolve o binding *interno* — o processo escuta em todas as
interfaces do container —, mas publicar no host é decidido na criação do container
(`-p 8000:8000`) e **não pode ser adicionado depois**. Um container sem esse mapeamento dá
um servidor perfeitamente funcional e completamente inalcançável de fora.

Agrava o diagnóstico o fato de o container do agente ser **outro** container, não o
serviço `backend` do compose. Lá dentro não há `docker` nem `/var/run/docker.sock`, então
nem dá para inspecionar ou corrigir o mapeamento de dentro.

**Como confirmar em 10 segundos:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/health  # dentro: 200
hostname; hostname -i                    # é o container do compose ou outro?
which docker; ls /var/run/docker.sock    # ambos ausentes => container do agente
```

**Correção:** subir pelo compose, do host:

```
docker compose up backend
```

**Risco a evitar:** não deixe os dois rodando. O container do agente e o do compose montam
o **mesmo** `backend/database.db` pelo bind mount, e dois processos escrevendo o mesmo
arquivo SQLite sobre 9p é corrupção esperando acontecer — num arquivo que fica no disco do
host.

> Ocorrido em 10/08/2026, durante a integração da tela de Transações. A restrição já estava
> escrita em dois lugares (o comentário do `ports:` no `docker-compose.yml` e a seção
> "Via docker-compose") e ainda assim o comando manual foi escolhido, porque a seção
> "Backend" o apresentava sem ressalva. A ressalva agora está lá.
