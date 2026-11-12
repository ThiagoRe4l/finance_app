## 🗃️ Deploy — Railway (**SUPERADO em 28/08/2026**, mantido como histórico)

> 🔴 **Esta seção não descreve o alvo atual.** O projeto migrou para
> **Vercel + Neon (Postgres)** — ver "🚢 Deploy — Vercel + Neon" logo abaixo.
> Nenhum serviço chegou a ser criado no Railway, então nada aqui foi para produção.
>
> O que **sobreviveu** ao pivô e continua em vigor: D-Deploy-4 (format + lint, já
> fechada), D-Deploy-5 (`requirements` pinados) e o workflow de CI. O que **morreu**:
> os dois Dockerfiles, o volume de SQLite, a D-Deploy-6 (CORS deixa de existir com o
> rewrite `/api`) e o preset `node-server` da D-Deploy-1.
>
> Fica registrada porque as alternativas descartadas aqui — e o motivo de cada uma —
> continuam informando as decisões novas.

**Seis decisões registradas em 23/08/2026, antes da implementação.** Um projeto, dois
serviços (`backend` e `frontend`), mesmo repositório, cada um com seu *root directory* e
seus *watch paths* — sem watch paths, um ajuste de CSS redeploya a API.

### D-Deploy-1: o frontend roda em Nitro `node-server`, fixado no `vite.config.ts`

**O frontend não é um SPA estático**, e isso não estava registrado em lugar nenhum. O
`vite.config.ts` delega para `@lovable.dev/vite-tanstack-config` (v1.8.0), que embute
`tanstackStart` + **Nitro** com preset default `cloudflare-module`:

```js
const preset = userNitroOpts.preset ?? process.env.NITRO_PRESET ?? "cloudflare-module";
```

Confirmado por três sinais: não existe `index.html` na raiz do frontend, `router.tsx`
exporta `getRouter` (convenção do TanStack Start) e o preset orquestra o build por Nitro.
Ou seja, **`npm run build` hoje produz um Cloudflare Worker**, não uma pasta servível — e o
builder automático do Railway falharia de forma silenciosa, com build "verde" e serviço que
não sobe.

O preset vai **fixo no `vite.config.ts`** (`nitro: { preset: 'node-server' }`), não via
`NITRO_PRESET` no ambiente. Se a variável faltasse, o build voltaria para Cloudflare sem
erro nenhum.

**Alternativas descartadas:** deployar o frontend na Cloudflare Workers (parte o deploy em
duas plataformas, contra o pedido de um projeto só); virar SPA estático agora (mexer no modo
de renderização de um app que funciona não é trabalho de fatia de deploy).

⬜ **Débito consciente registrado junto: o SSR não traz benefício real hoje.** Não há um
`loader:` nem um `createServerFn` em nenhuma rota — todo fetch é client-side via `useQuery`,
então o SSR entrega casca HTML e nada mais. É candidato a virar SPA estático numa fatia
própria, **sem prazo** e sem gatilho definido. Ver "Itens futuros".

### D-Deploy-2: SQLite em volume — e o backup manual é pendência com gatilho

Volume do Railway montado em `/data`, `DATABASE_URL=sqlite:////data/database.db`. O
`os.makedirs(..., exist_ok=True)` que já existe em `database.py` cobre a criação do
diretório.

🔴 **O risco que decide esta seção não é precisão decimal — é backup.** A questão do
`Numeric` gravado como `REAL` já está documentada em "Dinheiro é `Decimal`" e é conhecida e
tolerada. O risco novo é outro: **volume do Railway não tem backup automático**, e o alvo é
um arquivo único guardando dado financeiro real. Perder o volume é perder tudo, sem cópia
em lugar nenhum.

> ⬜ **PENDÊNCIA COM GATILHO — resolver antes do primeiro lançamento com dado real, não
> "algum dia".** Um processo de backup manual documentado e testado (`sqlite3 .backup` para
> um arquivo baixável, com periodicidade explícita e um restore já exercitado pelo menos uma
> vez). Backup que nunca foi restaurado não é backup. O gatilho é a primeira transação real
> digitada na UI em produção — não uma data.

Outras duas restrições, para estarem escritas antes de serem descobertas:

* **Volume prende o serviço a uma réplica.** Volume anexa a um serviço e não é compartilhado
  entre instâncias — escalar horizontalmente deixa de ser possível. Irrelevante para
  finanças pessoais, mas é decisão, não acidente.
* **Redeploy troca o container e o volume sobrevive** — é justamente o que se quer.

**Alternativa descartada por ora: Postgres gerenciado.** Resolveria de graça o compromisso
do `Numeric` (tem `NUMERIC(12,2)` exato) e traria backup gerenciado junto. Foi descartada
para o **primeiro** deploy por ser o passo maior — driver novo, o listener de
`PRAGMA foreign_keys` perde o objeto, e a suíte continuaria em SQLite, criando divergência
entre teste e produção. Escolher `DATABASE_URL` como nome da variável agora é o que deixa
essa porta aberta sem custo depois.

### D-Deploy-3: Alembic depois do deploy verde, antes do primeiro dado real

Não há Alembic e `create_all()` não faz `ALTER TABLE`. **Subir para produção é criar dado
real**, e a partir daí a próxima fatia que tocar `models.py` não tem caminho de deploy sem
perder dado — o histórico deste projeto mostra que essas fatias aparecem.

Antes do primeiro deploy seria atrasar sem necessidade (banco vazio, `create_all` basta).
Muito depois é tarde. A janela é: **deploy verde → Alembic → primeiro lançamento real**, a
mesma janela do backup da D-Deploy-2.

