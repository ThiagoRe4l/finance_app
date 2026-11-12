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

### Categoria é foreign key, não string

**Decisão registrada antes da implementação em 07/08/2026.**

`Transaction.category_id` e `Installment.category_id` são FK **NOT NULL** para `categories.id`,
com `ondelete="RESTRICT"`. Categoria inexistente retorna **404** no router — mesmo padrão de
`installment_id`.

**Alternativa descartada:** manter string e normalizar (lower/trim) na comparação. Resolveria
só a case-sensitivity e deixaria de pé o caso pior — transação com categoria não cadastrada
era aceita e sumia da agregação. Normalizar não cria vínculo.

**Impacto no contrato:** `POST /transactions` e `POST /installments` exigem `category_id: int`;
as responses trocam a string por `category: CategoryRef` aninhado (`id`, `name`, `color`,
`icon_name`), para o front pintar a badge sem uma segunda chamada.

Pontos que os testes travam (`test_category_fk.py`):

* **`spent` filtra `type == "SAÍDA"`, `txs_count` conta a categoria inteira** (ENTRADA
  incluída). A assimetria é intencional; não "corrija" sem olhar o teste.
* **O join em `list_categories` é OUTER.** Categoria sem movimento tem que continuar
  aparecendo zerada — um `INNER JOIN` a faz sumir da listagem e do `category_distribution`
  do dashboard, que reusa a mesma função.
* **Validar a FK antes de mutar saldo.** Em `create_transaction` a checagem de categoria vem
  antes do débito, senão um ID inválido deixa `current_balance` corrompido.

> A agregação por FK substituiu um loop que rodava duas queries por categoria. Se precisar
> mexer, é um `GROUP BY` com `CASE` — não volte para o loop.

### Saldo é derivado do ledger, não armazenado

**Decidido em 15/08/2026, implementado em 22/08/2026.** Fecha o item 1 dos "Candidatos ao dia 5".

`Account.current_balance` era coluna mutável, e cada caminho de escrita precisava lembrar
de ajustá-la. Eram **três** (`POST`, `PATCH`, `DELETE` de transação), todos cobertos por
teste — mas a proteção era por disciplina, não por construção.

**O que decidiu a mudança:** qualquer escrita que não passe pelos routers deixa o saldo
obsoleto — seed, script de importação, migração, SQL cru. Dois testes provam isso
(`test_derived_balance.py`), falhando contra o mecanismo armazenado.

⚠️ **Correção de um argumento usado ao decidir.** O mapeamento afirmou que o `ON DELETE
CASCADE` já provava a divergência. **Não provava.** O CASCADE de `Transaction.account_id`
dispara ao apagar a *conta*, então conta e transações somem juntas e não sobra saldo
obsoleto. O teste de CASCADE passa antes e depois da mudança — é regressão, não motivação.
O argumento verdadeiro é sobre caminhos externos ou futuros, não sobre defeito já presente.

**A coluna foi removida**, não mantida como campo morto: campo que ninguém mais atualiza é
campo que alguém preenche errado. `AccountResponse.current_balance` passa a ser **campo
derivado** — exceção declarada ao padrão de serialização direta do ORM, mesma natureza de
`spent`/`txs_count` em `categories.py`.

Fórmula: `initial_balance + SUM(ENTRADA) − SUM(SAÍDA)`, sem recorte de data — saldo é
acumulado por definição, ao contrário de `spent`, que é do mês.

`_apply_to_balance` e as três escritas **sumiram**. O `PATCH` deixou de precisar estornar e
reaplicar; o `DELETE`, de estornar. A ordem "valide as FKs antes de mutar saldo" perdeu o
objeto — não há mais saldo a corromper no meio de uma requisição.

`dashboard.total_balance` passa de `SUM(current_balance)` para
`SUM(initial_balance) + SUM(ENTRADA) − SUM(SAÍDA)`.

**`app/account_balance.py` centraliza a regra**, no mesmo espírito de `periods.py` e
`installment_metrics.py`. São dois consumidores — `GET /accounts` e o `total_balance` do
dashboard — e o que se compartilha é o `CASE` de sinal (`ledger_delta()`), a parte que
inverteria de um lado só e faria a mesma métrica ter dois valores no mesmo app. As duas
agregações continuam independentes (uma agrupa por conta, a outra é global);
`test_total_balance_matches_the_sum_of_the_accounts` é o que trava a igualdade entre elas.

⚠️ **O `outerjoin` de `accounts_with_balance` não é estético** — é o mesmo motivo do OUTER
em `_aggregated_rows`: com `INNER JOIN`, conta sem transação nenhuma sumiria da listagem. O
`coalesce(..., Decimal("0.00"))` é o par disso, senão o saldo dela viria `null` no JSON em
vez do saldo inicial.

`POST /accounts` responde pela **mesma** agregação, não por `initial_balance` direto. Conta
recém-criada não tem transação e os dois valores coincidem hoje — repetir a fórmula é
exatamente como os dois endpoints começariam a divergir depois.

