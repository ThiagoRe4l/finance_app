## 🔌 Status da Integração Frontend ↔ Backend

> **Manter esta seção atualizada conforme a integração avançar tela por tela.**

**Estado atual: as 5 telas integradas em leitura.** Nenhum mock de dado sobrou nas rotas.
**Escrita ligada nas três telas que têm endpoint** (14/08/2026). Detalhes e decisões em
"✍️ Escrita pela UI" abaixo.

| Tela | Criar | Editar | Excluir | Ação própria |
|---|---|---|---|---|
| `categorias.tsx` | ✅ | ✅ | ✅ (409 em uso) | — |
| `transacoes.tsx` | ✅ | ✅ | ✅ (estorna saldo) | busca client-side |
| `parcelamentos.tsx` | ✅ | ✅ (409 inline) | ❌ sem endpoint | avançar parcela |

**Não sobrou botão inerte.** Os três que existiam foram **removidos**: "Filtrar" em
Transações, "Buscar" no Dashboard e "Exportar" em Relatórios. Nenhum dos três tinha
endpoint, e botão que não faz nada promete recurso inexistente. Nos dois primeiros havia
agravante — a busca client-side de Transações já cobre descrição e categoria, e o Dashboard
já lista as transações recentes —, então o botão inerte ficava ao lado da coisa que
funciona.

Exportar relatório continua sem existir. Se voltar, é fatia de backend com endpoint próprio,
não um botão religado.

| Tela / Rota | Endpoint(s) | Status |
|---|---|---|
| `index.tsx` (Dashboard) | `GET /dashboard/summary` | ✅ leitura |
| `transacoes.tsx` | `GET /transactions/` | ✅ leitura |
| `categorias.tsx` | `GET /categories/` | ✅ leitura |
| `parcelamentos.tsx` | `GET /installments/` + `/installments/summary` | ✅ leitura |
| `relatorios.tsx` | `GET /reports/overview` + `/installments/summary` | ✅ leitura |

**Nenhuma soma monetária sobrou no front.** O último `reduce` sobre valores da API saiu com
a tela de Relatórios. Todo total exibido vem pronto do servidor — foi a resposta prática
para a restrição do float registrada em "Dinheiro é `Decimal`".

**Funções puras compartilhadas** (`src/lib/`, todas com teste no runner nativo do Node):

| Módulo | Responsabilidade |
|---|---|
| `money.ts` | `parseMoney`/`formatBRL` — ponto único de conversão |
| `date.ts` | `formatShortDate` — parse manual, `new Date(ISO)` erra o dia em fuso negativo |
| `transactions.ts` | rótulo Fixa/Variável/Parcelada/Receita + `signedAmount` |
| `dashboard.ts` | `formatDelta`, `trendFromDelta`, `toDistribution` |
| `categories.ts` | `categoryProgress` — percentual real × largura clampada |
| `category-icons.ts` | `icon_name` → componente lucide, com fallback |
| `installments.ts` | `installmentProgress` — pagas = `current - 1` |
| `reports.ts` | `buildReportInsights` — decide o que exibir, e se exibe |

> 🚧 **Dinheiro chega como string.** Ver "Design Patterns → Dinheiro é `Decimal`". Os mocks
> assumem `number`; a conversão está centralizada em `src/lib/money.ts` (`parseMoney` /
> `formatBRL`), que substitui as 5 cópias de `formatBRL`/`formatCurrency` que existiam
> espalhadas pelas rotas.

