## 🧠 Leis da UX — otimização de design (decidido em 13/11/2026)

**Decidido antes da implementação**, a partir de uma auditoria do frontend contra as Leis da UX
(lawsofux.com). Aprovado pelo usuário: Q1–Q8 e M1–M4. **Fora do escopo, por decisão dele:**
orçamento mensal e metas (não existem; nada de model, endpoint ou migration), lançamento de
transação a partir do Dashboard (a T-4 o tirou de propósito) e UI otimista (D1, fica para
registro próprio). Sem biblioteca nova e **sem mudança de contrato com o backend**: todo item
usa campo que a API já devolve.

| # | Mudança | Lei |
|---|---|---|
| Q1 | Cartão-herói "Sobrou no mês" (`total_savings`) com "Entraram X · saíram Y"; os outros 3 cartões ficam secundários | Pareto, atenção seletiva, framing honesto |
| Q2 | "Ver todas" vira `Link` do router (hoje `<a href>` recarrega a SPA) | Doherty |
| Q3 | Aviso de projeção depois dos cartões | Atenção seletiva |
| Q4 | Distribuição: 5 maiores com percentual; "Ver mais" mostra o resto | Hick, Miller |
| Q5 | Toast diz o valor ("Saída de R$ 50,00 salva.") e oferece "Lançar outra" | Pico-fim, Parkinson, Flow |
| Q6 | Estado vazio de Transações com ícone e ações | Paradoxo do usuário ativo |
| Q7 | Cartão de transação com hierarquia; editar e excluir mais afastados | Proximidade, Fitts |
| Q8 | "Economia" com barra de progresso | Gradiente de objetivo |
| M1 | Desktop abre o formulário com foco no **valor**; no toque segue sem teclado automático (M-12) | Flow, Parkinson |
| M2 | "Parcelamento" e "Despesa fixa" em "Mais opções" recolhido (abre sozinho se algum está ativo) | Hick, Tesler |
| M3 | Categoria padrão = a última usada (`localStorage`, por navegador); seletor ordena por uso | Tesler, Pareto |
| M4 | Entrada/saída com sinal e ícone, não só cor | Jakob, Similaridade, acessibilidade |

**Decisões que valem registrar**

* **A proporção "saiu X de Y" é calculada no cliente**, como `toDistribution` já faz para a
  distribuição: divisão entre dois valores da API, sem **somar** dinheiro. É função pura
  (`spendRatio`), sem clamp (acima de 100% é informação, não erro) e `null` sem entradas.
  *Descartado:* só texto, sem barra — perde a leitura rápida que justifica o cartão-herói.
* **Última categoria em `localStorage`**, só como conveniência por navegador, com `try/catch`
  e conferência de que o id ainda existe. *Descartado:* guardar no backend (campo novo,
  migration, sem pedido).
* **Foco no valor só com ponteiro fino.** A M-12 tirou o teclado automático no toque porque ele
  cobre a folha; essa decisão fica. *Descartado:* focar o valor também no celular.
* **Cor deixa de ser a única pista de entrada × saída** (WCAG 1.4.1). O tema não muda
  (`--income` continua = `--foreground`, D-Tema-3).

**Provas.** Testes puros no runner nativo: `lib/ux-dashboard.test.ts`,
`lib/ux-transactions.test.ts`, `lib/last-category.test.ts`. A renderização fica com a conferência
visual do usuário (360, 390, 768, 1280), como na reforma mobile.

### F-2: filtros — opção B (decidido em 13/11/2026; substitui a F-1, opção C)

**Decidido pelo usuário.** A opção C (cartão de filtros) saiu; ficou a **B**: abas em sublinhado e,
em **Transações**, uma linha com o **período à esquerda** e, à direita, **Nova**, **Importar
fatura** e a **busca**, nessa ordem (o cabeçalho da página fica sem ação; abaixo de `lg` o
flutuante continua sendo a "Nova"). Em **Recorrências**, as abas em sublinhado levam, no fim da
mesma linha, "Nova assinatura" / "Novo parcelamento"; os painéis só renderizam o diálogo
(`isCreating`/`onCreatingChange`). Os **atalhos de período saem da tela**: ficam no rodapé do
popup do `PeriodFilter`, que ganha a escolha **Intervalo** entre meses (PER-9,
`docs/periodos.md`). O Dashboard usa o mesmo `PeriodFilter` e herda isso. Mudança de contrato:
só o formato novo de `?period=`. Prova: `lib/filter-card.test.ts`, `lib/period-range.test.ts`,
`tests/test_period_filter.py`.