**Custo de leitura.** `GET /accounts` vira `LEFT JOIN` + `GROUP BY` em vez de `SELECT` de
coluna. A agregação cresce com o **total histórico de transações**, não com o número de
contas — 5 anos de uso pessoal são ~5.000 linhas, triviais com o índice de `account_id` que
a FK já cria. O ponto de virada realista exigiria dezenas de milhares de lançamentos **e**
`/accounts` sendo chamado com frequência; hoje é uma vez por formulário aberto.

### Dinheiro é `Decimal`, nunca `float`

**Decidido e implementado em 08/08/2026.** As 8 colunas monetárias usam o alias `MONEY =
Numeric(12, 2)` (`models.py`); os campos correspondentes em `schemas.py` são `Decimal`.

⚠️ **O que isso resolve, com precisão.** O SQLite **não** tem tipo decimal nativo: `NUMERIC`
é só afinidade e o valor é gravado como `REAL` (apurado à mão com `typeof()`; **não há teste
cobrindo isso** — ver a ressalva abaixo). O
ganho é a conversão float→`Decimal` **na leitura**, quantizada na escala, que absorve o
epsilon antes de o valor chegar a uma comparação ou ao JSON. **Não é armazenamento exato** —
exatidão real exigiria centavos como `Integer`, descartado por contaminar o tipo de todo
campo monetário da API.

**Contrato: dinheiro é string no JSON.** O Pydantic v2 serializa `Decimal` como string —
`{"amount": "342.50"}`, não `342.5`. É o default, não configuração.

> 🚧 **Restrição para a integração do front.** Toda resposta monetária precisa ser parseada
> antes de formatar ou somar. `formatBRL`/`Intl.NumberFormat` e as reduções que estão nos
> mocks (`items.reduce((s, i) => s + i.installment, 0)`) **não funcionam direto sobre
> string**. Vale para `amount`, `current_balance`, `initial_balance`, `budget`, `spent`,
> `total_amount`, `installment_amount`, `income`/`outcome`, `value` e os `total_*` do
> dashboard.

**Percentuais e médias continuam `float`**: `balance_change_pct`, `expenses_change_pct`,
`savings_pct_of_revenue` e `average_savings`. São razões, não dinheiro — divisão em `Decimal`
gera dízima de 28 dígitos e obrigaria a arredondar arbitrariamente. Os routers fazem
`float(...)` explícito na saída desses três.

**A escala faz parte do contrato.** Os fallbacks são `Decimal("0.00")`, não `Decimal(0)` nem
`0.0` — inclusive o `coalesce`/`case` de `categories.py`, que é o caminho da categoria sem
movimento. Duas razões:

* `"0.00"` previsível é o que torna a string parseável sem caso especial no front.
* Misturar `Decimal` com `float 0.0` levanta **TypeError**, não devolve número errado. E o
  erro **não** aparece quando as duas pontas caem no fallback (`0.0 - 0.0` é válido) — só no
  caso misto, tipo "mês em que só entrou salário". `test_money_precision.py` força cada
  combinação.

`sum()` sobre `Decimal` precisa de `start` explícito (`sum(..., ZERO)`): sem ele, uma
sequência vazia devolve `int 0` e a conta seguinte volta a misturar tipos.

### Agregação de categoria é do **mês corrente**, não acumulada

**Decidido em 10/08/2026, antes da implementação.** Corrige bug de produção, não só
inconsistência nova.

**O defeito.** `_aggregated_rows` (`categories.py`) fazia `outerjoin` em `Transaction` sem
filtro de data: `spent` e `txs_count` eram acumulados de todos os tempos. Mas `budget` é
**orçamento mensal** (está no próprio `Field(description=...)`), e `categorias.tsx` desenha
`spent / budget`. Consequência: a barra de progresso só cresce, e depois de alguns meses
**toda** categoria aparece permanentemente estourada. Já estava entregue e já valia para o
`PATCH` de budget do dia 4.1.

No dashboard o mesmo dado divergia de `total_expenses`, que é do mês — verificado: 900 no
mês passado + 100 neste dava `spent: "1000.00"` contra `total_expenses: "100.00"`, e uma
participação de 1000%.

**A correção.** `_aggregated_rows` filtra `[primeiro_dia_do_mês, primeiro_dia_do_mês_seguinte)`.
`txs_count` acompanha o mesmo recorte. Mês corrente fixo — sem `?month=`, que seria
superfície de API nova sem consumidor pedindo.

**O teto que faltava.** `total_revenues`/`total_expenses` usavam `date >= first_day` **sem
limite superior**, então contavam lançamento datado no futuro (parcela agendada, boleto a
vencer). O laço do `monthly_flow` sempre usou o intervalo semiaberto correto. Verificado:
uma transação do mês seguinte dava `total_expenses: "500.00"` e
`monthly_flow[-1].outcome: "0.00"` — dois números divergentes na mesma tela. Os três passam
a usar o mesmo recorte semiaberto.