> ⚠️ **Converter string→`number` no front reintroduz o float que o backend eliminou.**
> `number` é IEEE 754, igual ao `float` que saiu do banco — `parseMoney("0.10") +
> parseMoney("0.20")` dá `0.30000000000000004`. Há um teste em `money.test.ts` que fixa
> isso, rotulado como limitação deliberada.
>
> Aceitável para **exibir**, que é todo o uso da tela de Transações. **Não** é aceitável
> para **somar no cliente**, e é exatamente o que os mocks de `parcelamentos.tsx`
> (`items.reduce((s, i) => s + i.installment, 0)`) e `relatorios.tsx` fazem. A resposta
> provável quando essas telas forem integradas é **usar os totais que o dashboard já
> devolve prontos** (`monthly_committed_amount`, `total_revenues`, `total_expenses`,
> `average_savings`) em vez de somar no front. Decidir quando chegar lá — não agora.

### ✍️ Escrita pela UI — decisões do dia 6 (14/08/2026)

Os endpoints de escrita existem desde o dia 4 e nunca tiveram consumidor. Esta fase liga os
botões que estavam inertes desde a geração no Lovable. Ordem: **Categorias primeiro** — é o
formulário mais simples que cobre criar/editar/excluir inteiro e exercita o 409, virando o
molde para os outros.

**Validação com `zod` + `react-hook-form`.** Nenhuma dependência nova: `zod ^3.25`,
`react-hook-form ^7.71`, `@hookform/resolvers`, `date-fns`, `react-day-picker` e os
componentes `form`/`dialog`/`alert-dialog`/`select`/`calendar` já estavam instalados e
**nunca foram usados** — o Lovable os trouxe junto do shadcn. O schema fica em função pura,
testável no runner nativo do Node, e o componente só consome.

**`<Toaster />` montado no `__root.tsx`.** Sem ele, um POST bem-sucedido não dá sinal nenhum
ao usuário além da lista mudando.

**Parcelamento: não prever trava, tratar o 409 que vier.** O `PATCH` recusa mudança em
`installment_amount`/`total_installments`/`total_amount` quando há transação lançada, mas a
API **não expõe** se há. Em vez de adivinhar, o formulário deixa editar livre e transforma o
409 em mensagem inline nos campos citados no `detail`.

**409 de categoria em uso: mensagem genérica.** `GET /categories/` devolve `txs_count` do
**mês corrente**, não o total, então a UI não consegue dizer quantas transações bloqueiam.
Usa o `detail` que o backend já manda; campo novo na API fica para quando incomodar.

#### Parcelamentos: dois acoplamentos textuais assumidos (14/08/2026)

**`end_date` é rótulo, não data.** `String(20)` livre no backend, sem validação; o seed usa
`"Ago/2026"`. O formulário usa um seletor mês/ano e **gera** a string nesse formato.

⚠️ **O front assume `"Mmm/AAAA"` e o backend não garante.** Um parcelamento criado por outro
caminho (script, `curl`, seed futuro) pode trazer qualquer coisa em `end_date`, e o seletor
não vai conseguir preencher na edição — cai num default. As abreviações vêm da mesma lista
de `dashboard.py` (`Jan`…`Dez`), duplicada no front porque não há endpoint que a exponha.

**O 409 do `PATCH` é parseado pelo texto.** O `detail` traz os campos travados ordenados e
separados por vírgula:

```
"Parcelamento já possui transações lançadas:
 installment_amount, total_amount, total_installments não pode(m) mais ser alterado(s)."
```

A UI extrai os nomes por regex para pintar cada campo. **Reformular a frase no backend
quebra o parse em silêncio** — os campos deixam de ser destacados. Mitigação: a função de
extração tem teste próprio e devolve lista vazia quando não casa, caindo no toast genérico
com a mensagem íntegra. Aceito como acoplamento conhecido; a alternativa seria o backend
devolver os campos em lista estruturada, que é mudança de contrato sem consumidor pedindo.

**`total_amount` é derivado no formulário.** `installment_amount` e `total_installments` são
editáveis; o total é calculado e somente-leitura. Os três são redundantes e o backend **não
valida coerência** — nada impede "12 × R$ 500" com total de R$ 9.000, e a tela calcula
"Saldo a pagar" a partir dos dois primeiros, então a incoerência apareceria direto na UI.

