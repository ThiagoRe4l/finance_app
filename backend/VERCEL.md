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
| `GET /api/accounts/` autenticado | `200`, saldo `"10000.00"` |

🔴 **O 401 em português é o sinal que importa no segundo passo.** Ele prova que
o caminho chegou íntegro ao app: um `404 {"detail":"Not Found"}` ali significa
que o roteamento voltou a reescrever o caminho, e não que falta autenticação.

Depois do login, vale fechar com `/api/dashboard/summary` (o `total_balance`
tem que ser idêntico ao saldo de `/api/accounts/`) e as cinco telas do
frontend.