**Mudança de contrato:** `GET /api/categories/` → `spent` e `txs_count` deixam de ser
acumulados. Consumidores hoje: o dashboard e `categorias.tsx` (ainda mockada).

⚠️ **A suíte tinha uma bomba-relógio que esta fatia desarma.** `conftest.create_transaction`
usava `date="2026-08-07"` fixo — 15 usos em 7 arquivos, 20 asserções sobre `spent`. Com o
filtro de mês, essas asserções passariam em agosto/2026 e ficariam vermelhas em setembro,
**sem ninguém tocar em código**. O default passou a ser a data de hoje. Teste que precise de
data específica deve derivá-la de `datetime.date.today()`, no padrão que
`test_dashboard.py::_month_offset` já usava.

### `insights` sai do contrato da API — texto é apresentação

**Decidido em 13/08/2026, antes da implementação.** Mudança de contrato, feita junto da
integração da tela de Relatórios.

**Por quê.** `ReportSummary.insights: List[str]` devolvia **frases prontas em português**,
montadas no servidor. Isso contraria o padrão firmado no dia 3 — *o backend expõe dados
crus e não duplica lógica de apresentação* —, que foi exatamente a regra que tirou o rótulo
Fixa/Variável/Parcelada do backend e o pôs em `lib/transactions.ts`. Idioma, redação e
formatação são do front.

**Três defeitos concretos, todos em produção**, encontrados na auditoria:

* **O insight de "Moradia" mentia.** Era condicionado à *presença* da categoria no top 4, não
  a ela ser a maior. Verificado com Moradia em **último lugar** com R$ 1,00: a API afirmava
  "Despesas com Moradia representam a maior fatia do seu orçamento".
* **Formatação em locale errado.** `f"R$ {avg_saving:,.2f}"` produz `R$ 1,915.94` — vírgula
  de milhar e ponto decimal, formato americano, num app em português.
* **O `else` era conselho genérico** (*"Mantenha o foco em reduzir gastos variáveis"*), sem
  dado nenhum por trás.

**Dos 4 insights do mock, só 1 tinha lastro:** o de parcelamentos. Os outros três eram
decoração — "economia cresceu +18% nos últimos 3 meses" (não existe janela de 3 meses),
"despesas fixas representam 71%" (é o "Fixas vs Variáveis" já removido do Dashboard) e
"Alimentação 17% acima da média trimestral" (não existe média trimestral por categoria).

E os textos do mock **nunca tiveram relação** com os que a API devolvia: eram 4 de um lado e
3 outros do outro, e o front ignorava o campo.

**O que fica.** A tela monta o insight de parcelamentos a partir de
`GET /api/installments/summary` (`active_count`, `monthly_committed_amount`), em função pura
testável — mesmo padrão de `formatDelta`. A tela de Relatórios passa a consumir dois
endpoints.

**Impacto no contrato:** `GET /api/reports/overview` deixa de devolver `insights`. Único
consumidor era `relatorios.tsx`, que ignorava o campo.

### `top_categories` do relatório usa a mesma janela do resto do relatório

**Decidido em 13/08/2026, antes da implementação.** Bug em produção, encontrado na
auditoria de `reports.py` durante o mapeamento da tela de Relatórios.

**O defeito.** `get_report_overview` monta `total_revenues`/`total_expenses` somando os 6
meses de `monthly_flow`, mas `top_cats_query` filtra apenas `type == "SAÍDA"` — **sem
recorte de data**. As duas metades do mesmo relatório falavam de períodos diferentes.

Verificado: com R$ 9.000 gastos há 13 meses e R$ 850 nos últimos 6,
`total_expenses` = `"850.00"` e `top_categories[0].value` = `"9050.00"`. A "maior categoria"
sozinha valendo 10× o total de despesas do período, lado a lado na mesma tela.

É o mesmo defeito de `_aggregated_rows` corrigido em 10/08 — sobreviveu aqui porque
**`reports.py` nunca teve arquivo de teste próprio**.

**A correção.** `top_cats_query` passa a usar a janela dos últimos 6 meses, a mesma do
`monthly_flow`, via `periods.trailing_months_bounds(6)`. O recorte volta a ser semiaberto,
`[primeiro dia de 5 meses atrás, primeiro dia do mês seguinte)`.

**A lacuna estrutural também fecha:** a fatia cria `tests/test_reports.py`. Até aqui a única
rota de `reports.py` era coberta de raspão por dois testes que moram em outros arquivos.

**Invariante que o teste trava:** a soma de `top_categories` não pode passar de
`total_expenses`. Com 4 categorias ou menos, é igualdade.

### Enforcement de foreign key precisa ser ligado explicitamente

