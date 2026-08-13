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
* **Framework:** React + Vite + TypeScript
* **Roteamento:** TanStack Router (`src/routes/`)
* **Estilização e Componentes:** Tailwind CSS + Shadcn/UI (`src/components/ui/`) + Recharts
* **Comunicação com API:** Axios/Fetch centralizado em `src/lib/api.ts`

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

> Não há Dockerfile: os serviços rodam sobre imagens oficiais (`python:3.11-slim`,
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

**Estado atual: nenhuma tela integrada.** O backend está pronto e alinhado, mas o frontend
ainda consome 100% de dados mockados. Verificado por busca: **nenhum componente ou rota
importa `lib/api.ts`** — o cliente HTTP existe mas não tem um único consumidor.

| Tela / Rota | Endpoint correspondente | Status |
|---|---|---|
| `index.tsx` (Dashboard) | `GET /api/dashboard/summary` | ❌ Mockado |
| `transacoes.tsx` | `GET/POST /api/transactions` | ❌ Mockado |
| `categorias.tsx` | `GET/POST /api/categories` | ❌ Mockado |
| `parcelamentos.tsx` | `GET/POST /api/installments` | ❌ Mockado |
| `relatorios.tsx` | `GET /api/reports/overview` | ❌ Mockado |

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

**O projeto hoje não usa nenhuma variável de ambiente customizada.** Isso foi verificado, não
presumido:

* **Não existe** nenhum arquivo `.env`, `.env.example` ou `.env.local` no repositório.
* **Backend:** nenhum uso de `os.environ`, `os.getenv`, `python-dotenv` ou `BaseSettings`.
* **Frontend:** nenhuma variável `VITE_*` própria. O único acesso a env é
  `import.meta.env.DEV` (`src/router.tsx:30`), que é built-in do Vite.

Em vez de env vars, a configuração está **hardcoded** — é aqui que se mexe:

| O quê | Onde | Observação |
|---|---|---|
| Caminho do SQLite | `backend/app/database.py` (`DATABASE_DIR`/`DATABASE_PATH`) | Caminho absoluto `/workspace/backend` |
| URL base da API | `frontend/src/lib/api.ts:1` (`API_BASE_URL`) | `http://localhost:8000/api` |
| Origens CORS | `backend/app/main.py` (`allow_origins`) | Hoje `["*"]`, liberado para desenvolvimento |
| Portas e caminho dos serviços | `docker-compose.yml` | Espelha os valores acima: `8000`, `5173` e `working_dir: /workspace/backend`. Mudar qualquer um dos três **exige** mudar os dois lados |

> Ao introduzir a primeira variável de ambiente, crie um `.env.example` versionado com os
> **nomes** das chaves e adicione `.env` ao `.gitignore`. Nunca versione valores ou segredos.

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

### Dinheiro é `Decimal`, nunca `float`

**Decidido e implementado em 08/08/2026.** As 8 colunas monetárias usam o alias `MONEY =
Numeric(12, 2)` (`models.py`); os campos correspondentes em `schemas.py` são `Decimal`.

⚠️ **O que isso resolve, com precisão.** O SQLite **não** tem tipo decimal nativo: `NUMERIC`
é só afinidade e o valor é gravado como `REAL` (verificado — `typeof()` devolve `real`). O
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
| Saldo derivado do ledger | "Candidatos ao dia 5", item 1 |

### 0. "Fixas vs Variáveis" no Dashboard — removido, não implementado

**Decidido em 10/08/2026.** O bloco existia em `index.tsx` com valores inventados
(`R$ 2.205,90 / 71%` vs `R$ 914,60 / 29%`) e **nenhum dado correspondente na API**.
`DashboardSummary` não devolve a divisão fixa/variável das despesas.

Removido na integração do Dashboard. Calcular no front a partir de `recent_transactions`
seria errado — são 7 itens, não o mês.

Se voltar, é **fatia de backend**: dois `func.sum` sobre `Transaction.amount` filtrando por
`is_fixed`, dois campos novos em `DashboardSummary`, com decisão registrada e teste antes.
Não é urgente e não tem consumidor pedindo.

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

### 1. `current_balance` armazenado vs. saldo derivado do ledger

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
Verificado empiricamente (SQLAlchemy 2.0.51 / SQLite 3.40.1): o SQLite não tem tipo decimal
nativo, `NUMERIC` é só afinidade, e o valor é gravado como `REAL` — `typeof()` devolve
`real`. O que o SQLAlchemy faz é **converter float→Decimal na leitura, quantizando na escala
declarada**.

Ou seja, o que se ganha é **arredondamento na leitura absorvendo o epsilon**, não
armazenamento exato. Na prática resolve o problema observável — `0.30000000000000004` nunca
chega ao JSON nem a uma comparação — porque o erro de ponto flutuante é menor que meio
centavo e some no arredondamento para 2 casas. Exatidão real de armazenamento só viria com
**centavos como `Integer`** (verificado: `typeof=integer`, `SUM` exato), descartado por
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