A multiplicação usa **centavos inteiros**, não `number`: `450.00 × 12` em ponto flutuante é
o mesmo risco que o backend eliminou com `Decimal`.

**Avançar parcela é botão dedicado no card**, não campo do formulário. É a ação mais
frequente da tela (uma vez por mês, por parcelamento), e a única que **nunca** dá 409 —
`current_installment` não está na lista travada. Some quando o parcelamento está quitado.

#### 🚧 Debt: `account_id` sem seletor

`POST /transactions` e `POST /installments` exigem `account_id`, mas **não existe tela de
contas** — a `Sidebar` tem 5 itens e nenhum aponta para elas, e só há `POST`/`GET
/accounts`, sem edição nem exclusão.

Decidido: **os formulários usam a primeira conta de `GET /accounts`**, sem seletor. Funciona
hoje porque o seed cria exatamente uma ("Conta Principal").

⚠️ **Quebra silenciosamente com duas contas** — os lançamentos iriam todos para a primeira,
sem o usuário perceber. O gatilho para resolver é a criação da segunda conta, não uma data.
Resolver significa: tela de contas, seletor no formulário, e provavelmente `PATCH`/`DELETE`
de conta (hoje inexistentes).

#### ⬜ Fatia futura: `DELETE /api/installments/{id}`

**Não existe.** Verificado no `openapi.json`: parcelamentos têm `POST`, `GET`, `PATCH` e
`/summary`. O dia 4 entregou só o `PATCH`, conscientemente.

Fora do escopo da fase de escrita. Quando entrar, a decisão pendente é o destino das
transações vinculadas: o `SET NULL` do `installment_id` já está testado **no banco**
(`test_fk_cascade.py`), mas nunca virou contrato de API — e a tela precisaria dizer ao
usuário que os lançamentos sobrevivem sem o vínculo.

#### ⬜ Dívida conhecida: sem paginação

"Buscar" e "Filtrar" em Transações são **client-side**, sobre o array já carregado — a API
não precisa mudar. Mas `GET /transactions/` devolve tudo, sem `limit`/`offset` em lugar
nenhum da API. Com centenas de lançamentos a tela carrega todos a cada visita. Não é
problema hoje; é o gatilho para paginação depois.

### 🎭 Os mocks são cenografia do Lovable, não especificação

**Registrado em 10/08/2026, ao mapear o Dashboard.** As telas nasceram no Lovable, a partir
de um design com **dados fictícios e estáticos**, sem lastro em cálculo nenhum. Isso não é
detalhe histórico: é a lente correta para mapear as telas que faltam.

Dois achados concretos do Dashboard mostram o padrão:

* **`CategoryBars.percent` é internamente inconsistente.** Testadas as duas fórmulas
  plausíveis: sobre o total de despesas, "Moradia" (67%) e "Alimentação" (40%) batem, mas
  "Transporte" daria 15% e o mock diz 25. Sobre o orçamento não bate nenhum. Não existe
  fórmula a recuperar — os números foram escolhidos porque ficam bem no gráfico.
* **O bloco "Fixas vs Variáveis"** (`R$ 2.205,90 / 71%` vs `R$ 914,60 / 29%`) não tem
  origem em dado nenhum, nem no front nem na API.

> **Regra ao mapear as próximas telas — `relatorios.tsx` principalmente:** número "bonito"
> que não fecha com uma fórmula clara é **decorativo**, não feature perdida. Não trate como
> spec que o backend esqueceu de implementar, e não tente adivinhar a intenção original —
> ela não existe. Manter, remover ou formalizar como dado real é decisão nossa, tomada
> agora, e vai no registro como qualquer outra.

`relatorios.tsx` é o caso mais exposto: tem 4 "Insights" em texto corrido
(`"Sua economia cresceu +18%"`, `"Despesas fixas representam 71%"`) que são exatamente esse
tipo de número.

