# Runbook: aplicar a migration de assinaturas no Neon (produção)

**Para quem tem acesso ao Neon.** Escrito em 17/11/2026. Tempo estimado: 20 a 30 minutos, a
maior parte no backup.

## Por que isso é necessário

O código novo (assinaturas, filtro de período, redesign) já está na `main` e a Vercel publicou.
O banco de produção ainda não tem a migration **`a8d3f5c1b9e7_subscriptions`**, que cria a
tabela `subscriptions` e a coluna `transactions.subscription_id`. Resultado hoje: o site
publicado dá **500** em `POST /api/subscriptions/sync` e `GET /api/dashboard/summary`, e as telas
mostram "Erro desconhecido". `GET /api/auth/me` e `/api/periods/range` seguem 200 (não usam a
tabela).

Causa **provável**, ainda não confirmada: o log de função da Vercel deve mostrar algo como
`relation "subscriptions" does not exist`. Vale conferir no passo 0.

A migration é **aditiva**: cria uma tabela e uma coluna nula. Nenhuma linha existente muda e
nada é apagado. Não pede `-x owner_email`, **a menos que** a produção esteja atrasada em
migrations mais antigas (ver passo 5).

## Regras antes de começar

* **Nunca** cole a `DATABASE_URL` de produção em chat, issue, commit ou arquivo do repositório.
* **Nunca** escreva essa URL no `backend/.env.local`. Exporte só no terminal, como abaixo.
* Use um terminal **novo** para isto e feche-o no fim, para a variável não ficar para outros
  comandos (um `alembic` ou teste rodado nele depois escreveria em produção).

## Passo 0: confirmar o diagnóstico (2 min)

No painel da Vercel, projeto do backend, aba **Logs** (ou Runtime Logs), filtre por erro e abra
uma chamada a `/api/dashboard/summary`. Procure `relation "subscriptions" does not exist` ou
`column transactions.subscription_id does not exist`. Se o erro for **outro**, pare aqui e
mande o texto da exceção; esta migration não resolve.

## Passo 1: backup (obrigatório)

Segue a D-Tenant-6 (`docs/multiusuario.md`), nesta ordem:

1. **Branch do Neon** (snapshot instantâneo): no console do Neon, projeto, **Branches**,
   **Create branch** a partir de `main`/produção. Dê um nome com a data, por exemplo
   `backup-pre-assinaturas-2026-11-17`.
2. **`pg_dump`** (cópia fora do Neon). Use a connection string **direta** (sem `-pooler`):

   ```bash
   pg_dump "<URL direta de produção>" --format=custom --file=backup-2026-11-17.dump
   ```

3. **Contagem de linhas por tabela**, para comparar depois (rode no SQL Editor do Neon):

   ```sql
   SELECT 'users' AS t, count(*) FROM users
   UNION ALL SELECT 'accounts', count(*) FROM accounts
   UNION ALL SELECT 'categories', count(*) FROM categories
   UNION ALL SELECT 'transactions', count(*) FROM transactions
   UNION ALL SELECT 'installments', count(*) FROM installments
   UNION ALL SELECT 'investments', count(*) FROM investments;
   ```

   Anote o resultado.

(O ideal da D-Deploy-2 é também restaurar o dump num branch descartável e conferir. Se o branch
do passo 1 foi criado, ele já é um backup restaurável; o dump é o segundo.)

## Passo 2: ensaio num branch do Neon (recomendado, 5 min)

Crie **outro** branch a partir da produção, só para ensaio (`ensaio-migracao`), e rode os passos
4 a 6 apontando para a URL **dele**. Só vá para produção se terminar sem erro.

## Passo 3: preparar o ambiente local

```bash
git pull origin main                      # precisa estar em e612bf0 ou mais novo
cd backend
py -3.12 -m venv venv                     # só na primeira vez
source venv/Scripts/activate              # Git Bash no Windows
pip install -r requirements-dev.txt       # só na primeira vez, ou se mudou
```

No Linux/macOS: `python3 -m venv venv && source venv/bin/activate`.

## Passo 4: apontar para o banco certo

