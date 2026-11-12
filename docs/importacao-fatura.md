## 📄 Importação de fatura em PDF

**Decidido em 11/11/2026, antes da implementação.** Pedido do usuário: "importar o PDF da
fatura e já registrar as transações". A aprovação foi **delegada pelo usuário** nesta data
("siga implementando todas as fases; as perguntas vêm por fase"). Nenhum PDF real de fatura
foi fornecido: o parser abaixo é **genérico**, e as perguntas do fim podem mudá-lo.

### D-Import-1: duas etapas — pré-visualizar, revisar, confirmar

`POST /api/imports/invoice/preview` lê o PDF e devolve as linhas extraídas, **sem gravar
nada**. O usuário revisa na tela (desmarca, escolhe categoria) e `POST
/api/imports/invoice/confirm` grava as escolhidas, numa transação de banco só: ou todas, ou
nenhuma.

*Descartado:* gravar direto no upload. A extração erra (linha quebrada, valor lido errado), e
dado financeiro não entra sem conferência.

### D-Import-2: o PDF vai cru no corpo, e nada é guardado

* `Content-Type: application/pdf`, o arquivo inteiro no corpo; a data de vencimento da fatura
  vai em `?due_date=AAAA-MM-DD`. **Sem `multipart`:** dispensa a dependência
  `python-multipart`, e base64 em JSON somaria 33% contra o limite de corpo da Vercel
  (4,5 MB).
* **Limite de 4 MB → 413.** Outro `Content-Type` → **415**. PDF ilegível ou sem texto (fatura
  escaneada; OCR está fora) → **422** com `detail` explicando.
* **Processado em memória e descartado.** O arquivo e o texto extraído não são gravados nem
  registrados em log: fatura tem dado sensível, e não há motivo de produto para guardá-la.
* Extração com **`pypdf` 6.21.4**, dependência nova de produção, pura Python e sem binário
  nativo. Pinada numa versão com mais de duas semanas de publicada (a 7.0 é de 06/11/2026).

### D-Import-3: parser genérico por linha (v1)

Uma linha vira lançamento quando casa `DATA DESCRIÇÃO VALOR`:

* **Data** `DD/MM` ou `DD MMM` (`10 NOV`, abreviação em português, maiúscula ou não). **O ano
  vem do vencimento:** mês da linha maior que o do vencimento é do ano anterior (fatura de
  janeiro com compra de dezembro).
* **Valor** no fim da linha, formato brasileiro (`1.234,56`), com `R$` opcional. Sinal de
  menos (`-12,34`, `- R$ 12,34`) é **crédito** (estorno), e vira ENTRADA; o resto é SAÍDA.
* **Linha de pagamento da fatura** (`pagamento`, `pgto`) vem marcada como **não selecionada**:
  pagar a fatura não é despesa, e importá-la contaria o gasto duas vezes.
* Linha que não casa é ignorada. A resposta informa quantas linhas de texto foram lidas, para
  a tela dizer "nenhum lançamento reconhecido" sem parecer erro do app.

*Descartado por ora:* **LLM lendo o PDF.** Tolera layout novo, mas manda a fatura a um serviço
externo e não é determinístico, o que vai contra a D-Import-2. *Adiado:* parser por banco, que
precisa de uma fatura de exemplo (pergunta 1).

### Revisão de 12/11/2026 (três agentes revisores) — o que mudou

* **Duplicidade por contagem** (D-Import-4): cada transação existente cobre **uma** linha igual
  da fatura; com um CAFE lançado e dois na fatura, só o primeiro vem como duplicada. E a linha
  que o usuário **marca de novo** vai com `allow_duplicate: true`, que o servidor respeita —
  antes, uma segunda compra igual não tinha como entrar.
* **Sinais de crédito** (D-Import-3): também `50,00-` (menos depois), `−` Unicode, `R$ -50,00`
  e valor sem separador de milhar (`1500,00`). Um ` - ` **solto** antes do número
  (`UBER - 25,00`) é separador da descrição, não sinal (antes virava crédito).
* **Parcela com data de compra impossível** (29/02 num ano comum) não derruba mais a linha: a
  data da compra nem é validada quando vira o vencimento.
* **Limites de trabalho:** linha acima de 300 caracteres é ignorada e os espaços são colapsados
  antes da regex — uma linha forjada de espaços travava o parser por minutos (backtracking
  ~cúbico, medido). PDF com mais de 50 páginas ou mais de 500 mil caracteres de texto → 422.
  Qualquer exceção do `pypdf` vira 422, nunca 500.
