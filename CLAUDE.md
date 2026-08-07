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
  `test_categories_write.py`.
  * **`*_write.py` cobrem PATCH/DELETE (dia 4.1).** Todo teste que espera 404 assere também
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

### Backend (Na Jaula / Docker)
```bash
# Navegar até a pasta do backend
cd /workspace/backend

# Subir o servidor de desenvolvimento FastAPI
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0

# Rodar a suíte de testes automatizados (OBRIGATÓRIO MANTER VERDE)
.venv/bin/pytest

```

### Frontend (`/frontend`)
```bash
cd /workspace/frontend

npm run dev      # servidor de desenvolvimento (Vite, --host)
npm run build    # build de produção
npm run lint     # ESLint
npm run format   # Prettier
```

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
| `PATCH /api/installments/{id}` | 4.2 | ⬜ pendente — avanço de `current_installment` |

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