O SQLite abre **toda** conexão com `PRAGMA foreign_keys = 0`. Sem isso ligado, os `ondelete`
declarados nos models são decorativos: o banco aceita linha órfã e ignora
`CASCADE`/`SET NULL`/`RESTRICT` em silêncio. Foi o estado do projeto até 07/08/2026 — o
`CASCADE` de `account_id` e o `SET NULL` de `installment_id` nunca foram aplicados.

`app/database.py` expõe `enable_sqlite_foreign_keys(engine)` e o aplica ao engine da
aplicação. **Todo engine novo precisa passar por ela** — inclusive os de teste. Se você criar
um engine e esquecer, as FKs voltam a ser decorativas só naquele contexto, que é o tipo de
divergência que só aparece em produção.

### Validação de regra de negócio no schema, não no router

Regras que dependem só do payload ficam em `@model_validator(mode="after")` no schema e
retornam **422** automaticamente. Exemplo: `TransactionCreate.check_fixed_and_installment_exclusive`
rejeita `is_fixed=True` junto de `installment_id`. Já validações que precisam do banco ficam no
router e retornam **404** (ex.: `installment_id` inexistente).

**Ordem importa no router:** valide todas as FKs **antes** de mutar saldos. Em
`create_transaction`, a checagem do parcelamento vem antes do débito/crédito na conta — senão
um ID inválido deixaria o `current_balance` corrompido.

> ⚠️ **Exceção aberta em 07/08/2026 para os PATCH parciais.** Ver "Operações de escrita"
> abaixo: num payload parcial o validador de schema deixa de funcionar, e a regra
> `is_fixed` × `installment_id` migra para o router com status **400**.

### Operações de escrita (PATCH/DELETE) — decisões do dia 4

**Registrado em 07/08/2026, antes da implementação.** Até aqui nenhum router expunha
`PUT`/`PATCH`/`DELETE`. O dia 4 fecha isso em duas fatias: **4.1 = transactions +
categories** (bloco de risco, mexe em saldo), **4.2 = installments** (`current_installment`,
não toca saldo). Contas e investimentos ficam fora — sem tela e sem consumidor previsto.

**Só `PATCH`, nunca `PUT`.** Toda edição de tela é parcial e cada verbo novo custa um método
em `lib/api.ts`. Alternativa descartada: `PUT` com payload completo — obrigaria o front a
reenviar campos que ele não editou, e reintroduziria a possibilidade de zerar campo por
omissão.

**`DELETE` devolve 204 sem corpo.** Isso **quebra o `api.delete` atual**: `apiFetch`
(`frontend/src/lib/api.ts`) faz `return response.json()` incondicionalmente, e parsear corpo
vazio rejeita a promise mesmo em sucesso. O ajuste no `apiFetch` faz parte da entrega, não é
tarefa futura.

#### Saldo: toda escrita que mexe em transação reexecuta o efeito

`create_transaction` faz `current_balance ±= amount`. Logo:

* **`PATCH` estorna o efeito antigo e aplica o novo** — nunca aplica delta sobre o valor já
  gravado. Editar valor/tipo sem estornar faz o saldo derrapar em silêncio a cada edição, e
  o erro só aparece meses depois, irreconciliável.
* **`DELETE` estorna** o efeito da transação apagada.
* **`type` pode trocar** (ENTRADA↔SAÍDA). É a operação de maior oscilação: `2 × amount`. Tem
  teste dedicado conferindo o saldo final aritmeticamente, não por sinal.
* **`account_id` NÃO pode trocar na v1** — mudaria dois saldos numa requisição. Para mover
  uma transação de conta: apagar e recriar.

#### Transação: o que pode mudar depois de criada

| Campo | Regra |
|---|---|
| `title`, `amount`, `date`, `category_id` | livres (`category_id` inexistente → 404) |
| `is_fixed` | livre |
| `type` | livre, com estorno + reaplicação |
| `installment_id` | **só desvincular** (`→ null`). Vincular uma avulsa ou trocar de parcelamento → 400 |
| `account_id` | rejeitado (**422**, campo não existe no schema de update) |

**`account_id` é 422 por `extra="forbid"`, não por omissão.** Se o schema apenas ignorasse o
campo, `PATCH {"account_id": 2}` seria aceito com 200 e não faria nada — o cliente acharia
que moveu a transação. Mesmo raciocínio de `test_legacy_category_string_is_no_longer_accepted`:
contrato recusado tem que falhar barulhento.

> **Regra geral (07/08/2026): IDs de relacionamento central são imutáveis via `PATCH` em
> toda a API.** Vale para `Transaction.account_id` e `Installment.account_id`. Os motivos
> são diferentes — na transação o veto é concreto (mover mexeria em dois saldos), no
> parcelamento é uniformidade de contrato, já que ele não toca saldo. A regra é única de
> propósito: o mesmo campo não deveria mudar de mutabilidade conforme o endpoint. Para
> mover de conta: excluir e recriar.

#### Parcelamento: o que pode mudar depois de criado (dia 4.2)

