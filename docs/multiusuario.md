## 👥 Multiusuário — dados por dono e despesa compartilhada

**Decidido em 03/10/2026, antes da implementação.** Testes vermelhos aprovados em 03/10/2026.
**As quatro fatias implementadas** (ver "o que foi entregue" no fim da seção). ✅ **Em produção
desde 06/10/2026**, com o gate de deploy da fatia 1 cumprido. O app deixou de ser de usuário
único: cada e-mail da allowlist tem os próprios dados. Ver "Produção (06/10/2026)" abaixo.

Até aqui a autenticação era só um portão: todo e-mail da allowlist via **os mesmos** dados
(uma `Account`, um conjunto de categorias). Esta fatia introduz, pela primeira vez, o conceito
de **dono por registro**, e sobre ele um mecanismo de despesa dividida entre usuários.

🔴 **O risco de maior severidade é um usuário ver dado de outro** por um endpoint que esqueceu
de filtrar. É ele que dita a forma de toda a parte de isolamento: o filtro é por construção
(D-Tenant-3) e a verificação é por varredura (D-Tenant-7), não endpoint a endpoint.

Quatro fatias, nesta ordem: **(1)** `users` + migration → **(2)** escopo por usuário + varredura
→ **(3)** provisionamento/login → **(4)** despesa compartilhada.

### Defeitos presentes que esta fatia fecha

Encontrados no mapeamento; hoje são "inofensivos" só porque todos veem tudo de qualquer jeito.

* **Nome único global** em `accounts`, `categories` e `investments`. O segundo usuário a entrar
  não conseguiria receber as categorias padrão — "Moradia" já existe.
* **PATCH/DELETE buscam só por id.** Qualquer usuário altera dado de outro trocando o número
  na URL.
* **POST aceita FK de outro usuário.** `account_id`/`category_id` são conferidos por
  *existência*, não por dono.
* **Funções chamadas direto, sem `Depends`:** `reports` → `get_dashboard_summary(db)` →
  `list_categories(db)`. Filtro passado como parâmetro injetado se perderia aqui.
* **O `total_balance` soma `Transaction` sem passar por `Account`.** Filtro só em `Account` não
  o alcançaria.

### D-Tenant-1: tabela `users` leve — identidade, não autorização

`users(id, email)`, e-mail único e sempre minúsculo.

**Alternativa descartada: e-mail direto em cada tabela.** A despesa compartilhada precisa de
FK real para participante; a linha em `users` é o marcador natural de "já provisionado"
(D-Tenant-5); e um e-mail espalhado em 5 tabelas é 5 lugares para divergir.

⚠️ **`users` não substitui a allowlist.** Estar na tabela não dá acesso a nada; a allowlist
continua reconferida a cada requisição (D-Auth-2) e continua sendo o que revoga.

### D-Tenant-2: `owner_id` nas 5 tabelas, com FK composta

`owner_id NOT NULL → users.id ON DELETE RESTRICT` em `accounts`, `categories`, `investments`,
`installments` e `transactions`. `investment_history` **não** ganha coluna: é filha com CASCADE
e herda o dono pelo pai.

* **`UNIQUE(owner_id, name)`** substitui o `UNIQUE(name)` global nas três tabelas que o têm.
* **FK composta** `(account_id, owner_id) → accounts(id, owner_id)` e
  `(category_id, owner_id) → categories(id, owner_id)`, em `transactions` e em `installments`.
  Exige `UNIQUE(id, owner_id)` nos pais. Com isso o **banco** recusa transação de A na conta de
  B — o terceiro defeito acima fica impossível por construção, em vez de depender de cada router
  lembrar. Mesmo raciocínio do saldo derivado.

⚠️ **`installment_id` fica FK simples.** Uma FK composta com `ON DELETE SET NULL` anularia
**também** `owner_id`, que é `NOT NULL`. O Postgres 15+ aceita `SET NULL (installment_id)`, mas
o SQLite não, e a D-Vercel-1 exige o mesmo schema nos dois. A proteção ali é o filtro
(D-Tenant-3): o parcelamento de outro dono não é encontrado, e a vinculação dá 404.

**Alternativa descartada: `owner_id` só nas raízes** (contas, categorias, investimentos), com
transações e parcelamentos herdando pela conta. Toda consulta de agregação precisaria de join
até a conta só para filtrar — e o quinto defeito acima é exatamente uma consulta que não faz
esse join.

### D-Tenant-3: o filtro é automático, na sessão do banco

Uma dependency `owned_db` (em `app/tenancy.py`, junto de `current_owner`) recebe o `db` de
`get_db` e o usuário de `current_owner`, e marca a
sessão com o dono. Um evento `do_orm_execute` aplica `with_loader_criteria(<modelos com
owner_id>, owner_id == dono)` em todo `SELECT` dessa sessão. Os routers trocam
`Depends(get_db)` por `Depends(owned_db)`; na criação, `owner_id` vem do servidor, **nunca**
do payload.

**Verificado empiricamente antes de decidir**, com o SQLAlchemy do projeto e os formatos de
consulta que o código usa hoje (script descartável, fora do repositório):

| Formato | SQL gerado | Vazou? |
|---|---|---|
| `sum` de coluna (dashboard) | `WHERE t.owner_id = ?` | não |
| `sum` com `CASE` (`ledger_delta`) | `WHERE t.owner_id = ?` | não |
| `outerjoin` com data no `ON` (`_aggregated_rows`) | `LEFT JOIN t ON … AND t.owner_id = ?` + `WHERE c.owner_id = ?` | não |
| `join` categoria + transação (`top_categories`) | `JOIN t ON … AND t.owner_id = ?` | não |
| `select()` 2.0 | `WHERE t.owner_id = ?` | não |
| busca por id de outro dono | `WHERE t.id = ? AND t.owner_id = ?` → `None` | não |