* **Teto de 4 MB antes de ler o corpo:** `Content-Length` acima → 413 sem bufferizar; sem o
  cabeçalho, a leitura do stream para no primeiro byte a mais. A rota passou a ser `async` só
  para isso; banco e PDF continuam síncronos, no threadpool.

**Fica registrado, sem correção:** a sugestão de categoria lê todo o histórico do usuário a
cada leitura de fatura (O(histórico); correto e só do dono, mas cresce com o tempo).

### D-Import-4: duplicidade — mesma conta, data, tipo, valor e descrição normalizada

A descrição é normalizada (sem acento, minúscula, espaços colapsados). Na pré-visualização, a
linha que já existe na conta vem com `duplicate: true` e **não selecionada**. Na confirmação o
servidor **confere de novo** e pula a duplicada: a tela pode estar velha, ou o usuário pode ter
enviado duas vezes. A resposta diz quantas foram criadas e quantas puladas.

Duplicadas **dentro da mesma fatura** não são removidas: duas compras iguais no mesmo dia e na
mesma loja são legítimas.

### D-Import-5: categoria sugerida pelo histórico; parcela só sinalizada

* **Categoria:** a da transação mais recente do usuário com a mesma descrição normalizada; se
  não houver, nula, e a tela exige a escolha antes de confirmar. Sem regra nova nem tabela.
* **Parcela na fatura** (`PARC 03/10`, ou `3/10` no fim da descrição): a linha ganha
  `installment_hint` e a data passa a ser **o vencimento**, não a da compra original. A parcela
  é cobrada nesta fatura, e a data da compra jogaria o gasto num mês de meses atrás. É
  importada como transação comum; **não cria parcelamento** (pergunta 2).

### D-Import-6: o dono

`owned_db` nas duas rotas. A conta e as categorias do `confirm` são buscadas pela sessão
escopada (de outro dono → 404, como em toda a API, D-Tenant-4), e as transações nascem com o
`owner_id` do servidor. A pré-visualização só lê o histórico do próprio dono.

### Impacto no contrato com o frontend

Duas rotas novas e uma tela nova: "Importar fatura", aberta de Transações, mobile-first desde a
base (restrição do `docs/mobile-first.md`). Não muda nenhuma rota existente.

### Perguntas em aberto (para o usuário)

1. **Qual banco ou cartão?** Com uma fatura de exemplo (**anonimizada**, ou com os valores
   trocados; nunca dado real no repositório) dá para escrever o parser específico e testá-lo.
