# 💫 Project Constitution & Specification: Finance App

## 📜 1. CONSTITUTION (Princípios Gerais e Governança)
* **Ambiente Confinado (AI Jail):** Todo e qualquer código deve ser testado e executado exclusivamente dentro do contêiner Docker. Nenhuma dependência externa deve poluir o sistema operacional hospedeiro.
* **Persistência de Dados Garantida:** O banco de dados SQL deve residir em um arquivo local mapeado por volume Docker, garantindo que os dados persistam mesmo que o contêiner seja destruído.
* **Arquitetura Orientada a Contratos:** O backend em Python deve expor uma API REST limpa e tipada. O frontend em React/TypeScript deve consumir essa API respeitando rigorosamente as interfaces.
* **Anti-Vibe Coding:** Nenhuma linha de código deve ser escrita sem mapeamento prévio para uma User Story e um plano técnico aprovado pelo supervisor humano.

## 🎯 2. SPECIFICATION (O Quê / User Stories)
### US-01: Gestão de Contas Bancárias e Saldos
* **Descrição:** Como usuário, quero cadastrar minhas contas (Ex: Banco Inter, Dinheiro em Espécie, NuConta) informando um saldo inicial.
* **Critérios de Aceitação:**
  * O sistema deve listar todas as contas cadastradas.
  * O sistema deve exibir um indicador visual com o saldo consolidado (soma de todas as contas).

### US-02: Registro de Fluxo de Caixa (Entradas e Saídas)
* **Descrição:** Como usuário, quero lançar minhas movimentações financeiras diárias, vinculando-as a uma conta específica e a uma categoria.
* **Critérios de Aceitação:**
  * Cada transação deve conter: Tipo (Entrada/Saída), Valor, Data, Categoria e Conta Relacionada.
  * Ao registrar uma Saída, o saldo da conta associada deve ser decrementado automaticamente.
  * Ao registrar uma Entrada, o saldo deve ser incrementado automaticamente.

### US-03: Carteira de Investimentos Simples (Manual)
* **Descrição:** Como usuário, quero poder registrar meus aportes e atualizar o saldo total de cada investimento de forma manual.
* **Critérios de Aceitação:**
  * Cadastro básico do investimento (Ex: Tesouro Selic, Ações Itaú, FII X).
  * Atualização manual de saldo para acompanhamento de rentabilidade histórica simples.

## 🛠 3. TECHNICAL IMPLEMENTATION PLAN (O Como)
### Stack Tecnológica
* **Frontend:** ReactJS com TypeScript (empacotado via Vite para desenvolvimento ágil).
* **Backend:** Python (usando FastAPI ou Flask; FastAPI é recomendado pela auto-geração de documentação Swagger/OpenAPI, o que ajuda a IA a ler as rotas).
* **Banco de Dados:** SQLite (SQL nativo via arquivo local `.db` no workspace).

### Estrutura Inicial de Diretórios Sugerida
```text
/workspace
├── GEMINI.md             # Esta especificação
├── docker-compose.yml    # Orquestração do ambiente (opcional para o futuro)
├── backend/              # Aplicação Python
│   ├── app/
│   ├── requirements.txt
│   └── database.db       # Arquivo físico do SQLite
└── frontend/             # Aplicação ReactJS / TypeScript
    ├── src/
    ├── package.json
    └── tsconfig.json