**O filtro decide ON × WHERE sozinho, e decide certo**: na tabela do `outerjoin` vai para o
`ON`, na principal para o `WHERE`. Categoria sem transação no mês continua aparecendo zerada —
o cuidado registrado em `_aggregated_rows` é preservado.

⚠️ **Três ressalvas, registradas de propósito:**

1. **Escrita não passa pelo filtro** — ele só age em `SELECT`. Mitigado por três camadas:
   `owner_id` preenchido pelo servidor, FK composta (D-Tenant-2), e toda edição/exclusão
   carregando o objeto antes (o carregamento passa pelo filtro). O projeto não usa
   `UPDATE`/`DELETE` em massa — se passar a usar, essa linha não é filtrada.
2. **Mapa de identidade da sessão.** `session.get` devolve sem SQL um objeto já carregado na
   mesma sessão. Não morde porque a sessão vive uma requisição e só carrega o que passou pelo
   filtro — mas é a razão de a fixture `client_as` abrir **uma sessão por requisição**, como
   produção.
3. **O grupo da despesa compartilhada não é "do dono"** — a visibilidade é "sou participante".
   Fica fora do filtro automático, com regra explícita (D-Shared-9), e é coberto pela varredura.

⚠️ **O escopo nunca vai dentro de `get_db`.** A suíte sobrescreve `get_db`; se o escopo
morasse lá, o override o removeria junto.

