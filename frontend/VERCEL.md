# Deploy do frontend na Vercel

Projeto separado do backend, mesmo repositório, **Root Directory `frontend`**.

## O rewrite `/api` é o que elimina o CORS

`vercel.json` reescreve `/api/:path*` para o domínio do projeto do backend. Do
ponto de vista do browser existe **uma origem só**, e com isso somem dois
problemas de uma vez (D-Vercel-3):

* **CORS deixa de ser configuração.** Nenhum header, nenhuma origem a liberar.
* **`VITE_API_BASE_URL` passa a ser `/api`, relativa.** Some o ovo-e-galinha em
  que o frontend precisava do domínio do backend para buildar e o backend
  precisava do domínio do frontend para o CORS. E some a armadilha de a
  variável ser inlinada em tempo de build: caminho relativo não tem domínio
  para envelhecer.

⚠️ **`destination` acima é um placeholder.** Precisa do domínio real do projeto
do backend antes do primeiro deploy. Diferente das variáveis `VITE_*`, este
valor é lido pela Vercel em tempo de request, então trocá-lo **não** exige
rebuild do frontend — só um redeploy da configuração.

## Variável de ambiente

| Variável | Valor |
|---|---|
| `VITE_API_BASE_URL` | `/api` |

## ⚠️ O 307 de barra final atravessa o rewrite

O FastAPI redireciona `/api/accounts` para `/api/accounts/` com 307. Isso não
desapareceu com o pivô — só trocou de proxy. As 7 chamadas do front hoje batem
exatamente no padrão da rota declarada e **não disparam 307**; a tabela de barra
final no CLAUDE.md continua valendo à risca.