| Campo | Regra |
|---|---|
| `title`, `end_date`, `category_id` | livres (`category_id` inexistente → 404) |
| `current_installment` | livre, **inclusive acima de `total_installments`** (= quitado) |
| `installment_amount`, `total_installments`, `total_amount` | **409** se houver transação vinculada |
| `account_id` | rejeitado (**422**), pela regra geral acima |

**Avanço de parcela é `PATCH` genérico, não ação dedicada.** Alternativa descartada:
`POST /installments/{id}/advance`. Seria padrão novo no projeto para um `UPDATE` de uma
coluna, e exigiria registro de arquitetura próprio sem ganho sobre o `PATCH`.

**`current_installment > total_installments` é estado válido**, não erro. Uma validação
`current <= total` parece defensiva e quebraria justamente o caso de negócio (parcelamento
quitado). Não adicione.

**O bloqueio dos três valores é por _mudança_, não por presença do campo.** Reenviar
`installment_amount: 500.0` quando já é `500.0` passa. Um formulário de edição manda o
objeto inteiro, então bloquear por presença tornaria a tela inutilizável em qualquer
parcelamento que já tenha parcela lançada.

**`total_amount` entrou na trava depois.** A decisão original nomeava só
`installment_amount` e `total_installments`; deixar o terceiro aberto permitiria 12 parcelas
de 500 com `total_amount` = 9000, e a tela de parcelamentos calcula "Saldo a pagar" a partir
desses campos — a incoerência apareceria direto na UI.

**409 e não 400** porque o bloqueio vem da *existência de uma linha relacionada*, mesma
natureza de C9/C10, e não de uma combinação inválida de campos. Isso estende a convenção de
status de "exclusão bloqueada por referência" para "**escrita** bloqueada por referência".

#### `GET /api/installments/summary` — totais da tela de parcelamentos

**Decidido em 13/08/2026, antes da implementação.**

A tela precisa de três números no topo: parcelamentos ativos, comprometido/mês e saldo a
pagar. Os dois primeiros já existiam em `DashboardSummary`; o terceiro não existia em lugar
nenhum e o mock o calculava somando no cliente.

**Endpoint próprio, não campo novo no dashboard.** Alternativa descartada: pendurar
`remaining_total_amount` em `DashboardSummary` e a tela de parcelamentos buscar o resumo do
dashboard. Funcionaria, mas deixaria a tela com duas requisições e leria mal — tela de
parcelamentos consultando o resumo geral para preencher o próprio cabeçalho. Com endpoint
próprio é uma requisição e o contrato do dashboard não incha.

**Alternativa também descartada: somar no front** com aritmética de centavos inteiros. Era
mais barata (uma função pura, zero backend), mas espalharia a regra de negócio — "saldo a
pagar é parcela × parcelas restantes" — para o cliente, enquanto `monthly_committed_amount`
já vive no servidor. Metade da conta de cada lado é pior que qualquer um dos dois inteiro.

**`app/installment_metrics.py` centraliza a regra**, no mesmo espírito de `periods.py`:
`dashboard.py` e o router novo compartilham a definição de "ativo"
(`current_installment <= total_installments`) em vez de duplicá-la. Duplicar é como o `<=`
frágil do 4.3 viraria `<` num dos dois lados sem ninguém notar.

**`remaining_amount` entra em `InstallmentResponse` como campo derivado**, e é **exceção
declarada ao padrão de serialização direta do ORM** — mesmo tratamento de `spent`/`txs_count`
em `categories.py`. Fórmula: `installment_amount × (total_installments - current_installment + 1)`,
com a contagem de parcelas limitada a `[0, total_installments]`.

O `+1` é coerente com a D13: `current` é a parcela **ainda a pagar**, então 2/12 tem 11 pela
frente. Para quitado (13/12) a conta dá zero naturalmente, sem caso especial.

⚠️ **Ordem de rotas.** `@router.get("/summary")` tem que vir **antes** de qualquer
`GET /{installment_id}` que venha a existir, senão o FastAPI tenta converter `"summary"` em
`int` e devolve 422. Hoje não há `GET` por id, mas o teste que assere 200 no `/summary` é o
que pega isso quando houver.

#### Correção junto: `percent` da tela de parcelamentos

O mock calculava `percent = current / total` ("% pago") e `remaining = parcela × (total -
current + 1)` no mesmo card. Os dois discordam sobre o que `current` significa: o primeiro
assume as `current` parcelas já pagas, o segundo assume que a `current` ainda vai ser paga.
Em 2/12: "17% pago" ao lado de 11 parcelas restantes de 12.

Pela D13 a segunda leitura é a correta. `percent` passa a ser `(current - 1) / total`.

#### Dia 4.3 — agregações do dashboard ignoram parcelamento quitado

