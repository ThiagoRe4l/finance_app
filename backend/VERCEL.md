# Deploy do backend na Vercel

Projeto separado do frontend, mesmo repositório, **Root Directory `backend`**.

O FastAPI roda como **função serverless** — `api/index.py` exporta o app ASGI.
Não há imagem, entrypoint nem processo de longa duração; cada invocação é fria
e isolada. É isso que torna o Alembic pré-requisito (D-Vercel-6): não existe
boot onde `create_all()` pudesse rodar.

## Variáveis de ambiente

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://...@ep-xxx-pooler.../neondb?sslmode=require` |

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
3. `DATABASE_URL=... python app/init_db.py --yes` — cria `Conta Principal`
   (saldo inicial 10.000) e as 10 categorias padrão. É idempotente.
4. Deployar o backend, gerar o domínio público.
5. Preencher o `destination` do rewrite em `frontend/vercel.json` e deployar o
   frontend.

Smoke, nesta ordem: `/health` → `/api/accounts/` (saldo `"10000.00"`) →
`/api/dashboard/summary` (`total_balance` idêntico) → as cinco telas.
