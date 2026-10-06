# Deploy do backend na Vercel

Projeto separado do frontend, mesmo repositório, **Root Directory `backend`**.

O FastAPI roda como **função serverless** — `api/index.py` exporta o app ASGI.
Não há imagem, entrypoint nem processo de longa duração; cada invocação é fria
e isolada. É isso que torna o Alembic pré-requisito (D-Vercel-6): não existe
boot onde `create_all()` pudesse rodar.

## Variáveis de ambiente

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a connection string do pooler, como o painel do Neon a entrega |

O esquema não precisa de ajuste: `postgresql://` recebe o driver `+psycopg`
automaticamente (`normalize_database_url`).

⚠️ **Use o endpoint com pooler** (host com `-pooler`), não o direto. E veja a
seção "Pool de conexão" no CLAUDE.md: o `NullPool` e o
`prepare_threshold=None` já estão em `app/settings.py`, mas dependem de a URL
apontar para o pooler para fazerem sentido.

`CORS_ALLOW_ORIGINS` **não é necessária**: o rewrite do frontend faz o browser
enxergar uma origem só (D-Vercel-3). O default permissivo do `settings.py`
segue existindo para o desenvolvimento local.

## Ordem do primeiro deploy

1. Criar o banco no Neon e copiar a connection string **do pooler**.
2. `DATABASE_URL=... alembic upgrade head` — cria o schema.
3. ~~`init_db.py --yes`~~ — **removido em 03/10/2026** (D-Tenant-5). Não há
   mais seed global: cada usuário recebe conta e categorias próprias no primeiro
   acesso. Em banco **com dado**, a migration de dono exige
   `alembic upgrade head -x owner_email=<e-mail>` — ver D-Tenant-6 e o roteiro
   de backup antes de aplicar.
4. Deployar o backend, gerar o domínio público.
5. Preencher o `destination` do rewrite em `frontend/vercel.json` e deployar o
   frontend.

## ⚠️ Não há `vercel.json` neste projeto, e isso é deliberado

A Vercel detecta o FastAPI nativamente ("backend framework project" no log de
build) e roteia todas as rotas para o app ASGI. Qualquer `rewrites` aqui
**compete com essa detecção e vence** — com consequência concreta:

    {"rewrites": [{"source": "/(.*)", "destination": "/api/index"}]}

Essa configuração fez o backend devolver `{"detail":"Not Found"}` em **toda**
rota, inclusive `/health`. O log explicou:

    WARNING! Internal rewrites in backend framework projects now route requests
    using the rewritten destination path.

O `destination` passou a ser o caminho que roteia, então o app recebia
`/api/index` em toda chamada. Há teste de contrato impedindo o retorno disso
(`tests/test_deploy_config.py`).

## Smoke pós-deploy

Nesta ordem:

| Passo | Esperado |
|---|---|
| `GET /health` | `200 {"status":"healthy"}` |
| `GET /api/accounts/` | **`401`** `{"detail":"Não autenticado."}` |
| login pelo frontend | cookie de sessão gravado |
| `GET /api/accounts/` autenticado | `200`, saldo igual ao `conta N: ... saldo=` do `verify_db` (o `"10000.00"` era do seed, que não existe mais) |

🔴 **O 401 em português é o sinal que importa no segundo passo.** Ele prova que
o caminho chegou íntegro ao app: um `404 {"detail":"Not Found"}` ali significa
que o roteamento voltou a reescrever o caminho, e não que falta autenticação.

Depois do login, vale fechar com `/api/dashboard/summary` (o `total_balance`
tem que ser idêntico ao saldo de `/api/accounts/`) e as cinco telas do
frontend.

## Runbook — migration multiusuário (fatias 1–4)

Aplica `b7d41c2e9a05` (dono por registro) e `d3a8f1e6c720` (despesa
compartilhada) num banco **com dado real**. Decisões em "👥 Multiusuário" no
CLAUDE.md, em especial a D-Tenant-6 e o gate de deploy.

**Escrito em 04/10/2026.** Cada passo diz o que esperar; resultado diferente do
esperado é **PARE**, não improviso.

