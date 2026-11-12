## 🔑 Autenticação — Google + allowlist de 4 e-mails

**Oito decisões registradas e implementadas em 02/10/2026.**

⬜ **O que falta é configuração fora do repositório:** o passo a passo do Google Cloud Console
(abaixo), as 4 variáveis nos dois projetos da Vercel, e os 4 e-mails em
`AUTH_ALLOWED_EMAILS`. Enquanto `AUTH_ALLOWED_EMAILS` estiver vazia, **ninguém entra** — é o
*fail closed* da D-Auth-2 funcionando, não um defeito.

Antes desta fatia as 7 rotas eram públicas e não existia autenticação nenhuma.

### D-Auth-1: Google Identity Services + verificação de ID token (só client ID)

O botão do Google roda no front e devolve um **ID token** (JWT assinado pelo Google). O front
manda em `POST /api/auth/google`; o backend valida assinatura contra o JWKS do Google, confere
`aud`/`iss`/`exp`/`email_verified`, checa a allowlist e emite o cookie de sessão.

**Exige apenas o client ID, que é público. Nenhum client secret em lugar nenhum.**

**Alternativa descartada: OAuth 2.0 Authorization Code (redirect completo).** É o padrão
clássico e dispensa script de terceiro no front, mas exige **client secret**, um `state`
anti-CSRF que precisaria ser persistido em cookie assinado próprio (serverless não tem
memória), cliente HTTP em produção e dois redirects. Para um app com 4 usuários que não
consome nenhuma API do Google além da identidade, é mais segredo e mais código sensível
nosso para o mesmo resultado.

Custo aceito: carrega `accounts.google.com/gsi/client` no front, a aparência do botão é
limitada, e o Google está migrando para FedCM — a API pode mudar.

### D-Auth-2: allowlist em variável de ambiente, reconferida a cada requisição

`AUTH_ALLOWED_EMAILS`, lista separada por vírgula. É exatamente a forma de
`resolve_cors_origins`, que já existe: função pura, `strip` por item, testável sem tocar o
ambiente do processo.

**Alternativas descartadas:** tabela no banco (exigiria migration, endpoint de gestão que não
existe e **uma query por requisição**, para 4 e-mails fixos); hardcoded (põe 4 e-mails
pessoais no repositório e exige commit para alterar).

⚠️ **Sem a variável, ninguém entra.** O default é lista vazia — *fail closed*. É o oposto do
padrão "todo default equivale ao comportamento de hoje" que vale para as outras variáveis, e
aqui é de propósito: allowlist ausente não pode significar allowlist aberta.

**A allowlist é reconferida em TODA requisição, não só no login.** Isso dá revogação sem
tabela de sessão: tirar um e-mail da variável corta o acesso na requisição seguinte. Foi o
argumento decisivo contra a tabela.

Normalização obrigatória, travada por teste: comparação **case-insensitive**, e o Google
precisa ter devolvido `email_verified == true`.

### D-Auth-3: cookie `httpOnly` assinado, 30 dias deslizante

Stateless, sem tabela de sessão — serverless não tem memória nem filesystem, e tabela custaria
query por requisição. Conteúdo: e-mail + instante de emissão, assinado com HMAC.

| Atributo | Valor | Por quê |
|---|---|---|
| `HttpOnly` | sim | JS não lê o cookie — tira XSS do caminho do roubo de sessão |
| `Secure` | sim em produção | |
| `SameSite` | `Lax` | Com mesma origem basta; já bloqueia POST/PATCH/DELETE cross-site |
| `Domain` | 🔴 **ausente (host-only)** | Ver a armadilha abaixo |
| `Path` | `/` | |

🔴 **O `Set-Cookie` não pode trazer `Domain`.** Sem `Domain`, o cookie cola no host que o
browser pediu — o domínio do **frontend** — e volta pelo rewrite `/api`. Com `Domain`
apontando para o domínio do backend, o browser **descarta** o cookie e o login falha sem erro
legível em lugar nenhum.

Não há revogação individual. A reconferência da allowlist (D-Auth-2) cobre o caso real
("tirar alguém"), e rotacionar `SESSION_SECRET` derruba todas as sessões de uma vez.

