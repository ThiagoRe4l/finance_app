# 🚀 Contexto e Diretrizes do Projeto: Finance App

Monorepo de controle financeiro pessoal composto por um backend em FastAPI e um frontend em React + Vite.

---

## 🗺️ Índice da documentação

**Reorganizado em 08/10/2026.** As seções saíram deste arquivo para `docs/`, movidas sem
reescrita. Comentários no código que dizem "ver X no CLAUDE.md" apontam para o título da
seção, que continua o mesmo — procure-o na tabela abaixo.

🔴 **Inegociável — dinheiro é `Decimal`, nunca `float`.** Antes de mexer em qualquer valor
monetário (model, schema, agregação, front), ler `docs/design-patterns.md` → "Dinheiro é
`Decimal`, nunca `float`".

🔴 **Inegociável — isolamento por dono.** Antes de escrever ou alterar qualquer consulta,
router ou migration que toque dado de usuário, ler `docs/multiusuario.md` → D-Tenant-3 e
D-Tenant-7.

**Carregado sempre** (reforma em curso; vira referência simples quando ela terminar):

@docs/mobile-first.md

**Referência — ler quando o gatilho aparecer:**

| Arquivo | Seção | Quando ler |
|---|---|---|
| `docs/integracao-frontend.md` | 🔌 Status da Integração Frontend ↔ Backend | antes de integrar ou alterar uma tela, ou uma chamada à API no front |
| `docs/design-patterns.md` | 🧩 Design Patterns do Projeto | antes de criar endpoint, model, schema, PATCH/DELETE ou agregação |
| `docs/multiusuario.md` | 👥 Multiusuário — dados por dono e despesa compartilhada | antes de tocar consulta, router, migration ou o contrato da despesa compartilhada |
| `docs/autenticacao.md` | 🔑 Autenticação — Google + allowlist de 4 e-mails | ao mexer em login, sessão, cookie, allowlist ou origens do Google |
| `docs/deploy-vercel-neon.md` | 🚢 Deploy — Vercel + Neon (Postgres) | ao mexer em `database.py`, pool, Alembic, CI de Postgres ou config da Vercel |
| `docs/variaveis-de-ambiente.md` | 🔐 Variáveis de Ambiente | ao criar ou ler variável de ambiente, ou ao lidar com `.env.local` |
| `docs/common-hurdles.md` | 🧯 Common Hurdles (Problemas Recorrentes) | antes de depurar erro de ambiente, deploy, CI ou barra final |
| `docs/backlog.md` | 🧭 Itens futuros + 🧭 Candidatos ao dia 5 | antes de propor trabalho novo ou escolher o próximo |
| `docs/seguranca-dependencias.md` | 🔒 Correções de segurança em dependências | ao atualizar dependência ou responder a CVE / `npm audit` |
| `docs/historico/deploy-railway.md` | 🗃️ Deploy — Railway (superado) | só como histórico das alternativas descartadas |

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
* **Estilização e Componentes:** Tailwind CSS + Shadcn/UI (`src/components/ui/`). Os dois
  gráficos (`CashFlow`, `MonthlyComparison`) são barras em `div`: o Recharts está instalado,
  mas só `components/ui/chart.tsx` o importa — nenhuma tela o usa (verificado em 07/10/2026).
* **Comunicação com API:** `fetch` centralizado em `src/lib/api.ts`
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

### Ver as telas localmente, sem tocar produção

🔴 **O `backend/.env.local` da pasta principal aponta para produção** (`DATABASE_URL`) e é
carregado sozinho, com `override=False`. Variável do ambiente vence o arquivo — por isso
`DATABASE_URL` e `SESSION_SECRET` são exportadas **uma vez por terminal**, antes de qualquer
comando do backend. Terminal novo esquece o `export`: sem ele, o `alembic` roda contra
produção.