Exporte **no terminal**, sem salvar em arquivo. Use a URL **direta** do Neon (host sem
`-pooler`), porque migration é DDL e o pooler pode atrapalhar. Se só tiver a URL com pooler,
funciona na maioria dos casos, mas prefira a direta.

```bash
export DATABASE_URL='postgresql://USUARIO:SENHA@HOST/NOME?sslmode=require'
export SESSION_SECRET=qualquer-valor-so-para-subir
echo "$DATABASE_URL" | sed 's/.*@//'   # mostra só o host: tem que ser o do Neon, NÃO sqlite
```

**Pare se o host mostrado não for o do Neon que você quer.**

## Passo 5: ver onde a produção está

```bash
alembic current
alembic heads
```

* `alembic heads` deve mostrar **`a8d3f5c1b9e7`**.
* `alembic current` deve mostrar **`f2b6d0c9e1a4`**. Se mostrar isso, só falta a migration de
  assinaturas: siga para o passo 6.
* Se mostrar uma revisão **mais antiga** (`e5c1a9b47d20`, `d3a8f1e6c720`, `b7d41c2e9a05`,
  `96fdc067f386`), o `upgrade head` vai aplicar **também** as que faltam. A cadeia é:

  ```
  96fdc067f386 → b7d41c2e9a05 → d3a8f1e6c720 → e5c1a9b47d20 → f2b6d0c9e1a4 → a8d3f5c1b9e7
  ```

  A `b7d41c2e9a05` (dono por linha) **exige** `-x owner_email=<e-mail do dono dos dados>` quando
  há dados; sem ele a migration levanta erro de propósito. Nesse caso use:
  `alembic -x owner_email=EMAIL upgrade head`. As demais são só schema.
* Se `alembic current` não mostrar nada, ou der erro de tabela `alembic_version`: **pare** e
  avise, não rode `upgrade`.

## Passo 6: aplicar

```bash
alembic upgrade head
```

Saída esperada (a última linha é a que importa):

```
INFO  [alembic.runtime.migration] Running upgrade f2b6d0c9e1a4 -> a8d3f5c1b9e7, subscriptions: tabela e transactions.subscription_id
```

Se der erro, **não repita no automático**: copie a mensagem inteira e pare (nada é aplicado pela
metade se o erro for no meio; o Postgres desfaz a transação do DDL).

## Passo 7: conferir

```bash
alembic current            # tem que mostrar a8d3f5c1b9e7 (head)
```

No SQL Editor do Neon:

```sql
SELECT count(*) FROM subscriptions;                              -- 0 é o esperado
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'transactions' AND column_name = 'subscription_id';   -- 1 linha
```

Rode de novo a contagem do passo 1.3: os números têm que ser **iguais** aos de antes.

Depois, abra o site publicado, faça **Ctrl+Shift+R** e confira a Visão Geral e Transações. Se
os dados voltaram, terminou. Não precisa de novo deploy.

## Passo 8: limpar

```bash
unset DATABASE_URL SESSION_SECRET
```

Feche o terminal. Se criou o branch de ensaio, pode apagá-lo. **Mantenha o branch de backup**
por alguns dias.

## Se algo der errado

* **Voltar só esta migration** (apaga a tabela `subscriptions` e a coluna; perde as assinaturas
  cadastradas depois, se já houver):

  ```bash
  alembic downgrade f2b6d0c9e1a4
  ```

  Isso devolve o banco ao estado anterior, mas o site continua com 500 (o código novo segue
  publicado). Para o site voltar a funcionar, reverta o deploy na Vercel
  (**Deployments** → o anterior ao `e612bf0` → **Promote to Production**).
* **Restaurar tudo:** no Neon, restaure o branch de backup do passo 1 (**Restore** ou
  apontar a produção para ele).
* **Erro que não está aqui:** guarde a saída completa do comando e do log da Vercel e envie
  antes de tentar outra coisa.

## Referência

* Migration: `backend/alembic/versions/a8d3f5c1b9e7_subscriptions.py` (decisão em
  `docs/recorrencias.md`, R-1 e R-3).
* Roteiro de backup e dono por linha: `docs/multiusuario.md`, D-Tenant-6.
* Pool, Alembic e CI: `docs/deploy-vercel-neon.md`.