**Ensaio de 06/10/2026**, no Windows, num checkout limpo feito pelo Git do
Windows em `8209c9f`, com Python 3.12, contra um branch do Neon com cópia de
produção: `upgrade`, `downgrade` e novo `upgrade` deram `diff` vazio contra os
retratos do `verify_db`, e o login simulado do passo 3.5 deu `200` em tudo, com
`total_balance` igual à soma dos saldos. Ressalvas do mesmo ensaio:

* a cópia de produção estava **sem movimento** (1 conta, 10 categorias, nenhuma
  transação nem parcelamento). A semente foi **manual**, pelo SQL Editor do Neon:
  1 parcelamento e 4 transações (ENTRADA, SAÍDA fixa, SAÍDA de 33,33 e SAÍDA
  vinculada ao parcelamento). O retrato "antes" teve `installments: 1`,
  `transactions: 4` e saldo `3166.67`, então o preenchimento de `owner_id` e as
  FKs compostas **foram** exercitados. O passo 3.1 agora automatiza a semente;
  o SQL dele (com `U&'SA\00CDDA'`) só foi rodado em SQLite — **a validar** em
  Postgres;
* a **restauração do dump foi pulada** (passo 2), por não haver dado real — o
  dump foi gerado e a listagem conferida, mas não restaurado;
* o `alembic upgrade` só rodou depois do `alembic.ini` em ASCII (nota abaixo),
  editado à mão na checkout do ensaio; a correção no repositório é o commit
  `d055b9a`.

### 0. Pré-requisitos

| # | Conferência | Esperado |
|---|---|---|
| 0.1 | PR aberto com as 4 fatias | jobs `backend`, `backend-postgres` e `frontend` **verdes** |
| 0.2 | Versão do Postgres do projeto Neon (painel → Settings) | anotar; o CI usa `postgres:16` |
| 0.3 | `pg_dump --version` na máquina que vai rodar | major **≥** a do servidor (0.2) |
| 0.4 | E-mail do dono: entrar no Google com a conta que ele usa no app e copiar o e-mail **dali** | é este o `OWNER_EMAIL` — não um e-mail "de cabeça" |
| 0.5 | `AUTH_ALLOWED_EMAILS` do projeto backend na Vercel | contém `OWNER_EMAIL`, mesma grafia |

**Rodando do Windows** (como no ensaio de 06/10/2026). Todos os comandos deste
runbook são **bash**: use o **Git Bash**, não PowerShell nem `cmd`.

* **Checkout pelo Git do Windows, nunca a worktree do container.** O `.git` de
  uma worktree criada no container aponta para `/workspace/...`, caminho que o
  Git do Windows não resolve. Na pasta principal do repositório:
  ```bash
  git fetch origin
  git worktree add --detach <pasta> origin/feat/multi-tenant-shared-expenses
  ```
  e rode tudo a partir de `<pasta>/backend`.
* 🔴 **Nunca rode `git worktree prune`, em nenhum dos lados.** Cada lado enxerga
  a worktree do outro como `prunable` (o caminho dela não existe ali), e o
  `prune` apagaria os metadados dela.
