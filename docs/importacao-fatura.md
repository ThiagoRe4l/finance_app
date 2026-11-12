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
