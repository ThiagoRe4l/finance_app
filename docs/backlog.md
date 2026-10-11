## 🧭 Itens futuros — **não decididos**

**Sem prazo. Nenhum é bug: a suíte está verde e o comportamento atual está correto.** Cada
um se resolve quando aparecer motivo concreto para investir, e passa pelo processo normal —
decisão registrada, teste vermelho, implementação.

| Item | Onde está registrado |
|---|---|
| Bloco "Fixas vs Variáveis" do Dashboard | aqui, item 0 |
| Mecanismo contra teste dependente de data | aqui, item 0.1 |
| Vitest para teste de componente | "Testes do frontend: runner nativo do Node" |
| SSR sem benefício → virar SPA estático | "🚢 Deploy → D-Deploy-1", e item 0.2 abaixo |
| Playwright medindo overflow em 360 px | "📱 Mobile-first → M-7" |
| PWA (manifest, instalável) | "📱 Mobile-first → M-8" |

### 0. "Fixas vs Variáveis" no Dashboard — removido, não implementado

**Decidido em 10/08/2026.** O bloco existia em `index.tsx` com valores inventados
(`R$ 2.205,90 / 71%` vs `R$ 914,60 / 29%`) e **nenhum dado correspondente na API**.
`DashboardSummary` não devolve a divisão fixa/variável das despesas.

Removido na integração do Dashboard. Calcular no front a partir de `recent_transactions`
seria errado — são 7 itens, não o mês.

Se voltar, é **fatia de backend**: dois `func.sum` sobre `Transaction.amount` filtrando por
`is_fixed`, dois campos novos em `DashboardSummary`, com decisão registrada e teste antes.
Não é urgente e não tem consumidor pedindo.

### 0.2. O SSR do frontend não paga o que custa

**Levantado em 23/08/2026**, ao mapear o deploy. Registrado como débito na D-Deploy-1.

O app é TanStack Start com SSR via Nitro, mas **não há um `loader:` nem um
`createServerFn` em nenhuma rota** — todo dado é buscado client-side por `useQuery`. O
servidor renderiza casca HTML e o browser refaz tudo. Em troca disso o projeto carrega: um
runtime Node em produção onde bastaria um servidor de arquivos, um build por Nitro com
preset que precisa ser fixado à mão, e uma classe inteira de erro (SSR/hidratação) que um
SPA não tem.

Virar SPA estático simplificaria build, deploy e custo. Não foi feito junto do deploy de
propósito: **mudar o modo de renderização de um app que funciona não é trabalho de fatia de
deploy**, e o ganho é operacional, não de produto.

Sem prazo e **sem gatilho definido** — ao contrário do backup e do Alembic, que têm um. Se
for feito, é fatia própria, com o cuidado de que hoje não existe teste de componente para
pegar regressão de renderização (ver o item do Vitest acima).

### 0.1. Não há mecanismo contra teste que depende do mês em que roda

**Levantado em 10/08/2026**, ao introduzir o recorte mensal das agregações.

Data literal num teste que assere `spent`/`txs_count`/`total_expenses` passa no mês em que
foi escrita e fica vermelha na virada, sem ninguém tocar em código. A suíte tinha exatamente
isso (`conftest.create_transaction` com `date="2026-08-07"` fixo, 15 usos em 7 arquivos) e
foi corrigida — mas **a proteção hoje é convenção, não mecanismo**: nada impede o próximo
teste de reintroduzir o problema, e ele passaria por semanas antes de quebrar sozinho.

Duas saídas possíveis, nenhuma decidida:

* **Relógio controlável** (`freezegun`, `time-machine`) e um teste que rode as agregações com
  a data adiantada. Dependência nova.
* **Fixture `autouse`** que rejeite data literal em teste que assere agregação. Sem
  dependência, mas é heurística sobre o código do próprio teste.