* **Python 3.12, explicitamente.** O Python padrão da máquina do ensaio era o
  3.14; o projeto é 3.12 em dev, CI e produção:
  ```bash
  py -3.12 -m venv .venv
  source .venv/Scripts/activate      # no Windows é Scripts/, não bin/
  pip install -r requirements.txt
  ```
  Para `verify_db` e `alembic` basta o `requirements.txt`. O login simulado do
  passo 3.5 usa `fastapi.testclient`, que precisa do `httpx` — está só no
  `requirements-dev.txt`. Sem o `requirements-dev.txt` também não há
  `python-dotenv`, e então o `backend/.env.local` **não** é carregado (ver "O que
  o Alembic enxerga", abaixo).
* **`pg_dump`, `pg_restore` e `psql`** não vinham instalados. No instalador do
  PostgreSQL, marque só **"Command Line Tools"**, com major **≥** a do servidor
  (0.2), e ponha no PATH do Git Bash:
  ```bash
  export PATH="$PATH:/c/Program Files/PostgreSQL/<major>/bin"
  ```

🔴 **Use sempre a connection string DIRETA (host sem `-pooler`)** para
`pg_dump`, `pg_restore`, `psql`, `alembic` e `verify_db`. O pooler em transaction
mode não serve para dump/restore, e o `alembic/env.py` não desliga os prepared
statements do psycopg (o `prepare_threshold=None` só está no engine da app).

As URLs ficam em variáveis do shell, lidas **sem eco e sem histórico**:

```bash
cd backend
read -rs PROD_DIRECT_URL   # cola a string direta do branch main do Neon, Enter
read -r  OWNER_EMAIL       # o e-mail copiado no passo 0.4
read -rs AUTH_ALLOWED_EMAILS && export AUTH_ALLOWED_EMAILS  # o valor da Vercel (passo 0.5)
```

🔴 **O que o Alembic enxerga no ambiente.** O `alembic/env.py` importa
`app.settings`, e esse import carrega o `backend/.env.local` com
`override=False`: o que está no shell vence, e o que **não** está vem do
arquivo. O `.env.local` deste projeto tem `DATABASE_URL` (a de **produção**) e
`AUTH_ALLOWED_EMAILS`. Por isso:

* **`DATABASE_URL` vai explícita em todo comando** — sem ela, o comando roda
  contra produção.
* **`AUTH_ALLOWED_EMAILS` vai exportada com o valor da Vercel.** A migration
  recusa `-x owner_email` fora dela; sem o export, a comparação é contra a
  lista do arquivo local, que pode estar desatualizada. Se a variável não
  existir em lugar nenhum, a migration **não** bloqueia — emite um
  `UserWarning` dizendo que o e-mail não foi conferido. Esse aviso no log é
  **PARE**: exporte a variável e rode de novo.

Nenhum passo abaixo imprime essas variáveis. `verify_db` mostra só host/banco,
no stderr, e e-mails mascarados.

⚠️ **Alembic no Windows exige `alembic.ini` só em ASCII** — descoberto no ensaio.
O Alembic lê o `.ini` com a codificação do sistema (cp1252 no Windows), e o
comentário com emoji e acentos derrubava o `alembic upgrade` com
`UnicodeDecodeError: 'charmap' codec can't decode byte 0x8f`. No Linux (CI)
nunca apareceu. Corrigido, e `tests/test_alembic_config.py` reprova qualquer
byte fora do ASCII no arquivo.

### 1. Backup — snapshot e dump

1. **Snapshot:** no painel do Neon, *Branches → Create branch*, pai `main`,
   nome `pre-tenant-AAAAMMDD`. É cópia instantânea; **não apagar** até a
   produção estar estável por alguns dias.
   (CLI equivalente — conferir a sintaxe com `neonctl branches create --help`
   antes: `neonctl branches create --name pre-tenant-AAAAMMDD --parent main`.)
2. **Dump** do `main`:
   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     --file "pre-tenant-$(date +%Y%m%d-%H%M).dump" "$PROD_DIRECT_URL"
   ```
3. **Retrato de produção, antes** (somente leitura):
   ```bash
   DATABASE_URL="$PROD_DIRECT_URL" python -m scripts.verify_db > prod-antes.txt
   ```
   Esperado: `revisao: 96fdc067f386`, sem seção `[donos]`.

### 2. Restaurar o dump — backup nunca restaurado não é backup

⚠️ **No ensaio de 06/10/2026 esta restauração foi pulada**, porque a cópia não
tinha dado real (1 conta, 10 categorias, nenhuma transação): o dump foi gerado e
a listagem conferida, mas não restaurado. Com dado real, a restauração volta a
valer e é obrigatória.

1. Criar o branch de ensaio: *Create branch*, pai `main`, nome
   `ensaio-tenant`. Copiar a string **direta** dele — só agora ela existe:
   ```bash
   read -rs ENSAIO_DIRECT_URL
   ```
2. Dentro dele, um banco **vazio** para o restore:
   ```bash
   psql "$ENSAIO_DIRECT_URL" -c 'CREATE DATABASE restore_check'
   ```
   `RESTORE_URL` = a mesma string do ensaio com `/restore_check` no lugar do
   nome do banco (`read -rs RESTORE_URL`).
3. Restaurar e comparar:
   ```bash
   pg_restore --no-owner --no-privileges --dbname "$RESTORE_URL" pre-tenant-*.dump
   DATABASE_URL="$RESTORE_URL" python -m scripts.verify_db > restore.txt
   diff prod-antes.txt restore.txt
   ```
   Esperado: **`diff` vazio.** Qualquer diferença é **PARE**: o backup não
   reproduz produção. (Aviso do `pg_restore` como `schema "public" already
   exists` é ruído do banco novo, não falha — o que decide é o `diff`.)

   Todos os comandos `python -m scripts.verify_db` rodam de `backend/`, com o
   venv do backend ativo (`requirements.txt`; o passo 3.5 precisa do
   `requirements-dev.txt`).

### 3. Ensaio no branch — com cópia do dado real

1. **Retrato da cópia, antes de qualquer mudança:**
   ```bash
   DATABASE_URL="$ENSAIO_DIRECT_URL" python -m scripts.verify_db > ensaio-copia.txt
   diff prod-antes.txt ensaio-copia.txt   # esperado: vazio
   ```
   **Semear dado sintético — só no branch descartável, nunca em produção.** Uma
   cópia de produção sem movimento não exercita o preenchimento de `owner_id` nem
   as FKs compostas. No ensaio de 06/10/2026 a semente foi feita à mão, pelo SQL
   Editor do Neon; este passo a automatiza. A semente põe 1 parcelamento e 4
   transações: uma ENTRADA, uma SAÍDA comum, uma SAÍDA fixa e uma SAÍDA vinculada
   ao parcelamento, todas com centavos. As colunas são as da migration inicial
   (`96fdc067f386`), que é o schema da cópia neste ponto. ⚠️ Este SQL só foi
   rodado em SQLite, com o escape trocado pelo literal — **a validar** em
   Postgres na próxima execução; o `ENTRADA|7|1` / `SAÍDA|5|3` abaixo é a
   conferência.

   Salve como `ensaio-seed.sql`. O arquivo é **todo ASCII** de propósito: o tipo
   `SAÍDA` vai como escape Unicode `U&'SA\00CDDA'`, porque um `Í` digitado num
   console cp1252 pode chegar corrompido ao banco, e a transação deixaria de
   contar no saldo sem erro nenhum.
   ```sql
   -- ENSAIO: so no branch descartavel do Neon. NUNCA em producao.
   BEGIN;

   INSERT INTO installments
     (title, category_id, total_amount, installment_amount,
      current_installment, total_installments, end_date, account_id)
   VALUES
     ('ENSAIO parcelamento',
      (SELECT id FROM categories ORDER BY id LIMIT 1),
      1234.56, 102.88, 2, 12, 'Set/2027',
      (SELECT id FROM accounts ORDER BY id LIMIT 1));

   INSERT INTO transactions
     (title, type, amount, date, category_id, is_fixed, account_id, installment_id)
   VALUES
     ('ENSAIO entrada', 'ENTRADA', 2500.10, CURRENT_DATE,
      (SELECT id FROM categories ORDER BY id LIMIT 1), false,
      (SELECT id FROM accounts ORDER BY id LIMIT 1), NULL),
     ('ENSAIO saida', U&'SA\00CDDA', 87.35, CURRENT_DATE,
      (SELECT id FROM categories ORDER BY id LIMIT 1), false,
      (SELECT id FROM accounts ORDER BY id LIMIT 1), NULL),
     ('ENSAIO fixa', U&'SA\00CDDA', 1450.00, CURRENT_DATE,
      (SELECT id FROM categories ORDER BY id LIMIT 1), true,
      (SELECT id FROM accounts ORDER BY id LIMIT 1), NULL),
     ('ENSAIO parcela', U&'SA\00CDDA', 102.88, CURRENT_DATE,
      (SELECT id FROM categories ORDER BY id LIMIT 1), false,
      (SELECT id FROM accounts ORDER BY id LIMIT 1),
      (SELECT id FROM installments WHERE title = 'ENSAIO parcelamento'));

   COMMIT;
   ```
   ```bash
   psql "$ENSAIO_DIRECT_URL" -v ON_ERROR_STOP=1 -f ensaio-seed.sql
   psql "$ENSAIO_DIRECT_URL" -At -c "SELECT type, length(type), count(*) FROM transactions
     WHERE title LIKE 'ENSAIO%' GROUP BY type ORDER BY type"
   ```
   Esperado na conferência: `ENTRADA|7|1` e `SAÍDA|5|3`. O `5` é o que importa:
   prova que o `Í` chegou como um caractere só, mesmo que o console o exiba
   errado. A semente soma **+859,87** ao ledger da primeira conta
   (2500,10 − 87,35 − 1450,00 − 102,88).

   **Retrato antes** — a base de todas as comparações seguintes:
   ```bash
   DATABASE_URL="$ENSAIO_DIRECT_URL" python -m scripts.verify_db > ensaio-antes.txt
   ```
   Esperado: contra `ensaio-copia.txt`, `installments` +1, `transactions` +4, e o
   `ledger=` da primeira conta 859,87 maior.
2. **Ver os nomes das FKs antigas** — o que a migration vai derrubar:
   ```bash
   psql "$ENSAIO_DIRECT_URL" -c '\d transactions' -c '\d installments'
   psql "$ENSAIO_DIRECT_URL" -At -c "SELECT conrelid::regclass, conname FROM pg_constraint
     WHERE contype = 'f' AND conrelid::regclass::text IN ('transactions', 'installments')
     ORDER BY 1, 2"
   ```
   Esperado, **exatamente**:
   ```
   installments|installments_account_id_fkey
   installments|installments_category_id_fkey
   transactions|transactions_account_id_fkey
   transactions|transactions_category_id_fkey
   transactions|transactions_installment_id_fkey
   ```
   🔴 **Nome diferente é PARE.** A migration derruba as quatro primeiras por esse
   nome, que é o default documentado do Postgres — confirmado no CI (`postgres:16`,
   schema criado pela migration inicial) e **observado no Neon real em
   06/10/2026**: as 5 FKs antigas seguem `<tabela>_<coluna>_fkey`, vistas na seção
   `[fks]` do `verify_db`. A conferência continua obrigatória a cada execução —
   em produção também (passo 4.3). Não editar a migration na hora: voltar,
   ajustar com teste, rodar o CI de novo.
3. **Migrar** — as duas revisões em sequência, numa transação só (no Postgres,
   se a segunda falhar, a primeira é desfeita junto):
   ```bash
   DATABASE_URL="$ENSAIO_DIRECT_URL" alembic upgrade head -x owner_email="$OWNER_EMAIL"
   ```
   Esperado no log: `96fdc067f386 -> b7d41c2e9a05` e `b7d41c2e9a05 -> d3a8f1e6c720`,
   e **nenhum** `UserWarning` sobre `AUTH_ALLOWED_EMAILS`. Um `RuntimeError`
   dizendo que o `owner_email` não está na allowlist é a recusa funcionando:
   nada foi alterado — confira o e-mail (passo 0.4) e a variável (0.5).
4. **Retrato depois** e comparação:
   ```bash
   DATABASE_URL="$ENSAIO_DIRECT_URL" python -m scripts.verify_db \
     --expect-owner "$OWNER_EMAIL" > ensaio-depois.txt; echo "exit=$?"
   diff ensaio-antes.txt ensaio-depois.txt
   ```
   Esperado:
   * `exit=0` e `dono_esperado: OK`;
   * **nenhuma linha de `[dinheiro]` no `diff`** — soma dos saldos iniciais e
     saldo de cada conta idênticos;
   * contagens das 6 tabelas antigas idênticas; `users: 1`; `linhas_sem_dono: 0`;
   * em `[fks]`, as compostas `fk_*_account_owner`/`fk_*_category_owner`.
5. **Login simulado como o dono.** Não é o Google — é o mesmo caminho de código
   depois dele (`current_user` → `current_owner` → filtro), com um cookie
   assinado por um segredo descartável, válido só neste processo. O login real
   não dá para ensaiar: um backend local apontando para Postgres se considera
   produção e emite cookie `Secure`, que o browser descarta em `http://localhost`.
   Precisa do `requirements-dev.txt` (o `TestClient` usa `httpx`).

   ⚠️ O bloco abaixo fica **fora do recuo da lista, na coluna 0, de
   propósito**: dentro de um heredoc o recuo é parte do código. Com espaços na
   frente, o Python recusa `   import os` (`IndentationError`) e o `   PY` não
   fecha o `<<'PY'` — só `<<-` remove recuo, e só de tabs.

```bash
DATABASE_URL="$ENSAIO_DIRECT_URL" OWNER_EMAIL="$OWNER_EMAIL" \
AUTH_ALLOWED_EMAILS="$OWNER_EMAIL" GOOGLE_CLIENT_ID=ensaio \
SESSION_SECRET="ensaio-$(python -c 'import secrets; print(secrets.token_hex(24))')" \
python - <<'PY'
import os
from fastapi.testclient import TestClient
from app.auth import issue_session
from app.main import app
cookie = issue_session(os.environ["OWNER_EMAIL"], os.environ["SESSION_SECRET"])
client = TestClient(app, cookies={"session": cookie})
for path in ("/api/auth/me", "/api/accounts", "/api/categories",
             "/api/transactions", "/api/installments", "/api/investments"):
    r = client.get(path)
    body = r.json()
    print(path, r.status_code, f"{len(body)} itens" if isinstance(body, list) else "")
print("total_balance", client.get("/api/dashboard/summary").json()["total_balance"])
PY
```

   Esperado: tudo `200`; as quantidades batem com `ensaio-depois.txt`;
   `total_balance` = soma dos `saldo=` do retrato.
   ⚠️ Este passo **pode escrever**: se o e-mail não for o da migration, o
   `current_owner` cria um usuário novo e provisiona conta e categorias vazias.
   É o sintoma que o próximo passo procura — e no branch de ensaio não custa
   nada.
6. **Conferência do e-mail do dono, depois do login:**
   ```bash
   DATABASE_URL="$ENSAIO_DIRECT_URL" python -m scripts.verify_db \
     --expect-owner "$OWNER_EMAIL" \
     | grep -E '^users:|^usuario |^linhas_sem_dono|^dono_esperado|mais de um'
   ```
   Esperado: **ainda `users: 1`**, uma linha só em `[donos]`, `dono_esperado: OK`.
   Um segundo usuário com `transactions=0` aqui é o e-mail errado — ver
   "E-mail do dono errado" abaixo.
7. **Ensaio do rollback:**
   ```bash
   DATABASE_URL="$ENSAIO_DIRECT_URL" alembic downgrade 96fdc067f386
   DATABASE_URL="$ENSAIO_DIRECT_URL" python -m scripts.verify_db > ensaio-rollback.txt
   diff ensaio-antes.txt ensaio-rollback.txt   # esperado: vazio
   ```
   O downgrade recria as FKs simples com os nomes `<tabela>_<coluna>_fkey`, então
   até `[fks]` volta idêntico. **É a única vez que o downgrade roda em Postgres
   antes de produção** — o CI não o exercita.
8. Apagar `ensaio-tenant` (o `restore_check` vai junto). Manter `pre-tenant-*`.

### 4. Produção

Na ordem — a janela de 500 da D-Tenant-6 começa no passo 4 e termina no 6.

1. Gate conferido: 0.1–0.5 e o ensaio inteiro sem PARE.
2. **Snapshot novo** imediatamente antes (`pre-tenant-AAAAMMDD-HHMM`) — o do
   passo 1 pode estar horas atrás.
3. `DATABASE_URL="$PROD_DIRECT_URL" python -m scripts.verify_db > prod-antes.txt`
   e a consulta de FKs do passo 3.2 contra `$PROD_DIRECT_URL`. Mesmo esperado.
4. **Migrar:**
   `DATABASE_URL="$PROD_DIRECT_URL" alembic upgrade head -x owner_email="$OWNER_EMAIL"`
5. `verify_db --expect-owner` contra produção e `diff` com `prod-antes.txt`:
   mesmo esperado do passo 3.4. Divergência é **rollback** (seção 5), não ajuste.
6. **Merge do PR.** A Vercel deploya o backend; esperar o deploy ficar *Ready*.
   (Migration antes do deploy, e não depois: com o código antigo sobre o schema
   novo, só **escrita** falha; com o código novo sobre o schema antigo, **toda**
   requisição falha.)
7. **Login real** pelo frontend, com a conta Google do dono. Conferir que as
   contas, transações e o saldo aparecem como no retrato.
8. `verify_db --expect-owner` de novo. Esperado: `users: 1` e `OK`. Os outros
   usuários da allowlist ganham linha e dados próprios **quando** entrarem — a
   partir daí `users` cresce, e isso é o esperado.

### 5. Rollback em produção

| Situação | O que fazer |
|---|---|
| A migration falhou no passo 4 | Nada a desfazer: foi uma transação só. Confirmar com `verify_db` (`revisao: 96fdc067f386`, retrato igual a `prod-antes.txt`). |
| Migrou, e **só o dono** usou (`users: 1`, `shared_expenses: 0`) | 1) Vercel: *Instant Rollback* do backend para o deploy anterior. 2) `DATABASE_URL="$PROD_DIRECT_URL" alembic downgrade 96fdc067f386`. 3) `verify_db` e `diff` com `prod-antes.txt` — vazio. Ordem inversa da subida, pelo mesmo motivo. |
| Já há **mais de um usuário** ou despesa compartilhada | O `downgrade` **recusa** (D-Tenant-6) — os nomes colidiriam. Opções, a decidir na hora: restaurar o `main` a partir do `pre-tenant-*` (perde o que foi escrito depois do snapshot) ou corrigir para frente. Não forçar o downgrade. |

