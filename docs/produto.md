## 🎯 Produto — princípios e requisitos originais

**Origem.** Conteúdo do antigo `GEMINI.md` ("Project Constitution & Specification"), fundido no
`CLAUDE.md` e neste arquivo em 11/11/2026, a pedido do usuário. O `GEMINI.md` saiu do
repositório no mesmo commit; o texto original continua no histórico do git
(`git log --all -- GEMINI.md`, e `git show <commit>^:GEMINI.md` no commit da remoção).

### Princípios (a "constituição" original)

Os quatro princípios, com o que cada um virou:

| Princípio original | Onde vive hoje |
|---|---|
| **Ambiente Confinado (AI Jail):** código testado e executado só dentro do container | `CLAUDE.md` → "🧱 Ambiente de Execução e Isolamento", que registra o limite real (o bind mount do Windows não é isolado) |
| **Persistência garantida:** o banco sobrevive à destruição do container | Superado pelo pivô: produção em Postgres no Neon (`docs/deploy-vercel-neon.md`); localmente, SQLite em arquivo |
| **Arquitetura orientada a contratos:** API REST tipada, consumida respeitando as interfaces | `docs/design-patterns.md` e `backend/openapi.json` versionado |
| **Anti-Vibe Coding:** nenhum código sem plano técnico aprovado | `CLAUDE.md` → "📐 Processo", que deu mecanismo ao princípio |

### Requisitos originais (user stories)

⚠️ **Histórico, anterior ao pivô multiusuário.** Os critérios abaixo são os de origem; onde o
projeto mudou, a nota diz o que vale.

**US-01 — Contas bancárias e saldos.** Cadastrar contas (ex.: Banco Inter, dinheiro em espécie,
NuConta) com saldo inicial; listar todas; exibir o saldo consolidado.
*Hoje:* contas por dono (`docs/multiusuario.md`); saldo **derivado do ledger**, não gravado
(`docs/design-patterns.md` → "Saldo é derivado do ledger, não armazenado").

**US-02 — Fluxo de caixa (entradas e saídas).** Cada transação tem tipo, valor, data, categoria e
conta; saída decrementa e entrada incrementa o saldo.
*Hoje:* o "decrementa/incrementa" deixou de ser escrita no saldo — o saldo é a soma das
transações. Valor em `Decimal` (`docs/design-patterns.md` → "Dinheiro é `Decimal`").

**US-03 — Investimentos (manual).** Cadastrar investimento (ex.: Tesouro Selic, ações, FII) e
atualizar o saldo à mão, com histórico simples.
*Hoje:* existe no backend (`routers/investments.py`); **nenhuma tela do frontend o consome**.

### Stack original — descartada

O plano técnico previa React + Vite, FastAPI **ou Flask** e SQLite em `database.db`. A stack em
vigor está no `CLAUDE.md` → "🛠️ Arquitetura e Pilha Tecnológica"; a árvore de diretórios
sugerida pelo `GEMINI.md` foi descartada sem cópia.
