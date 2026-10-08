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

