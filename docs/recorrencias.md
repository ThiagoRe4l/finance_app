## 🔁 Recorrências — assinaturas (decidido em 13/11/2026)

**Decidido antes da implementação**, a pedido do usuário: cadastrar uma assinatura (Netflix,
R$ 50, todo dia 15) uma vez, e a cobrança entrar sozinha todo mês, sem prazo para acabar.
Os testes (`tests/test_subscriptions.py`, `tests/test_subscription_schedule.py`) vêm antes do código.

**R-1: tabela e model novos, `subscriptions`; o `Installment` não muda.** Parcelamento tem
`total_amount`, `total_installments` e `end_date`, que não fazem sentido sem fim. Campos:
`title`, `category_id`, `account_id`, `amount`, `first_charge_date` (o dia da cobrança é o dia
dessa data), `ended_on` (nulo = ativa) e `charged_through` (data da última cobrança lançada, o
cursor de R-3). `owner_id` e FKs compostas como as de `installments` (D-Tenant-2).
`transactions` ganha `subscription_id` (FK simples, `SET NULL`, pelo mesmo motivo de
`installment_id`).

**R-2: calendário pelo dia, ancorado na primeira cobrança.** A cobrança k cai em
`add_months(first_charge_date, k)`, com o dia limitado ao fim do mês: dia 31 vira 28/02, e volta
a 31/03 e 30/04 (a âncora nunca é a data já limitada, como na P-1). Não há cobrança antes de
`first_charge_date` nem depois de `ended_on` (inclusive: cobrança exatamente em `ended_on`
ainda sai). `first_charge_date` pode ser até 12 meses no passado (a cobrança retroativa é
lançada); mais antigo → **422**, um teto contra gerar dezenas de linhas por engano.

**R-3: a cobrança é lançada quando vence, por uma escrita explícita, não por um `GET`.**
`POST /subscriptions/sync` cria uma SAÍDA (`is_fixed=true`, com `subscription_id`) para cada
cobrança com data **até hoje** que ainda não foi lançada, e avança `charged_through`. Também o
`POST /subscriptions` faz isso para a assinatura nova. Nenhuma cobrança **futura** vira linha:
o saldo (S-1) e as despesas do mês só veem o que já aconteceu. O frontend chama o `sync` ao
abrir o app, depois do login.
* **Idempotente:** `UNIQUE (subscription_id, date)` nas transações. Duas requisições
  simultâneas não lançam a mesma cobrança duas vezes: a perdedora recebe `IntegrityError` e é
  ignorada.
* **O cursor existe para não ressuscitar:** se o usuário apaga uma cobrança lançada, o `sync`
  seguinte **não** a recria (só lança datas depois de `charged_through`).
* *Descartado:* **gerar num `GET`** — a P-1 já recusou escrita com efeito colateral numa
  leitura. *Descartado:* **janela de 12 meses à frente** — exige rotina para renovar, e o saldo
  teria lançamento futuro. *Descartado:* **cobrança virtual (calculada na leitura)** — as quatro
  agregações (dashboard, categorias, relatórios, saldo) duplicariam a regra, o que a P-1 recusou.
  *Fica em aberto:* um agendador diário (Vercel Cron) chamando o mesmo `sync`, para o mês em
  que o usuário não abre o app; não muda este contrato.

**R-4: editar vale daqui para frente; cancelar mantém o histórico.**
* `PATCH` aceita `title`, `amount`, `category_id` e `ended_on`; as cobranças já lançadas **não
  mudam** (o reajuste do Netflix não reescreve o passado). `first_charge_date` e `account_id` não
  são editáveis (**422**, `extra="forbid"`): trocar é excluir e recriar.
* Cancelar = `PATCH ended_on`. `ended_on: null` reativa (as cobranças que passaram enquanto
  estava encerrada **não** são lançadas depois: o cursor já passou).