(Restore de branch no Neon: painel → *Branches → main → Restore*, escolhendo o
`pre-tenant-*` — conferir o fluxo no painel no dia; não foi exercitado.)

### E-mail do dono errado

**O que acontece.** A migration grava `users(email = <o -x informado>)` e dá a
esse usuário todo o dado existente. Ela confere o e-mail contra
`AUTH_ALLOWED_EMAILS` quando a variável existe, mas **não** tem como saber se é
o e-mail que o dono usa no Google: o e-mail de **outra** pessoa da allowlist
passa. Se for diferente:

1. O dono loga com o e-mail real. `current_owner` não acha esse e-mail em
   `users`, **cria um usuário novo e o provisiona**: "Conta Principal" com
   R$ 0,00 e as 10 categorias.
2. O dono vê o app **vazio**. O dado real continua no banco, preso ao e-mail da
   migration — que ninguém usa para logar.

Nada se perde, mas a tela vazia parece perda. Os passos 0.4, 3.6 e 4.8 existem
para pegar isso antes de alguém entrar em pânico.

**Correção, se acontecer** — só depois de o `verify_db` mostrar que o usuário
novo tem **apenas** o provisionamento (`accounts=1 categories=10 installments=0
transactions=0 investments=0`). `N` = id do usuário novo, `M` = id do dono
migrado, ambos da seção `[donos]`:

```sql
BEGIN;
DELETE FROM categories WHERE owner_id = N;
DELETE FROM accounts   WHERE owner_id = N;
DELETE FROM users      WHERE id = N;
UPDATE users SET email = '<e-mail real, minúsculo>' WHERE id = M;
COMMIT;
```

A sessão do dono volta a resolver para `M` na próxima requisição: a busca é por
e-mail. **Se o usuário `N` já tiver qualquer transação**, não rodar — é dado
real dele, e a decisão é outra.
