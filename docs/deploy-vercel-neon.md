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