### D-Auth-4: `PyJWT[crypto]` faz os dois lados

Uma biblioteca para RS256 (verificar o Google) e HS256 (nossa sessão). O `PyJWKClient`
embutido usa `urllib` da stdlib, então **nenhum cliente HTTP novo entra em produção**.

**Alternativas descartadas:** `google-auth` oficial (arrasta `requests`, `rsa`, `pyasn1`,
`cachetools` — 5 pacotes onde 2 bastam); endpoint `tokeninfo` do Google (zero cripto, mas um
round-trip ao Google por login, e o Google desaconselha em produção).

⚠️ `cryptography` é wheel binário grande e pesa no cold start. Mitigado por construção: RS256
só roda **no login**; toda requisição seguinte valida um HMAC local, sem rede e sem cripto
assimétrica.

### D-Auth-5: `SESSION_SECRET` sem default em produção — quebra consciente de padrão

🔴 **Esta decisão rompe deliberadamente a regra "toda variável tem default igual ao valor de
hoje"**, registrada em "🔐 Variáveis de Ambiente". A razão é direta: **segredo com default é
segredo conhecido**, e um default commitado no repositório assinaria sessões que qualquer
pessoa com acesso ao código poderia forjar.

A regra existia para `pytest` e `docker compose up` não passarem a exigir `.env`. Isso é
preservado por um conceito único: **ambiente local é aquele cujo banco é SQLite** — que é
literalmente a D-Vercel-1. Em SQLite há default de desenvolvimento; em Postgres, a ausência
de `SESSION_SECRET` é **erro de inicialização**.

`is_local_environment(url)` é esse conceito nomeado **uma vez**, e usado também pela D-Auth-8.
Duas checagens ad-hoc de "estamos em produção?" é como as duas divergiriam depois.

### D-Auth-6: guarda de rota client-side, e ele NÃO é a proteção

**A proteção de verdade é a dependency do FastAPI.** O domínio do backend continua
publicamente alcançável — o rewrite `/api` é conveniência de origem, **não** barreira de
segurança. Quem protege é o servidor.

O gate no `__root.tsx` consulta `GET /api/auth/me`: carregando → splash; 401 → tela de login;
ok → `Outlet`. É **UX**, não segurança: evita a tela piscar quebrada.

**Alternativa descartada: guarda server-side** (`beforeLoad` lendo o cookie no servidor).
Seria mais robusto — zero flash de conteúdo —, mas passaria a usar SSR de verdade e
**encareceria a migração para SPA estático** registrada no item 0.2 dos Itens futuros. O
débito fica do tamanho que já tem.

⚠️ Consequência registrada: o gate é componente React, e **não existe teste de componente
neste projeto** (ver "Testes do frontend"). Essa parte entra sem cobertura, como todo
componente — o que a torna segura é o 401 do backend, que tem.

### D-Auth-7: proxy `/api` no dev server do Vite, com check que falha alto

Em produção o rewrite faz tudo ser mesma origem, e o default `credentials: "same-origin"` do
`fetch` manda o cookie sozinho — **`apiFetch` não muda**. Em desenvolvimento o front está numa
porta e a API em `8000`: cross-origin, o cookie não é enviado, e o login não funciona local.

Um proxy `/api` no dev server resolve mantendo a D-Vercel-3 intacta.

**Alternativa descartada:** `credentials: "include"` + `allow_credentials=True` + origem fixa.
Reabriria a D-Deploy-6, fechada justamente por isso, e deixaria produção com configuração de
CORS que ela não precisa.

🔴 **O preset da Lovable REMOVE `server.proxy`** — `cleanServerConfig` descarta `proxy`,
`headers` e `cors`. Verificado: isso só acontece quando `LOVABLE_SANDBOX=1` ou
`DEV_SERVER__PROJECT_PATH` está definido; fora do sandbox o proxy passa normalmente.

⚠️ **Isso não fica só em comentário.** Comentário não impede nada, e o modo de falha é o pior
possível: o proxy desaparece em silêncio, o cookie para de ser enviado, e o sintoma é "login
não funciona" sem nenhuma pista da causa. Há um **check no boot do dev server** que detecta a
condição e **falha alto e visível**, com a mensagem dizendo o que aconteceu e o que fazer. A
detecção é função pura, com teste.