> Tentei construir a verificação com um plugin de relógio falso durante a implementação da
> fatia e não fechou — a instrumentação ficou mais frágil que o que ela verificava. A
> auditoria foi feita estaticamente (cruzando "arquivo tem data literal" com "função assere
> campo filtrado por mês"), que funciona uma vez mas não protege o futuro.

---

## 🧭 Candidatos ao dia 5 — **não decididos**

**Isto não é decisão registrada.** São duas observações levantadas ao revisar a lógica de
saldo do dia 4.1 (07/08/2026), deixadas explicitamente em aberto porque são **mudança de
arquitetura, não fix pontual**. Nenhuma das duas é bug: a suíte está verde e o
comportamento atual está correto. Ambas tratam de *exposição a risco futuro*.

Quem for implementar qualquer uma precisa passar pelo processo normal — decisão registrada
primeiro, depois teste vermelho, depois código.

### 1. ✅ `current_balance` armazenado vs. saldo derivado do ledger — **resolvido em 22/08/2026**

> Implementado. O registro abaixo fica como histórico da observação; o contrato em vigor
> está em "🧩 Design Patterns → Saldo é derivado do ledger, não armazenado".

**Observação.** `Account.current_balance` é campo mutável gravado no banco, e cada caminho
de escrita precisa lembrar de ajustá-lo. Até o dia 4.1 havia **um** (`create_transaction`);
agora há **três** (`POST`, `PATCH`, `DELETE` de transação). A superfície de erro triplicou
num único dia.

Os três estão cobertos, mas a proteção é por teste, não por construção: o quarto caminho que
alguém adicionar — um endpoint de importação, um script de seed, uma transferência entre
contas — não herda nada e pode gravar transação sem mexer no saldo. O sintoma é silencioso e
só aparece quando os números já não reconciliam.

**Alternativa a avaliar.** Saldo derivado: `initial_balance + SUM(ENTRADA) − SUM(SAÍDA)`
sobre as transações da conta, calculado na leitura. Torna o drift **estruturalmente
impossível** — não há o que esquecer de atualizar. Custo: uma agregação por leitura de conta
(hoje é um `SELECT` de coluna), e `AccountResponse.current_balance` deixa de vir do ORM
direto, virando exceção legítima do padrão "serialização direta" (mesma natureza do
`spent`/`txs_count` de `categories.py`).

**O que decidir:** vale trocar três pontos de escrita disciplinados por um custo de leitura
recorrente, num app de finanças pessoais onde o volume de transações é baixo.

### 2. ✅ `Float` → `Numeric`/`Decimal` — **resolvido em 08/08/2026**

> Implementado. O registro abaixo fica como histórico da decisão; o contrato em vigor está
> em "🧩 Design Patterns → Dinheiro é `Decimal`".

**Observação.** Todo valor monetário do projeto é `Float` (`models.py`: `amount`,
`current_balance`, `initial_balance`, `budget`, `total_amount`, `installment_amount`, mais
`Investment.current_balance` e `InvestmentHistory.balance` — 8 colunas ao todo) — ou seja,
ponto flutuante binário, que não representa exatamente frações decimais como `0.1`.

Isso é anterior ao dia 4.1, mas o `PATCH` aumentou a exposição: cada edição faz **duas**
operações sobre o saldo (estorno + reaplicação) onde antes havia uma. Erro de arredondamento
não some — acumula na coluna.

⚠️ **Os testes não pegariam isso.** Toda asserção de saldo usa `pytest.approx`, que tolera
justamente a diferença que um erro de centavo produziria. Não é falha da suíte — comparar
`Float` com `==` seria frágil pelo motivo oposto —, mas significa que **a suíte verde não é
evidência de exatidão monetária**.

**Decidido em 08/08/2026: `Numeric(12, 2)` + `Decimal` no Pydantic, nas 8 colunas.**

⚠️ **Correção de uma imprecisão registrada aqui antes.** A versão anterior desta seção dizia
que `Decimal` "eliminaria o risco de erro de centavo acumulado". **Não elimina, no SQLite.**
Apurado à mão em 08/08/2026 (SQLAlchemy 2.0.51 / SQLite 3.40.1): o SQLite não tem tipo decimal
nativo, `NUMERIC` é só afinidade, e o valor é gravado como `REAL` — `typeof()` devolve
`real`. O que o SQLAlchemy faz é **converter float→Decimal na leitura, quantizando na escala
declarada**.

Ou seja, o que se ganha é **arredondamento na leitura absorvendo o epsilon**, não
armazenamento exato. Na prática resolve o problema observável — `0.30000000000000004` nunca
chega ao JSON nem a uma comparação — porque o erro de ponto flutuante é menor que meio
centavo e some no arredondamento para 2 casas. Exatidão real de armazenamento só viria com
**centavos como `Integer`** (apurado do mesmo modo: `typeof=integer`, `SUM` exato), descartado por
contaminar o tipo de todo campo monetário na API e forçar conversão em toda fronteira.

**Impacto no contrato:** o Pydantic v2 serializa `Decimal` como **string** JSON —
`{"amount": "342.50"}`, não `342.5`. Não é configuração, é o default. Restrição registrada
para a integração do front: **toda resposta monetária vem como string e precisa ser parseada
antes de formatar ou somar**. `formatBRL`/`Intl.NumberFormat` e as reduções dos mocks
(`items.reduce((s, i) => s + i.installment, 0)`) não funcionam direto sobre string.

Percentuais e médias (`balance_change_pct`, `expenses_change_pct`,
`savings_pct_of_revenue`, `average_savings`) **continuam `float`** — são razões, não
dinheiro; divisão em `Decimal` gera dízima de 28 dígitos e obrigaria a arredondar
arbitrariamente.

Custo: migração de coluna — e **não há Alembic no projeto**, então isso esbarra na mesma
restrição do checklist (`create_all()` não faz `ALTER TABLE`). Enquanto o banco só tiver
dados de seed, o recreate resolve; depois do primeiro dado real, passaria a exigir
migrations. **Foi o que tornou este item sensível a prazo** e o motivo de ser feito agora.

---

## 🧭 Overflow horizontal em 1280 px — **verificado em 08/10/2026: sem overflow; os prints só estavam cortados**

Levantado nos prints de DevTools em 1280×1024 (`.claude/prints/`, 08/10/2026): nas 5 telas o
conteúdo parecia encostar ou passar da borda direita — o botão "Nova transação"/"Nova
categoria"/"Novo parcelamento", a última coluna de cartões e a legenda "Saídas".

**Conferido pelo usuário no navegador:** `scrollWidth - clientWidth` deu `0` no Dashboard e em
Transações. Não há overflow; o corte era do print. Nada a fazer.

## 🧭 Contrato mobile-first — pontos de revisão adiados (registrado em 09/10/2026)

**Não decidido, sem prazo.** Sobras das revisões dos commits `dc35ba2` e `8e3adbd` em
`frontend/src/lib/mobile-contract.ts` e `mobile-contract.test.ts`. Nenhum deixa violação
passar; ficam registrados em vez de corrigidos.

* **`withHits` depende do texto da mensagem.** Ele relê a frase de `comparePending`
  (`l.split(":")[0]`) para achar a chave `"<regra> <arquivo>"`. Reformular a mensagem faz as
  linhas das violações sumirem do erro em silêncio (a falha continua, só perde o detalhe).
  Saída provável: `comparePending` devolver `{rule, file, n, limit}` e formatar só na asserção.
* **P2 em `cn(...)` com quebra de linha conta 2.** A mesma violação é vista pela tag de
  abertura e pela string, em linhas diferentes. Nada escapa, mas corrigir uma baixa a lista em
  2. A violação real de hoje (`transacoes.tsx`) é de uma linha só e conta 1.
* **Rótulo ✅ em `comparePending: contagem igual à lista não acusa nada`.** O ✅ marca teste que
  já passava contra o código antigo; este testa uma função que nasceu no mesmo commit.
* **Miudezas:** linha ` *` vazia no fim do JSDoc de `comparePending`; `m.index ?? 0` repetido em
  `findViolations`.

**Sobras da revisão do commit `01c0214`** (registradas em 10/10/2026). Também nenhuma deixa
violação real passar hoje:

* **`node:fs` em `src/lib/`.** `mobile-contract.ts` importa `readdirSync`, e `lib/` é descrito
  como "funções puras". Só os testes o importam; um componente que importasse `findViolations`
  quebraria o bundle. Saída provável: varredura (`scanFiles`/`scanDirs`) num módulo só de teste.
* **Duas razões de mudança no mesmo arquivo:** o detector muda com o Tailwind, a varredura com
  a árvore de pastas. Mesma saída do item acima.
* **A guarda de diretórios perdeu independência.** `scanFiles` e `scanDirs` usam o mesmo
  `isExcluded`: uma exclusão errada encolhe as duas listas juntas, e só o piso de 7 pastas
  acusa. Pasta que seja link simbólico é pulada pelas duas sem aviso (já era assim antes).
* **Laço sobre `EXCLUDED_DIRS` é tautológico:** confere a implementação contra a própria
  constante. O teste da árvore temporária atenua, porque escreve `components/ui` por extenso.
* **A árvore temporária dos testes não é apagada:** sobra uma pasta no diretório temporário a
  cada execução. Saída: `after(() => rmSync(..., { recursive: true }))`.
* **`repeat(auto-fill,…)` junto de 5 trilhas fixas passa no P1**, porque qualquer
  `auto-fill`/`auto-fit` torna a grade adaptável. Não aparece em nenhuma tela.
* **P2 assimétrico no `!`:** aceita `!` no lado que revela, não no `opacity-0`
  (`!opacity-0 group-hover:opacity-100` passa).
* **`variants()` divide por `:` sem respeitar colchetes.** Não muda resultado hoje; fica frágil
  para variante arbitrária com `:` dentro.

## 🧭 Relatórios com overflow horizontal a 360 px que o P6 não pegou (registrado em 10/10/2026)

**Não decidido; investigar na fatia 5.** No emulador Android (360×800), visto pelo usuário, o
Relatórios tem overflow horizontal: os cards e o Comparativo passam da largura da página. O
contrato não acusou porque o P6 só vê **classe de largura fixa** (`w-[Npx]`, `w-80`, `w-96`);
overflow por conteúdo (texto que não quebra, `flex` sem `min-w-0`, soma de gaps e paddings)
não é string de classe. A causa não foi investigada. É o caso que o item futuro do Playwright
(`docs/mobile-first.md` → M-7) mediria.

## 🧭 Cabeçalho do Dashboard: `Header` local × `PageHeader` (registrado em 11/10/2026)

**Não decidido; tratar na fatia 3.** `routes/index.tsx` tem uma função `Header` local; as outras
4 telas usam `components/dashboard/PageHeader.tsx`. As classes do `<header>`, do eyebrow, do `h1`
e do invólucro da ação são as mesmas. A diferença visual é uma: o parágrafo de descrição do
`PageHeader` tem `max-w-xl`, o do `Header` local não — no desktop a descrição do Dashboard pode
ficar mais larga. Fora disso, o `Header` local sempre renderiza o eyebrow e o invólucro da ação
(o `PageHeader` só com a prop). Ficou fora da 1b porque unificar mudaria o desktop (M-9).

## 🧭 Pendência de documentação — referências ao CLAUDE.md (registrada em 08/10/2026)

**Não decidido, sem prazo.** Na reorganização de 08/10/2026 as seções foram movidas para
`docs/` sem reescrita. Duas classes de referência ficaram apontando para o lugar antigo; o
índice do `CLAUDE.md` resolve as duas por título, e nada aqui foi reescrito.

1. **Comentários no código que citam o CLAUDE.md** — 81 ocorrências em `backend/`,
   `frontend/` e `.github/` (`grep -rn "CLAUDE.md" backend frontend .github`). Nenhuma é lida
   por código ou teste; são só ponteiros de leitura.
2. **Referências internas entre seções que agora moram em arquivos diferentes.** Linhas do
   `CLAUDE.md` em `3abd382`:
   * do tipo "acima/abaixo": **L1833** (Railway → "🚢 Deploy — Vercel + Neon" *logo abaixo*;
     já estava errada antes, a seção ficava acima).
   * por nome de seção: L67, L84, L193, L309, L348, L363, L484, L516, L533, L538, L574,
     L695, L808, L1086, L1409, L1465, L1585, L1587 (×2), L1588, L1875, L1884, L2066, L2220,
     L2484, L2485, L2486, L2487, L2558, L2583, L2647, L2648, L2659, L2735, L2785, L2803,
     L3045, L3228.
   * ⚠️ L2647–L2659 ("📐 Processo → Onde escrever") mandam registrar decisão "neste arquivo",
     em "🧩 Design Patterns" e "🔌 Status da Integração" — que agora são arquivos em `docs/`.