```bash
cd backend            # Git Bash no Windows: venv (sem ponto); a .venv é a do container Linux
py -3.12 -m venv venv && source venv/Scripts/activate && pip install -r requirements-dev.txt  # 1ª vez
source venv/Scripts/activate                                                                # depois
export DATABASE_URL=sqlite:///./dev.db SESSION_SECRET=dev-local-only
echo "$DATABASE_URL"  # conferir ANTES do alembic: tem que sair o sqlite local
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# outro terminal — exige VITE_API_BASE_URL=/api no frontend/.env.local (abaixo)
cd frontend && npm run dev   # o proxy /api do Vite encaminha para localhost:8000 (D-Auth-7)
```

* **`VITE_API_BASE_URL=/api` no `frontend/.env.local`** (gitignorado). Sem ela, o front chama
  `http://localhost:8000/api` direto, fora do proxy, e o login falha com "Failed to fetch".
  A variável é lida na subida do Vite: depois de criá-la, reiniciar o `npm run dev`.
* `sqlite:///./dev.db` (três barras) é **relativo ao diretório atual**: os comandos rodam
  de dentro de `backend/`. `*.db` está no `.gitignore`.
* Banco novo é vazio, então a migration não pede `-x owner_email`. O primeiro login cria o
  usuário e o provisiona (D-Tenant-5).
* **`SESSION_SECRET` explícito de propósito.** Sem ele, vem o de produção do `.env.local`, e
  uma sessão emitida localmente sairia assinada com o segredo de produção.
* O login usa `GOOGLE_CLIENT_ID` e `AUTH_ALLOWED_EMAILS` do `.env.local`, o que exige
  `python-dotenv` (`requirements-dev.txt`).
* **Verificado em 07/10/2026**, numa cópia do backend sem `.env.local`: a migration criou o
  `dev.db` nas três revisões, `/health` deu 200 e `/api/accounts` deu 401.
* ✅ **Login local verificado em 10/10/2026 pelo usuário**, no Windows (Git Bash), em
  `http://localhost:8080`, com esta receita: `export` + `echo` antes do `alembic` e
  `VITE_API_BASE_URL=/api` no `frontend/.env.local`.

**Login de teste no celular — limitações** (regras do Google e do código; nada disto foi
testado num celular):

* O botão do Google só funciona numa origem cadastrada em "Origens JavaScript autorizadas", e o
  Google só aceita `http` para `localhost`. `http://<IP-do-PC>:<porta>` na rede local não
  pode ser cadastrado: o celular pela rede local **abre o app, mas não loga**.
* A porta cadastrada tem que ser a que o `npm run dev` imprimir: o preset da Lovable sobe em
  `8080`, o `docker compose` em `5173` (pendência antiga, passo 6 do Google Cloud Console).
  ✅ **Porta verificada em 08/10/2026 no Windows: `8080`.** (No container do agente o
  `npm run dev` não roda — `vite: exec: node.exe: not found`, o `node_modules` é do Windows.)
  A origem `http://localhost:8080` **precisa estar cadastrada** em "Origens JavaScript
  autorizadas" — está, desde que o login local funcionou em 10/10/2026 (acima).
* Caminhos que sobram: (1) o modo dispositivo do DevTools no PC, em `localhost` — é o caminho
  dos prints da reforma mobile; (2) no Android, `chrome://inspect` com *port forwarding* faz o
  `localhost:8080` do celular (a porta do `npm run dev`) chegar ao PC, com origem `localhost`
  — **não testado**;
  (3) produção no celular, que é real: qualquer escrita lá é dado real. Preview da Vercel não
  autentica (ver "Preview deployments").
* Em SQLite o cookie de sessão sai **sem** `Secure` (`routers/auth.py`, `secure=not local`),
  então `http://localhost` funciona.

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

Atualizada em 07/10/2026 (a anterior era da geração no Lovable).