2. **Parcela na fatura:** importar como transação avulsa (v1), ou criar o parcelamento (#3)?
   Criar o parcelamento geraria as parcelas futuras, e a fatura do mês seguinte traria a mesma
   parcela de novo, então a deduplicação teria que reconhecer a parcela gerada.
3. **Data da compra comum:** a da linha (v1) ou o vencimento? A da linha é o que aconteceu; o
   vencimento é quando o dinheiro sai.

### Fase 2 — leitores por banco e parcela vinculada (decidido em 12/11/2026)

**Decidido antes da implementação**, com as respostas do usuário: Itaú é o banco dele, e há
leitores também para Nubank e Mercado Pago (4); a parcela na fatura casa com o parcelamento
(5c); a compra comum fica com a data da linha (6a, já é o comportamento).

⚠️ **Os três leitores seguem o formato público conhecido de cada banco e NÃO foram
verificados contra uma fatura real.** Os testes usam PDFs sintéticos que imitam esses
formatos. O usuário combinou ajustar em produção: cada ajuste vira um teste com a linha que
falhou, anonimizada.

**D-Import-7: banco detectado pelo texto, regras por banco sobre o leitor genérico.**
* **Detecção:** "nubank" ou "nu pagamentos" → `nubank`; "itaú", "itau" ou "itaucard" → `itau`;
  "mercado pago" → `mercado_pago`; senão `generic`. Sem acento e sem caixa. A resposta do
  preview ganha `bank`, e a tela mostra "Fatura do Itaú (leitor ainda não verificado)".
* **Comum a todos:** parcela também como "Parcela 3 de 10".
* **Itaú:** a fatura em PDF tem **duas colunas de lançamentos** (um cartão de cada lado), e o
  texto extraído pode juntar dois lançamentos numa linha (`10/11 PADARIA 12,50 11/11 POSTO
  100,00`). A linha é cortada antes de cada data `DD/MM` seguida de texto **quando cada pedaço
  é um lançamento completo**; senão fica inteira.
* **Mercado Pago:** aceita a data completa `DD/MM/AAAA` e usa o ano dela. No genérico essa
  linha continua ignorada (costuma ser cabeçalho, como "Vencimento 20/11/2026").
* **Nubank:** `DD MMM` e o "−" Unicode, que o leitor genérico já cobre; só a detecção.
* *Descartado:* um leitor inteiro por banco. As faturas compartilham o essencial (data,
  descrição, valor no fim), e três cópias da regex divergiriam a cada ajuste.

**D-Import-8: parcela da fatura casa com o parcelamento (5c).** Linha com `installment_hint`
(k de N) procura, **na mesma conta**, um parcelamento com cronograma, N parcelas e o mesmo
título normalizado sem o sufixo da parcela (um contido no outro: "MAGAZINE LUIZA" × "Magazine
Luiza Sofa").
* **Casou e a parcela k já foi gerada:** `installment_match` aponta o parcelamento e a
  transação; a linha vem como **duplicada e desmarcada** — a parcela já está no extrato.
* **Casou e a parcela k não existe** (apagada à mão): vem marcada; a confirmação grava a
  transação **vinculada** (`installment_id` e `installment_number`).
* **Não casou:** importa avulsa, como antes. A tela oferece **"Criar parcelamento"**,
  desmarcado por padrão (cria as parcelas futuras na conta, efeito grande demais para ser
  automático). Marcado, a confirmação cria o parcelamento com parcela = valor da linha, N
  parcelas, atual = k e vencimento da atual = o da fatura (D-Import-5). A parcela k é **esta
  linha**: não se grava uma avulsa a mais. Na fatura seguinte, a k + 1 casa e vem desmarcada.
* O cadastro do parcelamento pela importação usa **a mesma função** do `POST /installments`
  (extraída para `app/installment_service.py`): cronograma, âncora e parcelas iguais.
* *Descartado:* criar o parcelamento automaticamente para toda linha com parcela.

**Impacto no contrato:** preview ganha `bank` e, por item, `installment_match`
(`{installment_id, installment_title, transaction_id}` ou nulo). Item do confirm ganha os
opcionais `installment_id`/`installment_number` (vincular) e `create_installment` com
`installment_current`/`installment_total` (criar). Vincular a parcelamento de outro dono → 404.

### Revisão da Fase 2, segunda rodada (12/11/2026) — o que mudou

* **Reenviar o `confirm` com `create_installment` é idempotente:** a chave de duplicidade usa o
  título com que a parcela é gravada (sem o sufixo "PARC 03/10"); antes criava um segundo
  parcelamento.
* **Vincular a parcelamento antigo (sem cronograma) é 409.** A linha viraria "parcela gerada"
  (o PATCH a renomearia, o DELETE a apagaria) e contaria duas vezes no saldo comprometido.
* **Banco pelo cabeçalho** (15 primeiras linhas, palavra inteira): "MERCADO PAGO*LOJA" ou "ITAU
  SEGUROS" num lançamento não trocam o leitor.
* **"N de M" só com a palavra "parcela"** ("TERMINAL 1 de 2" e "VOO 2 de 3" não são parcelas).
* **Casamento da parcela:** título igual vence; senão, um contido no outro **por palavras
  inteiras** e com 4+ letras ("TV" e "MAGAZINE" × "MAGAZINELUIZA" não casam mais).

### Revisão de segurança da Fase 2 (12/11/2026) — o que mudou

* **Data da linha entre 1900 e 2200** no `confirm`, a mesma regra do cadastro de parcelamento:
  `9999-06-01` com `create_installment` estourava `add_months` como **500**, e `9990-01-01`
  criava parcelas no ano 10000.
* **Teto de 500 linhas gravadas por confirmação, contando as parcelas geradas**: 500 itens ×
  120 parcelas eram 60 mil linhas numa requisição (medido: 5 s em SQLite; na Vercel, timeout).
* **Vincular a uma parcela que já existe é 409** ("A parcela k deste parcelamento já está
  lançada."), inclusive duas vezes no mesmo pedido: antes duplicava a parcela, que o PATCH e o
  DELETE do parcelamento tratam como gerada.
* **Valor total acima de R$ 9.999.999.999,99 é 422** (cadastro e importação): 120 × um valor
  que cabe na coluna estourava `Numeric(12,2)` no Postgres, como 500.
* **Fica registrado, sem correção:** uma página de PDF que expande demais dentro do
  `extract_text` antes do teto de texto (bomba de descompressão; anterior à Fase 2).