**Bug latente exposto pela D13, não decisão de arquitetura.** Antes do 4.2 não havia como um
parcelamento passar de `total_installments` pela API; o `PATCH` tornou o estado alcançável e
com ele o defeito virou real. `get_dashboard_summary` agregava sem filtro nenhum, então um
`13/12` seguia contado em `active_installments_count` e somado em `monthly_committed_amount`
— dinheiro que já não sai do bolso aparecendo como comprometido.

`get_dashboard_summary` (`routers/dashboard.py`) filtra
`current_installment <= total_installments` nas duas agregações.

⚠️ **O `<=` é a parte frágil.** `current == total` é a **última parcela**, ainda a pagar;
quitado começa em `total + 1`. Trocar por `<` derruba o mês final de todo parcelamento do
app, e o número continua parecendo plausível. `test_last_installment_still_counts_as_active`
existe só para isso.

**O filtro é da métrica, não do recurso.** `GET /installments` continua devolvendo o
histórico completo, quitados incluídos (decidido no 4.2) — implementá-lo em
`list_installments` faria o parcelamento sumir da tela em vez de sair do indicador. O 409 de
`DELETE /categories/{id}` também não olha progresso: `RESTRICT` é integridade referencial,
"quitado" é conceito de agregação, e misturar os dois reintroduziria o 500 que o C10
removeu.

#### Desvio: o validador exclusivo sai do schema e vira 400

`check_fixed_and_installment_exclusive` **não funciona em payload parcial**. `PATCH
{"is_fixed": true}` numa transação que já tem `installment_id` passa pelo schema, porque o
payload sozinho parece válido — a regra depende do **estado mesclado** (payload + linha no
banco), que o schema não enxerga.

Por isso, **só no caminho de update**, a checagem vive no router e retorna **400**. O `POST`
continua com o validador no schema e **422** — os dois status coexistem de propósito e não
devem ser uniformizados.

Convenção de status adotada no dia 4:

* **400** — regra de negócio sobre estado mesclado (fixa × parcelada, revincular parcelamento).
* **404** — FK que não resolve (categoria/transação inexistente).
* **409** — exclusão bloqueada por referência existente (ver abaixo).
* **422** — payload malformado ou campo proibido, direto do Pydantic.

#### Exclusão bloqueada é 409, não 500

`ondelete="RESTRICT"` faz o banco levantar `IntegrityError`, que **não tratado dentro de um
router vira 500** — erro de servidor para um caso de negócio esperado. O router checa a
referência antes e devolve **409**:

* **Categoria com transação vinculada** → 409.
* **Categoria usada só por parcelamento**, sem transação nenhuma → 409 também. O `RESTRICT`
  de `Installment.category_id` pega esse caminho e ele não tinha teste até aqui.
* **Renomear categoria em uso é livre** — não quebra FK. Reescreve relatório histórico, e
  isso é aceito.

> `test_category_in_use_cannot_be_deleted` (`test_category_fk.py`) **não** cobre isso: ele
> deleta via `fk_session` e só prova que o banco recusa. Garantia de dado ≠ contrato de API.

---


---

### Parcelamento gera as próprias transações, com cronograma calculado (issues #3 e #4)

**Decidido em 11/11/2026, antes da implementação.** A aprovação foi **delegada pelo usuário**
nesta data ("siga implementando todas as fases; as perguntas vêm por fase"). As perguntas em
aberto estão no fim desta seção e podem reverter partes da decisão.