### D-Deploy-4: `npm run format` em commit isolado, e só então lint bloqueante no CI

O `npm run lint` acusa hoje **844 erros e 7 avisos**, todos de formatação Prettier, em
arquivos que ninguém tocou. Ligar o gate assim o faria nascer vermelho, e gate que nasce
vermelho é ignorado em uma semana.

O `format` vai em **commit sozinho**, sem nenhuma mudança de comportamento junto — o diff é
enorme e é a única forma de ele ser revisável. Só depois o lint entra como passo bloqueante.

**Alternativa descartada:** lintar só arquivo alterado. É menos trabalho hoje e deixa o
débito vivo indefinidamente.

### D-Deploy-5: `requirements` separado por ambiente e com versões pinadas

Hoje `requirements.txt` mistura produção e teste (`pytest`, `httpx` ao lado de
`fastapi`/`sqlalchemy`) e **não pina nada** — tudo `>=`. Duas consequências: a imagem de
produção carrega o runner de testes, e um rebuild daqui a meses pode puxar Pydantic ou
FastAPI com breaking change e quebrar o deploy sem ninguém ter tocado no código.

Passa a `requirements.txt` (produção) + `requirements-dev.txt` (`-r requirements.txt` mais
pytest e httpx), com versões exatas nos dois. É a mesma natureza da bomba-relógio de data em
teste já registrada: passa hoje, quebra sozinho depois.

### D-Deploy-6: CORS com origem restrita e `allow_credentials=False`

Hoje é `allow_origins=["*"]` **com** `allow_credentials=True`. Essa combinação é inválida
pela especificação de CORS; o Starlette contorna refletindo a origem da requisição em vez de
mandar `*`, o que na prática significa **"aceita qualquer origem, com credenciais"**.

O `apiFetch` não manda `credentials` em nenhuma chamada, então fechar não custa nada
funcionalmente: `CORS_ALLOW_ORIGINS` com o domínio do frontend e `allow_credentials=False`.

### Ordem de subida, e o ovo-e-galinha

O frontend precisa do domínio do backend **para buildar** (D-Deploy-1 + `VITE_API_BASE_URL`);
o backend precisa do domínio do frontend para o CORS (D-Deploy-6). A ordem que funciona:

1. Criar os dois serviços apontando para o mesmo repo, com root directory `/backend` e `/frontend`.
2. **Gerar os dois domínios públicos antes de qualquer deploy.**
3. Preencher `VITE_API_BASE_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}/api` e `CORS_ALLOW_ORIGINS`.
4. Deployar.

Tentar na ordem natural trava — cada serviço espera o outro.

### ⚠️ O 307 de barra final vira bug de conteúdo misto atrás do proxy

O FastAPI redireciona `/api/accounts` → `/api/accounts/` com **307**. Atrás do TLS do
Railway, o uvicorn por default só confia em `X-Forwarded-Proto` vindo de `127.0.0.1`, então
o `Location` sai como `http://` e o browser bloqueia por conteúdo misto. Por isso o `CMD`
leva `--forwarded-allow-ips='*'`.

**Hoje isto é latente, não ativo** — auditadas as 7 chamadas do front, todas batem exatamente
no padrão da rota declarada (`/accounts/`, `/categories/`, `/installments/`,
`/transactions/` com barra; `/dashboard/summary`, `/installments/summary`,
`/reports/overview` sem). A tabela de barra final está sendo respeitada à risca. Mas é uma
chamada mal escrita de distância de virar bug difícil de ler em produção.

### Primeiro deploy: só o seed

Volume novo e vazio; `init_db.py` cria `Conta Principal` (saldo inicial 10.000) e as 10
categorias padrão. **Nenhum dado local é migrado** — e não há tentação, porque o
`database.db` local tem exatamente o seed desde o reset da fatia do saldo derivado.

⚠️ **`init_db.py` passa a rodar a cada boot do container**, não mais só à mão: numa
plataforma com volume, é o único ponto que garante as tabelas num volume novo. Isso torna a
**idempotência do seed um requisito de produção**, não uma conveniência — se ela falhar,
cada redeploy duplica as 10 categorias. Há teste travando isso.

Smoke pós-deploy, nesta ordem: `/health` → `/api/accounts/` (saldo `"10000.00"`) →
`/api/dashboard/summary` (`total_balance` idêntico) → as cinco telas do frontend.

`.dockerignore` nos dois serviços (`database.db`, `.venv`, `__pycache__`, `node_modules`,
`.output`, `dist`), para o caso de alguém buildar da máquina local.

### CI: o gate é convenção enquanto o auto-deploy estiver ligado

Workflow do GitHub Actions com dois jobs paralelos, em PR e em push para `main`:

| Job | Passos |
|---|---|
| `backend` | `setup-python@3.12` → `pip install -r requirements-dev.txt` → `pytest` |
| `frontend` | `setup-node@22` + cache npm → `npm ci` → `tsc --noEmit` → `npm test` → `npm run lint` |

`package-lock.json` existe, então `npm ci` é viável — e em Linux ele resolve os binários
nativos sozinho; o problema de esbuild/rollup `win32` é local, não do CI.

⚠️ **O Railway auto-deploya no push para `main` e não espera o Actions.** Enquanto for
assim, "CI antes do deploy" é **convenção, não mecanismo** — mesma distinção que a seção
0.1 faz sobre teste dependente de data. Aceito conscientemente para a primeira subida.
Virar mecanismo exige desligar o auto-deploy e disparar o deploy pelo CLI dentro do
workflow, depois dos testes verdes.

---

