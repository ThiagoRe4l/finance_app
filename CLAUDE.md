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

### 🎨 Frontend (`/frontend`)
* **Framework:** React + Vite + TypeScript
* **Roteamento:** TanStack Router (`src/routes/`)
* **Estilização e Componentes:** Tailwind CSS + Shadcn/UI (`src/components/ui/`) + Recharts
* **Comunicação com API:** Axios/Fetch centralizado em `src/lib/api.ts`

---

## 🧰 Comandos de Execução e Desenvolvimento

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

**Lacuna conhecida no cliente:** `lib/api.ts` implementa apenas `get`, `post` e `delete`.
**Não há `put` nem `patch`** — se alguma tela precisar de edição, o método terá que ser
adicionado ao objeto `api`. Vale notar que o backend também ainda não expõe rotas de
atualização (`PUT`/`PATCH`) em nenhum router.

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

### Validação de regra de negócio no schema, não no router

Regras que dependem só do payload ficam em `@model_validator(mode="after")` no schema e
retornam **422** automaticamente. Exemplo: `TransactionCreate.check_fixed_and_installment_exclusive`
rejeita `is_fixed=True` junto de `installment_id`. Já validações que precisam do banco ficam no
router e retornam **404** (ex.: `installment_id` inexistente).

**Ordem importa no router:** valide todas as FKs **antes** de mutar saldos. Em
`create_transaction`, a checagem do parcelamento vem antes do débito/crédito na conta — senão
um ID inválido deixaria o `current_balance` corrompido.

---

## ✅ Checklist Pós-Implementação

Rodar após **qualquer** mudança em `models.py` ou `schemas.py`:

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

3. **Conferir o `/docs`.** Suba o servidor e abra `http://localhost:8000/docs` para validar que
   os campos novos aparecem no schema. O OpenAPI é gerado em runtime — **não** é preciso editar
   `backend/openapi.json` à mão.

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