**Problema (#3).** O parcelamento era só contrato: nenhuma parcela virava transação sem o
usuário lançá-la à mão com `installment_id`. Dashboard, categorias e relatórios somam
**transações**, então o parcelado ficava fora de todos os totais.

**P-1: as parcelas são materializadas na criação.** O `POST /installments` grava, na mesma
transação de banco, uma `Transaction` de SAÍDA para cada parcela **de `current_installment` até
`total_installments`**. Cada uma tem o `installment_id`, o novo `installment_number` (k), o
título e a categoria do parcelamento, e a data `add_months(current_due_date, k − current)`, com
o dia limitado ao fim do mês. ⚠️ **Corrigido em 12/11/2026 (revisão):** este texto dizia
`add_months(first_due_date, k − 1)`, mas o código ancora na data da parcela atual. É o certo: o
`first_due_date` gravado já pode ter o dia limitado (31/03 na parcela 2 → 28/02), e ancorar nele
levaria a parcela 3 para 28/04 em vez de 30/04. Consequência: o `first_due_date` é
informativo e **não** reproduz o cronograma sozinho.
*Descartado:* **derivar as parcelas na leitura.** Exigiria somar parcelas virtuais em cada
agregação (dashboard, `_aggregated_rows`, relatórios, saldo) e na listagem de transações:
quatro consumidores com a mesma regra duplicada, o que `installment_metrics.py` existe para
evitar. *Descartado:* **gerar só até o mês corrente e completar depois.** Não há processo
periódico (serverless), e gerar num `GET` seria escrita com efeito colateral numa leitura.

**P-2: as parcelas anteriores a `current_installment` não são geradas.** Quem cadastra "3 de
10" já pagou a 1 e a 2 antes de o app acompanhar, e elas podem já estar lançadas à mão; gerar
duplicaria. É coerente com a D13: `current` é a parcela **ainda a pagar**.

**P-3: cronograma pela data da parcela atual (#4).** O cadastro recebe
`current_due_date` (data da parcela atual, **obrigatória**: um default de "hoje" no servidor
tornaria os testes dependentes do mês em que rodam, backlog 0.1). O servidor grava
`first_due_date = current_due_date − (current − 1) meses`. O `end_date` (rótulo `"Ago/2026"`)
passa a ser **calculado** a partir dele e deixa de ser aceito no `POST` e no `PATCH` (**422**,
`extra="forbid"`).

**P-4: valor total ou valor da parcela, exatamente um (#4).** `total_amount` **xor**
`installment_amount`, senão **422**.
* Com `installment_amount`: todas as parcelas iguais, e `total = parcela × N`.
* Com `total_amount`: `base = ⌊total/N⌋` em centavos, e os centavos que sobram vão **um em cada
  parcela, a partir da primeira**. Assim R$ 100,00 em 3 vira 33,34 + 33,33 + 33,33 = 100,00. O
  `installment_amount` gravado é a `base`, a parcela regular.
* Toda a conta é em `Decimal` no backend. O front **não divide dinheiro**: a pré-visualização
  vem de `POST /installments/preview`, que roda a mesma função e não grava nada.
* `remaining_amount` de parcelamento com cronograma passa a ser a **soma exata** das parcelas
  de `current` a `N` pela mesma regra. A fórmula `parcela × restantes` erraria o centavo da
  sobra; ela continua só para o parcelamento antigo, sem cronograma.

**P-5: validação do cadastro.** `1 ≤ current_installment ≤ total_installments` (a issue pede
recusar `current > total`; no `PATCH`, `current > total` continua sendo "quitado", D13).
`total_installments ≤ 120`, um teto contra gerar milhares de linhas por engano. Valores com no
máximo 2 casas e `> 0`. **Acrescentado em 12/11/2026, na revisão:** o total precisa dar pelo
menos R$ 0,01 por parcela (R$ 0,02 em 3 gerava uma SAÍDA de zero), e a data da parcela atual
fica entre 1900 e 2200 (perto dos limites do calendário, somar 120 meses dava 500).

**P-6: edição e exclusão mantêm as parcelas consistentes.**
* `PATCH` de `title` ou `category_id` propaga para as parcelas geradas
  (`installment_number` não nulo). As transações ligadas à mão, legadas, não mudam.
* Os valores travados da D15 continuam travados: todo parcelamento novo tem parcela gerada,
  então **mudar valor ou quantidade é excluir e recriar**. É a consequência direta da D15, não
  regra nova.
* **`DELETE /installments/{id}`** (novo, **204**; inexistente ou de outro dono → **404**
  "Parcelamento não encontrado."): apaga as parcelas geradas, desvincula as ligadas à mão
  (`installment_id → null`) e apaga o parcelamento. Tudo pelo ORM, objeto por objeto, porque o
  filtro de dono da D-Tenant-3 não age em `DELETE` em massa.
* Desvincular uma parcela pelo `PATCH /transactions` (`installment_id: null`) zera também o
  `installment_number`, para não deixar número sem parcelamento.

**P-7: migration** `e5c1a9b47d20`: `transactions.installment_number` (int, nulo) e
`installments.first_due_date` (date, nulo). **Os parcelamentos já existentes não ganham
parcelas**: sem data de início, o mês de cada parcela seria inferido do rótulo `end_date`.
Eles seguem como antes (sem cronograma, fórmula antiga). O caminho para corrigi-los é
**excluir e recriar** pela tela, o que agora é possível com o `DELETE`.

**Impacto no contrato com o frontend.**
* `POST /installments`: sai `end_date` e entra `current_due_date`; `total_amount` e
  `installment_amount` passam a ser um ou outro.
* `InstallmentResponse` ganha `first_due_date` (nulo nos antigos).
* `TransactionResponse` ganha `installment_number`, e o rótulo "2/10" da transação passa a
  usá-lo, em vez do `current_installment` do parcelamento, que é o mesmo número em toda parcela.
* Entram `POST /installments/preview` e `DELETE /installments/{id}`.
* `PATCH /installments` deixa de aceitar `end_date`.

**⚠️ Consequência aceita no saldo, a confirmar com o usuário.** O saldo é derivado do ledger
**sem recorte de data** ("um lançamento futuro já conta", acima). Logo, cadastrar 10× de
R$ 500 baixa o saldo da conta em R$ 5.000 na hora, não mês a mês. Para conta de cartão isso é
o limite comprometido, e está certo. Para conta corrente, não. Mudar o saldo para `date ≤ hoje`
é decisão própria, fora desta.

**Perguntas em aberto (para o usuário):** (1) o saldo com parcelas futuras, acima; (2) se o
botão "Avançar parcela", que edita `current_installment` à mão, deve dar lugar a uma "parcela
atual" derivada da data; (3) se os parcelamentos antigos devem ganhar parcelas por um script de
migração, em vez de excluir e recriar.

---

### Saldo até hoje, saldo comprometido e parcela atual pela data (Fase 1, decidido em 12/11/2026)

**Decidido antes da implementação**, com as respostas do usuário às perguntas da Fase 1 (1b, 2b
e 3). Revê duas decisões anteriores, citadas abaixo.

**S-1: o saldo conta só o que tem data até hoje** (resposta 1b). `initial_balance + ENTRADA −
SAÍDA` passa a somar apenas transações com `date <= hoje`, em `GET /accounts` e no
`total_balance` do dashboard, pela mesma expressão (`account_balance.py`). **Substitui** o "sem
recorte de data" de "Saldo é derivado do ledger": com as parcelas geradas (P-1), o recorte antigo
baixava o saldo pelo parcelamento inteiro no dia do cadastro. Lançamento futuro continua
existindo e entra no mês dele (fluxo mensal, despesas do mês); só não move o saldo antes da
data. `test_balance_has_no_date_cutoff` é **invertido** e rotulado.
* **Variação do saldo no dashboard:** o saldo do fim do mês anterior passa a ser calculado direto
  (`date < primeiro dia do mês`), e não mais por `saldo − economia do mês`: com o recorte em
  hoje, a economia do mês inclui lançamentos futuros deste mês e a subtração deixaria de bater.

**S-2: saldo comprometido** (pedido junto da 1b). `GET /installments/summary` ganha
`committed_balance` = saldo total (S-1) − parcelas geradas **com data depois de hoje** − o
restante dos parcelamentos antigos ativos, que não têm parcelas no extrato. É o saldo "se todas
as parcelas já tivessem saído". A tela de Parcelamentos mostra o quarto cartão "Saldo
comprometido". *Descartado:* `saldo − remaining_total_amount`, que contaria duas vezes a
parcela do mês já debitada.

**S-3: parcela atual pela data** (resposta 2b). Em parcelamento com cronograma, a parcela atual
é a **primeira com vencimento no mês corrente ou depois**; nenhuma → `total + 1` (quitado, D13).
Para recalcular as datas, o cadastro grava `anchor_due_date` (a data da parcela atual informada
no cadastro) e mantém o `current_installment` gravado como o número dessa âncora — a resposta da
API traz o valor **derivado**. Mês, e não dia: "Parcela 3 de 10" vale o mês inteiro em que a 3
vence, mesmo depois do dia do débito.
* `PATCH current_installment` em parcelamento com cronograma → **400** ("a parcela atual é
  calculada pela data"). O botão "Avançar" some para eles.
* "Ativo", "comprometido/mês" e "restante" usam a parcela derivada (`installment_metrics`).
  "Ativo" deixa de ser filtro em SQL e passa a ser calculado em Python sobre a lista do dono —
  são dezenas de linhas por usuário.
* *Descartado:* derivar das transações geradas (o usuário pode apagar uma parcela, e a contagem
  pularia) e gravar o dia separado (`anchor_due_date` já reproduz o cronograma, P-1).

**S-4: parcelamentos antigos** (resposta 3: "decida a melhor aplicação"). Ficam no modo antigo:
sem cronograma (`first_due_date` nulo), parcela atual gravada, "Avançar" e edição como antes, e
o botão Excluir para recriar. **Nenhuma migração apaga dado**: zerar o banco de produção é
irreversível e daqui não há acesso a ele; a migração só acrescenta a coluna nula.

**Migration** `f2b6d0c9e1a4`: `installments.anchor_due_date` (date, nulo). ⚠️ **Corrigido em
12/11/2026 (revisão):** o texto original dizia que os parcelamentos com cronograma anteriores
ficariam no modo antigo. Não ficam: a migration **preenche a âncora** de todo parcelamento com
`first_due_date` (= data da parcela `current_installment`, a partir da primeira); sem
`first_due_date` (o modo antigo de verdade) nada muda. Também em 12/11: a parcela atual
derivada tem **piso na parcela da âncora** (com a âncora num mês futuro, o calendário dava k − 1
e o restante contava uma parcela que não foi gerada).

**Dashboard — cortes diferentes, de propósito (revisão de 12/11/2026).** O saldo total e o
saldo do fim do mês anterior param em hoje (S-1); receitas, despesas e economia **do mês**
incluem lançamentos futuros deste mês. Por isso `balance_change_pct` compara "saldo até hoje"
com "saldo do fim do mês passado", enquanto os outros cartões cobrem o mês inteiro.

**Impacto no contrato com o frontend:** `InstallmentSummary.committed_balance` (novo);
`InstallmentResponse.current_installment` passa a ser derivado; `PATCH current_installment` → 400
nos novos. O saldo exibido em todas as telas deixa de contar lançamentos futuros.