* `DELETE /subscriptions/{id}` (**204**; inexistente ou de outro dono → **404** "Assinatura não
  encontrada."): apaga a assinatura e **desvincula** as transações já lançadas
  (`subscription_id → null`). O extrato não some: o dinheiro saiu de verdade.

**R-5: leitura.** `GET /subscriptions` devolve cada assinatura com `next_charge_date` (nulo se
encerrada e sem cobrança futura) e `status` (`"ativa"` ou `"encerrada"`). `GET
/subscriptions/summary` devolve `active_count` e `monthly_amount` (soma exata das ativas, em
`Decimal`). Integrar no "comprometido por mês" do dashboard é uma fatia seguinte.

**R-6: validação.** `amount` > 0, no máximo 2 casas; `title` 1 a 100 caracteres; datas entre
1900 e 2200. Conta e categoria de outro dono → **404**, como no resto (D-Tenant-4).

**Impacto no contrato com o frontend.** Rotas novas `GET/POST /subscriptions`,
`PATCH/DELETE /subscriptions/{id}`, `POST /subscriptions/sync`, `GET /subscriptions/summary`.
`TransactionResponse` ganha `subscription_id` (nulo na maioria). Migration nova e aditiva
(tabela e coluna nulas), nada de dado é apagado. Rota do front `/recorrencias`, com abas
Parcelamentos e Assinaturas (a barra inferior continua com 5 itens, M-1).

---

### Frontend (implementado em 13/11/2026)

**F-1: uma tela, duas abas.** `/recorrencias` (`routes/recorrencias.tsx`) tem as abas
Assinaturas (padrão) e Parcelamentos, com a aba na URL (`?aba=`). O corpo da antiga tela de
parcelamentos virou `components/installments/InstallmentsPanel.tsx`, sem mudar o que faz;
`/parcelamentos` redireciona para `?aba=parcelamentos`. A navegação troca "Parcelamentos" por
"Recorrências" na mesma posição (a barra inferior segue com 5 itens, M-1); o rótulo curto é
"Recorrente" (10 caracteres, o limite da M-10).

**F-2: o `sync` roda ao abrir o app.** `SubscriptionSync` (montado dentro do `AuthGate`, só na parte
autenticada) chama `POST /subscriptions/sync` uma vez e, se lançou algo, invalida as telas afetadas.
Falha é silenciosa; a próxima abertura tenta de novo.

**F-3: encerrar é diferente de excluir.** O card tem "Encerrar"/"Reativar" (`PATCH ended_on`,
reversível, sem confirmação) e a lixeira (exclui; as cobranças lançadas ficam no extrato).

⚠️ **Retroativo, como pede a regra de "Teste antes da implementação":** os testes do front
(`subscriptions.test.ts`, `subscription-form.test.ts`, `recorrencias.test.ts`) foram escritos antes do
código e vistos vermelhos (módulo inexistente), mas **a aprovação deles não foi pedida em separado**:
o pedido "faça a tela" foi tomado como o aval. Os do backend tiveram aprovação explícita.
**Não conferido:** a tela renderizada e logada (a sessão do Google é do usuário). Falta a
conferência visual a 360, 390, 768 e desktop.

---

### R-7: assinaturas somadas no Dashboard (decidido em 13/11/2026)

**Decidido antes da implementação**, a pedido do usuário ("somar no dashboard"). O widget
"Parcelamentos" do Dashboard (`Ativos` e `Comprometido/mês`) vira "Recorrências", com o que as
duas coisas custam por mês juntas.

* **Campos novos em `GET /dashboard/summary`**, sem mexer nos existentes: `active_subscriptions_count`,
  `monthly_subscriptions_amount` e `monthly_recurring_amount` (parcelamentos + assinaturas).
  `active_installments_count` e `monthly_committed_amount` **continuam só de parcelamento**: a aba de
  Parcelamentos, o insight de Relatórios e o teste que os iguala ao `GET /installments/summary` dependem
  desse significado. *Descartado:* somar assinaturas dentro de `monthly_committed_amount`, que mudaria o
  sentido de um campo usado em três lugares e deixaria o rótulo "Parcelamentos" mentindo.
* **A soma é do backend.** O front não soma dinheiro (D-Money); o total vem em `monthly_recurring_amount`,
  em `Decimal`.
* **Uma regra de "ativa" só**, em `app/subscription_metrics.py`, usada pelo Dashboard e por
  `GET /subscriptions/summary` (a mesma lição de `installment_metrics.py`): ativa = ainda vai cobrar
  (`next_charge_date` não nulo). Uma assinatura de primeira cobrança futura conta como ativa, como o
  parcelamento que ainda não começou.
* **Relatórios não muda** nesta fatia: o insight "N parcelamentos ativos comprometendo R$ X por mês"
  segue sendo de parcelamento, e o texto continua verdadeiro.
* **Impacto no contrato com o frontend:** três campos novos e aditivos em `DashboardSummary`.