### D-Auth-8: `/docs` e `/openapi.json` desabilitados em produção

Com a API fechada, o schema aberto descreve a superfície inteira. Não é vulnerabilidade, é
exposição de informação gratuita.

`docs_url`/`redoc_url`/`openapi_url` passam a `None` quando `is_local_environment()` é falso —
o mesmo conceito único da D-Auth-5. Localmente o `/docs` continua servindo.

O `openapi.json` **versionado** continua sendo gerado por `app.openapi()`, que não depende das
rotas de documentação — o item 3 do Checklist Pós-Implementação segue funcionando.

### Variáveis de ambiente novas

| Variável | Natureza | Projeto | Momento | Observação |
|---|---|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | pública | frontend | **build** | ⚠️ Inlinada no bundle — trocar exige **rebuild**, não restart |
| `GOOGLE_CLIENT_ID` | pública | backend | runtime | Mesmo valor da de cima; duplicada porque são dois projetos Vercel |
| `SESSION_SECRET` | 🔴 secreta | backend | runtime | Sem default em produção (D-Auth-5) |
| `AUTH_ALLOWED_EMAILS` | sensível (dado pessoal) | backend | runtime | Lista por vírgula; vazia = ninguém entra |

### Passo a passo no Google Cloud Console (executado à mão, fora do repositório)

1. Criar/selecionar projeto no console.
2. **Tela de consentimento OAuth** → tipo **External**; nome do app, e-mail de suporte e de
   contato.
3. **Escopos:** apenas `openid`, `email`, `profile`. Escopo a mais é permissão a mais a
   justificar.
4. **Usuários de teste:** os 4 e-mails. Mantendo o app em **"Testing"**, só eles entram e
   **não é preciso passar por verificação do Google** — é exatamente o que uma allowlist de 4
   quer. (App em Testing expira refresh token em 7 dias; irrelevante aqui, porque a D-Auth-1
   não usa refresh token.)
5. **Credenciais → ID do cliente OAuth → Aplicativo da Web.**
6. **Origens JavaScript autorizadas:** o domínio do frontend em produção **e** a origem de
   desenvolvimento. ⚠️ Confirmar qual é: o `docker compose` sobe o front em `5173`, mas o
   preset da Lovable tem default `8080`.
7. **URIs de redirecionamento:** vazio. A D-Auth-1 não usa redirect.
8. Copiar o **client ID** (não há client secret a copiar) e preencher as variáveis nos dois
   projetos da Vercel.
9. **Redeployar os dois.** O frontend porque `VITE_GOOGLE_CLIENT_ID` é de build; o backend
   porque a Vercel só aplica variável nova em deploy novo.

### ⚠️ Raio de impacto: 301 testes de uma vez

São **251 chamadas à API em 19 arquivos**, todas hoje sem autenticação. No instante em que a
dependency entra nos routers, a suíte inteira vira 401.

A saída é de fixture: o `client` do `conftest.py` passa a vir **autenticado por default** (via
`app.dependency_overrides`), e nasce um **`anon_client`** para os testes de 401. Os 301 testes
seguem válidos sem edição individual.

🔴 **O risco que essa escolha cria, e o que o contém.** Override largo demais deixa a suíte
verde com a aplicação real desprotegida — exatamente o falso positivo que as fixtures
`fk_session`/`fk_client` existem para evitar. O contrapeso é um **teste de enumeração de
rotas**, que percorre `app.routes` e assere que toda rota de dados exige autenticação, com
allowlist explícita de rotas públicas (`/health`, `/`, `/api/auth/*`) — e que roda **sem** o
override. É o análogo de `test_every_foreign_key_declares_ondelete`: impede que um router novo
nasça desprotegido em silêncio.

### ⚠️ Preview deployments da Vercel não vão autenticar

As origens autorizadas do Google não aceitam wildcard, e cada preview tem URL própria. Preview
funcional exigiria um domínio estável apontado para ele. Registrado antes de ser descoberto.

---