**Derivação de rótulo é do front, e vive num lugar só.** `src/lib/transactions.ts` expõe
`deriveTransactionLabel` e `signedAmount`. A API devolve dados crus (`type`, `is_fixed`,
`installment`) e não duplica apresentação; antes disso a mesma regra existia em duas
versões divergentes — `routes/transacoes.tsx` com a grafia final e
`components/dashboard/Transactions.tsx` com slug minúsculo sem acento e uma tabela
`typeLabel` própria.

Precedência decidida em 10/08/2026: **ENTRADA sempre vence**. Entrada fixa ou parcelada
colapsa para "Receita" **sem meta** — exibir "Receita 2/12" sugeriria parcela a pagar, o
oposto do que uma entrada é. Aceito como v1.

✅ **Barra final: as duas formas funcionam, e nenhuma redireciona** (desde 02/10/2026).

⚠️ **Esta seção dizia o contrário, e foi o que causou um defeito de produção.** A versão
anterior instruía a casar a barra com a rota declarada — coleção **com** barra, rota
específica **sem** —, porque o FastAPI respondia 307 na forma errada. O front seguiu a tabela
à risca, e foi exatamente por isso que Transações, Categorias e Parcelamentos quebraram com
`"Não autenticado."` atrás do rewrite: eram as três que chamavam com barra.

A causa e a correção estão em "Common Hurdles → 7". Em resumo: a Vercel **remove** a barra
final e o FastAPI **adicionava** — normalizações opostas, então o backend nunca recebia a
forma que exigia, e o 307 dele apontava para o próprio domínio, fora do alcance do cookie
host-only.

Hoje `redirect_slashes=False` e um middleware normaliza para a forma canônica (**sem**
barra). Chamar com ou sem barra dá a mesma rota e o mesmo resultado.

> Preferir **sem barra** continua valendo, mas por outro motivo: a Vercel emite um 307
> same-origin para remover a barra, então a forma com barra custa um round-trip a mais por
> chamada. É desempenho, não correção.

⚠️ A suíte do backend não pegava o 307 porque o `TestClient` segue redirect em silêncio.
`test_trailing_slash.py` usa `follow_redirects=False` de propósito, e varre as duas formas de
toda rota GET sem parâmetro.

**Cliente HTTP:** `lib/api.ts` expõe `get`, `post`, `patch` e `delete`. **Não há `put` e não
deve haver** — ver a decisão em "Operações de escrita". `apiFetch` trata **204 sem corpo**
(`return undefined as T`); sem isso o `.json()` incondicional rejeitava a promise em toda
exclusão bem-sucedida. `api.delete` devolve `Promise<void>`, não `Promise<T>`.

**Dia 4.1 — operações de escrita (decidido e implementado em 07/08/2026).** O contrato está
em "🧩 Design Patterns → Operações de escrita".

| Endpoint | Fatia | Status |
|---|---|---|
| `PATCH /api/transactions/{id}` | 4.1 | ✅ implementado |
| `DELETE /api/transactions/{id}` | 4.1 | ✅ implementado (204) |
| `PATCH /api/categories/{id}` | 4.1 | ✅ implementado |
| `DELETE /api/categories/{id}` | 4.1 | ✅ implementado (204 / 409 em uso) |
| `PATCH /api/installments/{id}` | 4.2 | ✅ implementado |
| Agregações do dashboard ignorarem quitados | 4.3 | ✅ implementado |

⚠️ **Nenhuma tela tem afordância de edição ou exclusão hoje** — verificado por busca: não há
um `onClick` sequer em `routes/` ou `components/dashboard/`, e os botões existentes ("Nova",
"Filtrar", "Exportar") são inertes. Estes endpoints são backend pronto **antes** da UI, não
resposta a uma tela que já pede. Não existe tela de contas nem de investimentos — a
`Sidebar` tem 5 itens e nenhum aponta para elas.