**Alternativas descartadas:** RLS do Postgres (não existe no SQLite — a suíte local ficaria cega
a ele, contra a D-Vercel-1); filtro explícito em cada consulta (é exatamente o "endpoint que
esqueceu de filtrar" que esta fatia existe para impedir).

### D-Tenant-4: recurso de outro usuário é 404, com o mesmo `detail` do inexistente

403 confirmaria que o id existe. O `detail` idêntico é o que torna as duas situações
indistinguíveis — e o teste assere o `detail`, pela mesma razão registrada nos `*_write.py`.

### D-Tenant-5: provisionamento ao criar o usuário, dentro da resolução da sessão

Uma dependency `current_owner` (sobre `current_user`, que continua devolvendo o e-mail) resolve a
linha de `users`. **Se a linha não existe, cria e provisiona:** "Conta Principal" com saldo
inicial **R$ 0,00** e as 10 categorias padrão, donas do novo usuário.

* **Só depois da allowlist.** E-mail revogado com cookie válido leva 401 e **não** cria linha.
* **Por que na resolução e não só no login:** as sessões de 30 dias emitidas antes da migration
  nunca passam pelo login de novo.
* **Usuário pré-existente nunca é provisionado** — o gatilho é *criar a linha*, não "não ter
  conta". É o que impede o dono migrado (D-Tenant-6) de ganhar uma segunda "Conta Principal".
* Corrida de duas primeiras requisições simultâneas: `UNIQUE(email)` + nova leitura no conflito.
  Não testável no SQLite em memória; registrado.
* `GET /api/auth/me` passa a usar `current_owner` — é a primeira chamada que o front faz.

**`init_db.py` e `test_seed.py` saem.** O seed global não tem dono a quem pertencer; o
provisionamento por usuário é o substituto, com teste próprio.

### D-Tenant-6: migration num passo só, com o dono passado na hora

Uma revisão do Alembic, **sem expand/contract** (decidido em 03/10/2026): cria `users`, adiciona
`owner_id` nulo, preenche, torna `NOT NULL`, troca os índices únicos e cria as FKs compostas.

* **Os dados atuais são de uma pessoa só** (confirmado) e vão todos para um dono.
* **O e-mail não fica no repositório:** `alembic -x owner_email=... upgrade head`, normalizado
  em minúsculo. Mesmo motivo de a allowlist não ser hardcoded (D-Auth-2).
* **Fail closed:** tabelas com dado e sem `owner_email` → a migration **levanta**. Em banco vazio
  (a suíte, o dev novo) o argumento é dispensável.
* **`downgrade` só com um dono.** Com dois, os nomes podem colidir no `UNIQUE(name)` global —
  levanta em vez de perder dado.
* ⚠️ **Janela aceita:** entre a migration e o deploy do código novo, o código antigo insere sem
  `owner_id` e recebe 500. Aceito em troca de um passo só.

**Backup antes de aplicar, em produção — nesta ordem:**

1. Branch do Neon (snapshot instantâneo) **e** `pg_dump`.
2. **Restaurar** o dump num branch descartável e conferir. Backup nunca restaurado não é backup
   (D-Deploy-2).
3. **Ensaiar a migration num branch do Neon** com cópia do dado real. É o único teste da
   migração de dados contra Postgres com dado real — o teste da suíte roda em SQLite.
4. Contagem de linhas por tabela antes e depois.

### D-Tenant-7: a varredura de isolamento

`tests/test_tenant_isolation.py`, no espírito de `test_auth_routes.py`:

1. **Diferencial nas leituras.** B tira um retrato de **toda** rota GET sem parâmetro; A cria um
   conjunto completo de dados; o retrato de B tem que sair **idêntico**. Pega vazamento em
   agregado (`total_balance`, `monthly_flow`, `top_categories`), que busca por valor sentinela
   não pegaria — uma soma vazada não contém o sentinela, contém o sentinela somado a outra
   coisa.
2. **Toda rota com `{id}`**, todo método: B usa o id de A → 404 com `detail` real, e o retrato
   de A não muda. Parâmetro de rota fora do mapa conhecido **falha o teste**.
3. **Todo campo `*_id` em corpo de POST/PATCH**, descoberto pelo schema: B envia o id de A → 404.
   Campo novo não coberto falha o teste.
4. **Estrutural:** todo model financeiro tem `owner_id`, ou consta numa lista explícita de
   exceções com motivo.
5. **Guarda contra varredura vazia**, como `test_the_behavioural_sweep_actually_covered_something`.

### D-Tenant-8: fixtures

* **`client_as(email)`** — cliente com **cookie de sessão real** (`issue_session`), `current_user`
  e `current_owner` reais, e **uma sessão de banco por requisição**. Só `get_db` é substituído. É
  o cliente de toda a varredura e do provisionamento.
* **`client`/`fk_client`** passam a sobrescrever `current_owner` com um usuário **sem
  provisionamento** — senão as 10 categorias padrão colidiriam com cada
  `create_category(client, "Alimentação")` dos 387 testes. Mudança feita na implementação.
* Testes que inserem linha direto no banco (`test_fk_cascade.py`, `test_category_fk.py`,
  `test_derived_balance.py`) ganham `owner_id` na implementação — ajuste mecânico, sem mudança de
  asserção.

### D-Shared-1: cada participante debita só a própria parte

R$ 100 divididos com 1 pessoa = SAÍDA de R$ 50 no ledger de cada um. **Sem registrar quem pagou e
sem dívida entre participantes** (confirmado em 02/10/2026).

⚠️ **Consequência aceita:** o saldo de quem pagou deixa de bater com o extrato do banco (app −50,
banco −100), e o de quem não pagou mostra −50 que ainda não saiu. Nesta modalidade
`current_balance` mede "custo meu", não "dinheiro na conta".

**Descartadas:** pagador debita o total (saldo segue o caixa, mas saldo e despesa divergem);
rastrear pagador e dívida, no estilo Splitwise (entidade e fluxo de acerto novos).

### D-Shared-2: N transações ligadas por um grupo

`shared_expenses(id, creator_id → users RESTRICT, title, total_amount MONEY, date)` e
`transactions.shared_expense_id → shared_expenses ON DELETE CASCADE`, nulo para transação comum.
Cada parte é **uma SAÍDA comum**, dona o participante, na conta e na categoria dele.

**O que decide:** saldo derivado, `spent`, `monthly_flow`, `top_categories` e o filtro de dono
funcionam **sem mudança nenhuma**. A soma das partes = total é garantida pelo servidor e por
teste com `Decimal` exato, não pelo banco.

**Descartada: entidade "despesa" com N "partes"** fora de `transactions`. `ledger_delta` e as 6
agregações passariam a somar duas tabelas, cada uma com o próprio filtro — a duplicação de regra
que `account_balance.py` existe para impedir.

### D-Shared-3: divisão sempre igualitária

Decisão final (reconfirmada em 03/10/2026). Parte = total ÷ N, truncada no centavo; **o centavo
que sobra fica com o criador** (R$ 100 ÷ 3 → criador R$ 33,34, os outros R$ 33,33). Parte menor
que R$ 0,01 é **422**. Sem valor nem percentual por pessoa na v1.

### D-Shared-4: participantes, criador e consentimento

* **O criador sempre participa.** `participants` lista os **outros**; incluir a si mesmo é 400.
* **Universo = allowlist ∩ quem já tem linha em `users`**, menos o próprio. Sem sistema de
  convite. Quem nunca logou não tem conta para receber a parte, e criar dado para quem nunca
  entrou foi descartado. `GET /api/participants` expõe essa lista — o que **expõe os e-mails da
  allowlist** aos outros usuários; aceito, é o mecanismo de seleção.
* E-mail fora desse universo → **404**, como FK que não resolve.
* **Sem aceite na v1:** a parte entra direto no ledger do participante, que vê e pode
  recategorizar, mas não recusa.

### D-Shared-5: em qual conta e categoria cai a parte do participante

* **Conta:** a primeira dele (menor id), sem seletor — a mesma debt de "`account_id` sem seletor".
* **Categoria:** a de **mesmo nome exato** entre as categorias dele; se não houver, uma categoria
  **"Compartilhado"**, criada sob demanda. Ele pode trocar a categoria da própria parte depois.

### D-Shared-6: o que se pode fazer com uma parte pelas rotas de transação

* **`category_id` é livre**, pelo dono da parte (categoria é dele).
* **`title`, `amount`, `date`, `type`, `is_fixed`, `installment_id` → 409.** Mexer neles
  quebraria a soma do grupo; quem altera é o grupo.
* **`DELETE /transactions/{id}` de uma parte → 409, para todos, inclusive o criador.** A exclusão
  é do grupo.

409 pela mesma natureza do bloqueio de parcelamento com transação lançada: escrita bloqueada por
uma linha relacionada.

### D-Shared-7: escopo da v1

Só SAÍDA; sem parcelamento; sem `is_fixed`. O payload não tem esses campos e é
`extra="forbid"` — enviá-los é 422.

### D-Shared-8: edição e exclusão do grupo

* **Só o criador** edita e exclui. Participante não criador → **403** (ele vê o grupo, então 404
  seria mentira). Não participante → **404** (D-Tenant-4).
* **Editar `amount` recalcula a parte de todos.** Editar `participants` cria/remove as partes e
  recalcula. `title`/`date` propagam para todas as partes.
* 🔴 **Editar `amount` ou `participants` quando isso afetaria alguém fora da allowlist → 409**
  (decidido em 03/10/2026). Mudar o ledger de quem já saiu, sem ele poder ver, é o caso bloqueado.
  `title`/`date` não estão no bloqueio.
* **Excluir é sempre permitido** e remove a parte de todos, inclusive de quem saiu da allowlist.
* ⚠️ **Consequência aceita:** criador que sai da allowlist deixa o grupo **congelado** — ninguém
  mais edita nem exclui. As partes continuam nos ledgers.

### D-Shared-9: quem vê o grupo

Todos os participantes veem o grupo inteiro: total, criador e a parte de cada um, com e-mail. É a
**única exceção deliberada** ao isolamento, e por isso tem regra explícita (fora do filtro
automático) e cobertura própria: não participante não vê nada, nem por lista nem por id.

### Contrato novo com o frontend

| Endpoint | Observação |
|---|---|
| `GET /api/participants` | `[{"email"}]` — D-Shared-4 |
| `POST /api/shared-expenses` | `{title, amount, date, account_id, category_id, participants: [email]}` → 201 |
| `GET /api/shared-expenses` | grupos de que participo, inclusive os que criei |
| `GET /api/shared-expenses/{id}` | 404 para não participante |
| `PATCH /api/shared-expenses/{id}` | `{title?, amount?, date?, participants?}`, `extra="forbid"` |
| `DELETE /api/shared-expenses/{id}` | 204 |

Resposta do grupo: `{id, title, total_amount, date, creator, parts: [{email, amount}]}`.
`TransactionResponse` ganha `shared_expense_id` (nulo para transação comum).

Convenção de status estendida: **403** — o recurso é visível para você, mas a ação é só do criador.

🔴 **O frontend deste contrato nasce mobile-first** — restrição registrada em 07/10/2026, ver
"📱 Mobile-first".

### Testes desta fatia

Estado na entrega dos vermelhos (03/10/2026), sobre uma suíte de base com 387 verdes:

| Fatia | Arquivo | Vermelhos | ✅ já passam (rotulados) |
|---|---|---|---|
| 1 | `tests/test_tenant_schema.py` | 29 | 1 — regressão |
| 2 | `tests/test_tenant_isolation.py` | 8 | 4 — guardas e regressão |
| 3 | `tests/test_provisioning.py` | 9 | 0 |
| 4 | `tests/test_shared_expenses.py` | 56 | 0 |

* **Fatias 1–3 falham pelo motivo certo**: tabela/coluna ausente, e — na 2 — **vazamento real**
  medido (B lê os dados de A em 8 rotas, edita a categoria de A, lança na conta de A).
* ⚠️ **Fatia 4 ainda não foi vista falhando pelo motivo certo.** 55 dos 56 param na guarda de
  pré-requisito da fixture `people` (sem provisionamento e isolamento não há conta própria), e o
  restante em `no such table: users`. **Antes de implementar a fatia 4**, rodar o arquivo com 1–3
  verdes e conferir que cada um falha pela rota/regra ausente — e sinalizar qualquer um que passe.
* Dois testes da fatia 1 foram **falso verde** na primeira versão (`upgrade head` sem migration
  nova não faz nada, e "nada mudou" é trivialmente verdade). Ganharam a pré-condição
  `_assert_migrated`.
* A fixture `client_as` foi adicionada ao `conftest.py` já nesta etapa — funciona com o código de
  hoje, e é o que permitiu medir o vazamento real em vez de falhar por fixture inexistente.

### Fatia 1 — o que foi entregue (03/10/2026)

Migration `b7d41c2e9a05_owner_per_row.py`, `User` e `owner_id` nos models, e **suíte com 413
verdes** (387 − 4 de `test_seed.py` + 30 de `test_tenant_schema.py`). `openapi.json`
regenerado sem diferença: a fatia não muda contrato.

⚠️ **A fatia trouxe junto o carimbo do dono na escrita, que estava planejado para a 2.** Com
`owner_id NOT NULL`, todo POST que não preenche o dono quebra — a suíte inteira ficaria
vermelha entre as fatias. Então já entraram: `app/tenancy.py` com `current_owner` (cria a linha
de `users`, **sem** provisionar) e `owned_db` (marca a sessão), os 7 routers usando `owned_db`, e
os 5 pontos de criação carimbando `owner_id`. **O filtro de leitura não entrou** — continua sendo
a fatia 2, e até ela a leitura ainda vê tudo.

Também antecipado: a remoção de `init_db.py` e `test_seed.py` (o seed não sobrevive a
`owner_id NOT NULL`), com `VERCEL.md` e o passo 2 do Checklist atualizados.

**Como a migration acha as FKs antigas.** As da migration inicial não têm nome. O modo batch do
SQLite as reconstrói com a convenção `<tabela>_<coluna>_fkey` — o nome que o Postgres dá por
default — e assim um único `drop_constraint` serve aos dois bancos.

🔴 **Nada desta fatia rodou contra Postgres** quando ela foi entregue (03/10/2026). *(Superado: o
CI do PR rodou as migrations em Postgres 16 e a produção foi migrada em 06/10/2026 — ver
"Produção (06/10/2026)" abaixo.)* Não há Postgres neste container. O nome
`transactions_account_id_fkey` é o default documentado do Postgres, não um nome observado no Neon.
A primeira verificação real é o job `backend-postgres` do CI (que constrói o schema pela
migration), e a segunda é o ensaio num branch do Neon com dado real — **os dois antes de aplicar
em produção**.

✅ **Nomes observados no Neon real em 06/10/2026.** No ensaio, as 5 FKs antigas seguem
`<tabela>_<coluna>_fkey`, vistas na seção `[fks]` do `verify_db`. O default documentado se
confirmou no banco de verdade; a conferência continua obrigatória a cada execução, inclusive
em produção.

✅ **Gate de deploy (decidido em 03/10/2026) — cumprido em 06/10/2026:**

1. **Nada das fatias 1 e 2 vai para produção separado.** "Dono existe mas filtro não" é um
   estado em que cada usuário ainda vê o dado dos outros; só se resolve com as duas juntas.
2. **Job de Postgres do CI verde** antes de qualquer outra coisa.
3. **Ensaio no branch do Neon com dado real**, e nele **ver** os nomes das FKs antigas
   (`\d transactions`, `\d installments`) antes de rodar a migration. O padrão
   `<tabela>_<coluna>_fkey` é o default documentado do Postgres — **não** se assume sem ver no
   banco de verdade. *(Visto no Neon no ensaio de 06/10/2026; em produção, conferir de novo.)*

**Runbook e verificação (escritos em 04/10/2026, aprovados em 05/10).** O passo a passo
está em `backend/VERCEL.md` → "Runbook — migration multiusuário": backup (snapshot + `pg_dump`),
restore exercitado num banco vazio com `diff` contra produção, ensaio num branch com os nomes das
FKs conferidos, migration, login simulado como o dono, ensaio do rollback, produção e rollback de
produção.

**Ensaio de 06/10/2026**, no Windows, num checkout limpo feito pelo Git do Windows em `8209c9f`,
com Python 3.12, contra um branch do Neon com cópia de produção: `upgrade`, `downgrade` e novo
`upgrade` deram `diff` vazio contra os retratos do `verify_db`, e o login simulado deu `200` em
tudo, com `total_balance` igual à soma dos saldos. Três ressalvas, registradas como estão:

* **A cópia de produção estava sem movimento** (1 conta, 10 categorias, nenhuma transação nem
  parcelamento), e **a semente foi manual**, pelo SQL Editor do Neon: 1 parcelamento e 4
  transações (ENTRADA, SAÍDA fixa, SAÍDA de 33,33 e SAÍDA vinculada ao parcelamento). O retrato
  "antes" teve `installments: 1`, `transactions: 4` e saldo `3166.67`, então o preenchimento de
  `owner_id` e as FKs compostas **foram** exercitados. O runbook agora automatiza a semente no
  passo 3.1. O escape `U&'SA\00CDDA'` foi validado no Postgres do Neon em 06/10/2026
  (`length = 5`). O `INSERT` completo continua rodado só aqui num SQLite na revisão inicial,
  com o escape trocado pelo literal: ledger +859,87 conferido à mão, `linhas_sem_dono: 0` e FKs
  compostas depois do upgrade, dinheiro igual no ciclo.
* **A restauração do dump foi pulada**, por não haver dado real: o dump foi gerado e a listagem
  conferida, mas não restaurado. Com dado real, a restauração volta a valer.
* **O `alembic upgrade` só rodou do Windows depois do `alembic.ini` em ASCII** (seção própria,
  abaixo), editado à mão na checkout do ensaio; a correção no repositório é o commit `d055b9a`.
  O runbook ganhou os pré-requisitos do Windows que o ensaio mostrou: Git Bash, Python
  3.12 explícito (o padrão da máquina era 3.14), `pg_dump`/`pg_restore`/`psql` instalados à parte
  e postos no PATH, checkout pelo Git do Windows (a worktree do container aponta para
  `/workspace/...`) e a proibição de `git worktree prune` nos dois lados.

**Produção (06/10/2026).** Migrada do Windows, numa checkout limpa feita pelo Git do Windows em
`4624502`, com Python 3.12, no endpoint direto do Neon. O `alembic -x owner_email=<email> upgrade head`
passou nas duas revisões (`96fdc067f386 -> b7d41c2e9a05 -> d3a8f1e6c720`), e o
`verify_db --expect-owner` deu `exit=0`, `dono_esperado: OK` e `linhas_sem_dono: 0`. Produção
tinha 1 conta, 10 categorias e 1 transação de teste (4500,00): contagens e saldo (`4500.00`)
idênticos no `diff`, mudando só a revisão, as tabelas novas (`users: 1`, `shared_expenses: 0`,
`shared_expense_participants: 0`) e as FKs.

* **Backup:** branch `pre-multitenant` no Neon e `pg_dump` local (20,9 KB, listagem conferida).
  ⚠️ **A restauração não foi exercitada**, nem no ensaio nem em produção.
* **Validação:** login do dono, uma escrita, e login com a conta da esposa, que abriu **vazia** —
  isolamento confirmado com dois usuários reais. A janela entre a migration e o deploy
  (D-Tenant-6) não teve incidente.
* **Lições da execução** foram para o runbook, cada uma com o sintoma: colar a URL duas vezes
  (`invalid channel_binding value`), `read -p` imprimindo a URL, `PROD_DIRECT_URL` só no
  comando e nunca exportada, rodar da checkout limpa e não da pasta principal (que tem
  `.env.local` de produção e não tem `scripts/`), e conferir o `OWNER_EMAIL` contra a allowlist
  com uma saída só `NA`/`FORA`.

⬜ **Continua pendente, fora deste gate:**

* **O frontend ainda não consome o contrato novo** (despesa compartilhada, participantes, o 409
  das partes) — ver "Contrato novo com o frontend".
* O layout mobile — decidido em 07/10/2026, em implementação por fatias (ver "📱 Mobile-first").
* O pin de `ubuntu-24.04` no CI.
* `DELETE /api/installments/{id}` (ver "Fatia futura" em "Escrita pela UI").
* O restante do backlog ("Itens futuros", débitos registrados nas seções próprias).

`backend/scripts/verify_db.py` é o retrato **somente leitura** de antes e depois: revisão,
contagens, soma dos saldos iniciais, saldo derivado por conta, FKs com nome e `ondelete`, linhas
por dono. Somente leitura por construção (`PRAGMA query_only` / `SET TRANSACTION READ ONLY`;
mutação sem o PRAGMA → teste vermelho), sem credencial na saída (alvo como host/banco, erros por
`scrub`), e-mails mascarados. 13 testes em `tests/test_verify_db.py`, escritos antes.

**Lacunas do CI, apontadas e não fechadas:**

| Lacuna | Consequência | Quem cobre hoje |
|---|---|---|
| ~~A branch **nunca foi publicada**~~ — o workflow dispara em `pull_request` e em push para `main`, não em push de outra branch | **Fechada:** o PR foi aberto e o CI rodou nele, por último em `4624502` | abrir o PR (passo 0.1 do runbook) |
| ~~O job de Postgres roda as migrations só em banco **vazio**~~ | **Fechada em 05/10/2026**, confirmada no CI do PR em `4624502` (Postgres 16.15, nenhum `skipped` no passo, 519 passed): no job de Postgres, a fixture `migration_engine` cria um banco Postgres próprio por teste, e todo `test_tenant_schema.py` de migration — preenchimento, recusa sem `-x`, recusa fora da allowlist — roda no motor de produção, num passo nomeado do workflow | CI + o ensaio no branch do Neon |
| ~~`downgrade` nunca roda em Postgres~~ | **Fechada junto**: os dois testes de `downgrade` usam a mesma fixture, e ambos deram `PASSED` no log do passo "Migration com dado contra Postgres real" (`4624502`). O CI exercita o downgrade com dado de teste; o ensaio é a única vez com cópia do dado real | CI + passo 3.7 do runbook |
| O CI usa `postgres:16`; o Neon pode ser outra versão | divergência de motor | passo 0.2 do runbook |

O que o job de Postgres **cobre**: `96fdc → b7d4 → d3a8` em sequência, inclusive o
`drop_constraint` das FKs antigas pelos nomes `<tabela>_<coluna>_fkey`, num schema criado pela
migration inicial em Postgres 16; e a suíte inteira sobre esse schema. Se os nomes estivessem
errados, o job quebraria. O que ele não prova é que o banco do Neon foi criado do mesmo jeito,
e por isso o `\d` do ensaio continua obrigatório. *(No Neon, os nomes foram observados no ensaio
de 06/10/2026 e batem.)*

**E-mail do dono errado no `-x owner_email`**, verificado num SQLite descartável: o dono loga com
o e-mail real, o `current_owner` cria um usuário novo e o provisiona, e ele vê o app **vazio**
(conta R$ 0,00, 10 categorias), com o dado real preso ao usuário 1. Nada se perde. O runbook
confere isso em três pontos (0.4, 3.6 e 4.8) e traz o SQL de correção, que foi testado no mesmo
cenário. ⚠️ A primeira versão do `--expect-owner` dava **OK** nesse caso, porque o e-mail existia,
só que no usuário novo. Agora o e-mail esperado tem que ser o do **dono migrado**, que é o usuário
de menor id; e a linha dele é marcada na saída, porque a máscara iguala `dono@` e `dono.real@`.
Os dois testes foram escritos antes da correção.

**Reforço na migration (05/10/2026): `-x owner_email` tem que estar em `AUTH_ALLOWED_EMAILS`.**
Variável definida, mesmo que vazia: e-mail fora dela faz a migration **recusar antes de qualquer
DDL**. Vazia é a allowlist que não deixa ninguém entrar (D-Auth-2), então também recusa. Variável
ausente: a migration **não bloqueia** e emite `UserWarning` dizendo que o e-mail não foi
conferido. Para o runbook, esse aviso é PARE. A comparação está inline na migration, sem importar
`app.settings`, porque migration que depende do código da aplicação quebra quando esse código
muda. Tem 5 testes escritos antes: 3 vermelhos e 2 de regressão rotulados. A mutação "sem a
checagem" deixa os 3 vermelhos.

⚠️ **O que o Alembic enxerga.** O `env.py` importa `app.settings`, que carrega o
`backend/.env.local` (`override=False`). O `.env.local` do checkout principal tem
`DATABASE_URL` (produção) e `AUTH_ALLOWED_EMAILS`; verifiquei só os nomes das chaves, sem ler os
valores. Sem export no shell, a migration compara o dono com a lista do arquivo, que pode estar
desatualizada em relação à Vercel. Por isso o runbook exporta a allowlist da Vercel e põe
`DATABASE_URL` explícita em todo comando.

Os testes das fatias seguintes que ficaram verdes com esta entrega:

| Teste | Por quê |
|---|---|
| `test_every_table_has_an_owner_or_is_a_declared_exception` | schema desta fatia — legítimo |
| `test_every_data_route_uses_the_owner_scoped_session` | `owned_db` antecipado — legítimo, mas é só a parte **estrutural**; o comportamental da varredura segue vermelho |
| `test_the_global_seed_script_is_gone` | remoção antecipada — legítimo |
| `test_revoked_email_is_not_provisioned` | `current_owner` vem depois de `current_user` — legítimo |
| ⚠️ `test_preexisting_user_is_never_provisioned` | **falso verde**: passa porque ninguém é provisionado ainda. Só vale junto dos testes de provisionamento, que seguem vermelhos |

### Fatia 2 — o que foi entregue (03/10/2026)

O evento `_scope_to_owner` em `app/tenancy.py`: todo `SELECT` de uma sessão marcada por
`owned_db` recebe `with_loader_criteria(owner_id == dono)` nos 5 models com dono. **Nenhum
router mudou** — os três defeitos de escrita do mapeamento (PATCH/DELETE por id, FK de outro
dono no corpo, nome único global) fecham porque toda checagem já carregava o objeto por
consulta, e a consulta agora é filtrada. É o ganho de o filtro ser por construção.

Suíte: **425 passed** (413 + os 12 de `test_tenant_isolation.py`). `openapi.json` sem mudança.

**Mutação, para provar que a varredura não está verde por vacuidade.** Removido um model de cada
vez da lista filtrada, e a suíte de isolamento rodada:

| Model fora do filtro | Testes que ficaram vermelhos |
|---|---|
| `Transaction` | 5 — diferencial, sentinela, rotas com id, campos de corpo, `total_balance` |
| `Account` | 4 — diferencial, sentinela, campos de corpo, `total_balance` |

**Sessão sem marca não é filtrada, e isso é escolha.** Scripts, migrations e a sessão direta dos
testes não têm dono e precisam ver tudo. O "fail closed" é estrutural, não de runtime:
`test_every_data_route_uses_the_owner_scoped_session` reprova rota de dados que pegue a sessão
crua de `get_db`. Uma checagem em runtime exigiria distinguir "sessão de requisição" de "sessão de
script" dentro de `get_db` — que a suíte sobrescreve.

⚠️ **Lembrete do gate:** com 1 e 2 juntas o isolamento existe, mas um usuário novo ainda entra
**sem conta nem categorias** até a fatia 3. Não é vazamento; é tela vazia e formulário sem conta
para lançar.

### Fatia 3 — o que foi entregue (04/10/2026)

* **`app/provisioning.py`** — `provision_user`: "Conta Principal" com R$ 0,00 e as 10 categorias
  do seed antigo (mesmos nomes, ícones, orçamentos e cores), donas do usuário.
* **`tenancy.resolve_user`** — cria a linha de `users` **e** provisiona no mesmo commit. Separados,
  um processo que morresse no meio deixaria um usuário com linha e sem conta, que nunca mais seria
  provisionado. Na corrida pelo `UNIQUE(email)`, quem perde desfaz a tentativa inteira e relê.
* **`GET /api/auth/me` passa por `current_owner`** — é a primeira chamada do front, e é ali que o
  usuário novo ganha conta antes de qualquer tela pedir dado.
* **`client`/`fk_client` sobrescrevem `current_owner`** com `provision=False` (D-Tenant-8). A linha
  de `users` e o filtro continuam reais; só as 10 categorias saem, para não colidir com os
  `create_category(client, "Alimentação")` dos testes antigos.

Suíte: **437 passed** (425 + os 12 de `test_provisioning.py`). `openapi.json`: só a descrição de
`/auth/me` mudou (docstring), o contrato não.

**Defeito achado na revisão, antes do commit.** O `except IntegrityError` de `resolve_user` existe
para a corrida do `UNIQUE(email)`, mas pega também `IntegrityError` vindo de `provision_user`.
Aí a releitura não acha ninguém, e o `.one()` levantava `NoResultFound` — trocando a causa real
por "usuário não encontrado". Agora relê com `.one_or_none()` e, sem vencedor, **relança o erro
original**. Teste escrito antes, vermelho pelo motivo certo (`NoResultFound` no lugar do
original). O par dele — nenhum usuário pela metade sobra — já passava: o rollback desfazia tudo.

A corrida em si (duas requisições, dois processos) continua **sem teste**: o SQLite em memória
da suíte é uma conexão só, e não há como ter dois escritores concorrentes nele.

**O caminho de produção provisiona — travado, e provado por mutação.** `provision=False` só
existe no override de `client`/`fk_client`. Os testes de provisionamento usam `client_as`, que
passa pelo `current_owner` real; uma guarda nova assere que `client_as` não carrega o override.
Mutação `current_owner → provision=False`: **5 testes vermelhos** (conta, categorias,
idempotência, dois usuários, fluxo de login).

**O falso verde da fatia 1 agora prova algo.** `test_preexisting_user_is_never_provisioned`
passava porque ninguém era provisionado. Mutação: provisionar também usuário existente sem
categoria (o gatilho "errado" que a D-Tenant-5 descarta) — o teste ficou vermelho, com o dono
migrado ganhando uma segunda "Conta Principal" ao lado da real.

**A pendência da fatia 4 foi cumprida.** Com 1–3 verdes, os 56 testes de
`test_shared_expenses.py` foram rodados de novo: **todos falham pelo motivo certo** — 54 por rota
ausente (8 deles de validação, recebendo o 404 da rota no lugar da regra), 1 por
`shared_expense_id` ausente de `TransactionResponse`, 1 pela tabela `shared_expenses` ausente.
Nenhum passa. (Uma primeira contagem, por mensagem de erro, saiu 44/8/2/1/1 — agrupava linhas
de traceback, não testes; a contagem por teste é a do JUnit.) Um deles falhava com `TypeError`
(iterava o corpo do 404 como lista); ganhou a checagem de status antes, para a mensagem dizer o
que falta.

### Fatia 4 — o que foi entregue (04/10/2026)

Migration `d3a8f1e6c720_shared_expenses.py` (só schema, sem `-x`), `app/shared_split.py`,
`app/routers/shared_expenses.py`, as travas em `routers/transactions.py` e `shared_expense_id`
em `TransactionResponse`. Suíte: **496 passed** (437 + 58 de `test_shared_expenses.py` + 1 guarda
de `acting_as`). `openapi.json`: +3 paths e o campo novo — **contrato com o front muda**.

**Dois desvios do desenho, ambos para não abrir brecha no filtro da D-Tenant-3:**

* **`acting_as(db, user_id)`** em `tenancy.py`. A parte de cada participante (conta, categoria,
  transação) é de **outro** dono, invisível pelo filtro. Em vez de uma opção que pulasse o
  filtro numa consulta — uma brecha de "ver tudo" —, o escopo da sessão troca **para** o
  participante durante o bloco. O filtro nunca desliga, e errar o id alcança só aquele usuário.
  `test_switching_the_owner_scope_is_confined_to_the_shared_expense_router` (escrito antes,
  vermelho por `ImportError`) limita o uso ao router da despesa.
* **Tabela `shared_expense_participants(shared_expense_id, user_id)`.** É a fonte de verdade de
  "sou participante" e da lista de partes. Sem ela, as duas exigiriam ler o ledger de outros
  donos. As partes da resposta são **recalculadas** pela divisão (determinística), não lidas.
  Entrou na lista de exceções do teste estrutural de dono, com o motivo.

**Os 8 testes de validação falham pela regra, não por 404.** Cada regra removida isoladamente,
com a rota existindo:

| Regra removida | Testes | Resultado sem a regra |
|---|---|---|
| `extra="forbid"` no POST | `out_of_scope_fields` ×3 | 201 |
| lista vazia / repetida | `non_empty_list_without_repeats` ×2 | 201 / `IntegrityError` na PK de participantes |
| parte mínima no schema | `part_below_one_cent` | 400 (a guarda do router pega, mas o contrato é 422) |
| criador na própria lista | `creator_cannot_list_themselves` | `IntegrityError` na PK de participantes |
| `extra="forbid"` no PATCH | `unknown_fields_in_the_group_patch` | 200 |

A PK de `shared_expense_participants` segura repetição e autoinclusão como último recurso — mas
como 500. Os validadores existem para que isso chegue como 422/400.

**Mutações nos pontos críticos** — todas pegas:

| Mutação | Vermelhos |
|---|---|
| sobra de centavo descartada | 6 |
| divisão em `Decimal` arredondando cada parte | 6 |
| sobra para o último participante, não o criador | 2 |
| `_load_visible` sem checar participação | 3 — inclusive a varredura |
| lista de grupos sem filtrar por participante | 3 — inclusive o diferencial |
| não participante recebe 403 em vez de 404 | 4 — inclusive a varredura |

(Nas duas primeiras, os 2 que seguem verdes são `0.03` e `99.99` — divisões sem sobra.)

⚠️ **Uma mutação passou, e virou teste.** "Ledger do criador gravado sem a sobra, resposta
intacta" deixou os 56 verdes: todo teste olhava a resposta (calculada) ou dividia sem sobra. Como
a resposta **recalcula** em vez de ler, resposta e ledger podiam divergir em silêncio.
`test_every_ledger_holds_exactly_the_part_the_response_shows` — **escrito depois da
implementação, rotulado como tal** — compara o ledger de cada participante com a resposta em
R$ 100 ÷ 3, na criação e após editar o valor. Pega a mutação na criação e a equivalente na
edição.

**Revisão antes do commit (04/10/2026)** — três testes novos, escritos depois da implementação
e rotulados assim, cada um confirmado por mutação:

| Teste | Mutação que o deixa vermelho |
|---|---|
| `test_acting_as_restores_the_original_owner_when_the_block_fails` | `acting_as` sem o `finally` |
| `test_only_tenancy_touches_the_session_owner` — nenhum arquivo de `app/` fora de `tenancy.py` menciona `OWNER_KEY` nem `.info` de sessão | router escrevendo `db.info["owner_id"]` direto |
| `test_a_failure_midway_through_the_fan_out_leaves_nothing_behind` — participante sem conta derruba a criação inteira, sem grupo nem parte em ledger nenhum | `commit` antes de terminar o fan-out |

O teste estrutural endurecido existe porque `acting_as` não é a única forma de trocar o dono:
escrever em `session.info` também troca, e a guarda anterior só olhava chamadas de `acting_as`.

**A D13 de quem saiu da allowlist, pelas duas metades:**

| Mutação | Vermelhos |
|---|---|
| sem o 409 ao editar valor/participantes | 3 — os três `changes_that_would_touch_a_revoked_participant` |
| exclusão bloqueada quando há participante revogado | 1 — `deleting_still_works_and_reaches_the_revoked_ledger` |

Suíte final da fatia: **499 passed**.

### `alembic.ini` só em ASCII (decidido em 06/10/2026)

**Achado no ensaio, rodando do Windows:** `alembic upgrade` morria com
`UnicodeDecodeError: 'charmap' codec can't decode byte 0x8f`. O comentário sobre
`sqlalchemy.url` (linhas 89–92) tinha o emoji ⚠️ e acentos em UTF-8, e o `0x8f` é o último
byte do emoji. No Linux (CI, container) nunca apareceu, porque lá a codificação do sistema é
UTF-8.

**Dois leitores do arquivo usam a codificação do sistema** (cp1252 no Windows), ambos fora do
nosso código:

* o `configparser` do próprio Alembic: `alembic/util/compat.py` faz
  `file_config.read(..., encoding="locale")` (verificado no Alembic 1.19.1 instalado);
* o `fileConfig(config.config_file_name)` do `alembic/env.py`, de `logging.config`, que relê o
  mesmo `.ini` sem `encoding`.

**Decisão: o `alembic.ini` é só ASCII**, e **o contrato é o teste**
(`tests/test_alembic_config.py`), que lê o arquivo em **bytes** e reprova qualquer byte acima
de `0x7F`, com o número da linha. É em bytes de propósito: um teste que abrisse o arquivo com
`open()` dependeria da codificação de quem o roda e ficaria verde no Linux, pelo mesmo motivo
que o defeito nunca apareceu no CI. A correção reescreveu só os quatro comentários, sem emoji e
sem acentos. Nenhuma configuração mudou.

**Alternativa descartada:** passar `encoding="utf-8"` no `fileConfig` do `env.py`. Isso
blindaria só o segundo leitor; o do Alembic continuaria usando `locale`, e não é código nosso.

**Não afetados**, verificados: `env.py` e `alembic/versions/*.py` têm acentos, mas o Alembic os
carrega por `importlib` (`spec_from_file_location` + `exec_module`), e o Python decodifica
código-fonte como UTF-8 por padrão, qualquer que seja o locale. `script.py.mako` e `README`
são ASCII.

---