```
frontend/src/
├── routes/              # Rotas TanStack Router (file-based)
│   ├── __root.tsx       # Shell HTML, QueryClient, Toaster, AuthGate
│   ├── index.tsx        # Dashboard / Visão Geral
│   ├── transacoes.tsx
│   ├── categorias.tsx
│   ├── parcelamentos.tsx
│   └── relatorios.tsx
├── components/
│   ├── auth/            # AuthGate, GoogleSignIn, UserMenu (logout)
│   ├── dashboard/       # CashFlow, CategoryBars, MetricCard, PageHeader, Sidebar, Transactions
│   ├── categories/      # formulário e exclusão de categoria
│   ├── installments/    # formulário de parcelamento
│   ├── transactions/    # formulário e exclusão de transação
│   ├── shared/          # CategorySelect
│   └── ui/              # Shadcn/UI — 46 arquivos, não editar à mão
├── lib/                 # funções puras, cada uma com *.test.ts ao lado
│   ├── api.ts           # Cliente HTTP centralizado
│   └── utils.ts         # Helper `cn` (clsx + tailwind-merge)
├── hooks/
│   └── use-mobile.tsx
├── router.tsx           # Configuração do router
├── routeTree.gen.ts     # GERADO automaticamente — nunca editar
└── styles.css
```

Não há mais mocks: as 5 telas consomem a API (ver "Status da Integração"). O
`ui/sidebar (1).tsx`, artefato com nome duplicado, não existe mais.

---

## 📐 Processo: decisão de arquitetura **antes** da implementação

**Compromisso assumido. Vale para todo trabalho daqui em diante.**

Toda feature nova que introduza **modelo, endpoint, dependência ou padrão novo** tem sua
decisão de arquitetura registrada **antes** de a implementação ser pedida, no arquivo de
tópico em `docs/` que "Onde escrever" (abaixo) indica.
Documentação escrita depois do código não conta como decisão registrada — conta como relato.

**Registro mínimo: 3 a 5 linhas, não um RFC.**

1. O que se decidiu.
2. Qual alternativa foi descartada e por quê.
3. O impacto no contrato com o frontend (se houver).

**Onde escrever:** cada tipo de decisão vai no arquivo de tópico em `docs/`:

* padrão de código ou de backend (model, schema, endpoint, agregação) →
  `docs/design-patterns.md` ("🧩 Design Patterns do Projeto");
* mudança de contrato de API ou integração de tela → `docs/integracao-frontend.md`
  ("🔌 Status da Integração Frontend ↔ Backend");
* dono por registro, isolamento ou despesa compartilhada → `docs/multiusuario.md`;
* autenticação, sessão ou allowlist → `docs/autenticacao.md`;
* deploy, banco, pool ou migration → `docs/deploy-vercel-neon.md`;
* variável de ambiente → `docs/variaveis-de-ambiente.md`;
* layout e reforma mobile → `docs/mobile-first.md`;
* item em aberto, sem decisão → `docs/backlog.md`;
* correção de segurança em dependência → `docs/seguranca-dependencias.md`;
* problema recorrente já resolvido → `docs/common-hurdles.md`.

Assunto que não cabe em nenhum: arquivo novo em `docs/` e uma linha no índice deste arquivo.

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

2. **Migration, não reset.** Mudança de schema é uma revisão nova do Alembic (D-Vercel-6), e a
   suíte já constrói o schema por ela — divergência entre migration e models vira teste
   vermelho. Para atualizar o `database.db` local:
   ```bash
   cd /workspace/backend
   .venv/bin/alembic -x owner_email=<seu e-mail> upgrade head   # o -x só é exigido com dado
   ```

   > ⚠️ **Atualizado em 03/10/2026.** Este passo mandava apagar o `database.db` e rodar
   > `init_db.py`. As duas coisas deixaram de valer: há Alembic desde o pivô, e o `init_db.py`
   > saiu com a D-Tenant-5. Em produção, migration com dado real segue o roteiro de backup da
   > D-Tenant-6 — nunca "resetar e recomeçar".

3. **Regenerar o `openapi.json`.** O arquivo é versionado, então não basta o `/docs` em
   runtime — mas **nunca** edite à mão:
   ```bash
   cd /workspace/backend
   PYTHONPATH=/workspace/backend .venv/bin/python -c "import json; from app.main import app; json.dump(app.openapi(), open('openapi.json','w',encoding='utf-8'), indent=2, ensure_ascii=False)"
   ```
   Confira também o `/docs` com o servidor no ar (`http://localhost:8000/docs`).

4. **Atualizar a seção "Status da Integração"** deste arquivo ao integrar uma tela.

---

