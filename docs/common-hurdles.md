## 🧯 Common Hurdles (Problemas Recorrentes)

### 1. Desalinhamento entre o schema do frontend (gerado no Lovable) e o do backend

**Sintoma:** as telas exibem informação que a API simplesmente não devolve. Concretamente: um
**título** por transação separado da categoria ("Salário", "Aluguel"), badges de
**Fixa / Variável / Parcelada / Receita**, e o progresso da parcela (`2/12`).

**Causa:** o frontend foi gerado no Lovable a partir de um design com dados fictícios próprios,
enquanto o backend foi modelado de forma independente. Os mocks viraram, na prática, um
contrato implícito que o backend nunca implementou. O model `Transaction` só tinha
`type` (`ENTRADA`/`SAÍDA`) e `category`.

**Como foi resolvido:** adicionados a `Transaction` (model + schemas):
* `title` — `String(150)`, obrigatório.
* `is_fixed` — booleano, default `False`.
* `installment_id` — FK nullable para `installments` (`ondelete="SET NULL"`), com a relação
  `installment` serializada como `InstallmentProgress` aninhado.

O rótulo exibido continua sendo derivado **no frontend** a partir de `type` + `is_fixed` +
`installment` — o backend expõe dados crus e não duplica lógica de apresentação.
`DashboardSummary` também ganhou `balance_change_pct`, `expenses_change_pct` e
`savings_pct_of_revenue` para os deltas dos `MetricCard`.

**Lição:** antes de integrar uma tela, compare o mock inline dela com o schema real da API. É
mais barato descobrir o gap lendo o mock do que depurando um `undefined` no JSX.

### 2. `ModuleNotFoundError: No module named 'app'` ao rodar o pytest

**Sintoma:** `.venv/bin/pytest` falhava na coleta de **todos** os arquivos de teste, mesmo os
que não haviam sido tocados:

```
tests/test_transactions.py:7: in <module>
    from app.database import Base, get_db
E   ModuleNotFoundError: No module named 'app'
```

**Causa:** não havia arquivo de configuração do pytest, então a raiz do backend não entrava no
`sys.path` e o pacote `app` ficava invisível. O comando documentado neste próprio arquivo não
funcionava; só passava com `PYTHONPATH=/workspace/backend` na frente.

**Como foi resolvido:** criado `backend/pytest.ini`:

```ini
[pytest]
pythonpath = .
testpaths = tests
```

Agora `.venv/bin/pytest` roda direto, sem `PYTHONPATH`. Se o erro voltar, confirme que o
`pytest.ini` existe e que você está executando a partir de `/workspace/backend`.

### 5. Backend deployado devolvia 404 em TODA rota, inclusive `/health`

**Sintoma (02/10/2026).** `{"detail":"Not Found"}` em `/health` e em
`/api/accounts` no backend deployado na Vercel. `/health` não exige
autenticação, então não era 401 disfarçado.

**Como o diagnóstico foi fechado sem acesso ao deploy.** Duas evidências
independentes:

* **O formato da resposta.** `{"detail":"Not Found"}` é do FastAPI/Starlette —
  a Vercel devolveria HTML. `content-length: 22` casa **exatamente** com esse
  corpo. E um caminho inexistente de propósito devolveu resposta idêntica: tudo
  chegava ao app, sempre no mesmo caminho errado.
  * ⚠️ O `vary: Origin` da resposta **não** é do nosso `CORSMiddleware` —
    verificado local, com e sem header `Origin`. Vem do edge da Vercel. A
    impressão digital do app é o corpo de 22 bytes.
  * A prova decisiva foi `/api/accounts/`: com o caminho íntegro, a resposta
    seria **401 em português**. Vindo `Not Found`, o app nunca viu essa rota.
* **O log de build**, que explicitou o mecanismo:

      WARNING! Internal rewrites in backend framework projects now route
      requests using the rewritten destination path. This behavior was
      previously unsupported and may change which application route handles
      a request.

**Causa.** `backend/vercel.json` tinha
`{"rewrites": [{"source": "/(.*)", "destination": "/api/index"}]}`. O
`destination` passou a ser o caminho que **roteia** a requisição, então o app
ASGI recebia `/api/index` em toda chamada — rota que ele não tem.

Duas coisas se encaixam no aviso: o comportamento era *"previously
unsupported"*, ou seja **mudou depois** de a configuração ser escrita; e o log
chama o projeto de *"backend framework project"*, indicando que a Vercel
**detecta o FastAPI nativamente** (instalou de `backend/requirements.txt` sem
nenhum `builds` declarado). O rewrite competia com a detecção e vencia.

**Como foi resolvido.** `backend/vercel.json` **removido** — a detecção nativa
já roteia para o app ASGI, e o arquivo só existia para fazer o que ela faz.
`tests/test_deploy_config.py` impede o retorno: se o arquivo voltar a existir,
nenhum rewrite pode ter `destination` de caminho, e `routes` legado também é
recusado.

> O teste **não** exige que o arquivo não exista: um dia pode ser preciso
> declarar `headers`, `regions` ou `maxDuration`. O que não pode voltar é o
> rewrite por caminho.

**Achado secundário do mesmo log: produção rodava Python 3.12.**

      No Python version specified in .python-version, pyproject.toml, or
      Pipfile.lock. Using python version: 3.12

A `.venv` e os dois jobs de CI rodavam **3.11**. Divergência dev/prod
silenciosa — nada havia quebrado, e é a classe de problema que a D-Vercel-1
existe para evitar.

🔴 **A primeira correção pinou 3.11 e quebrou o deploy.** A Vercel não oferece
3.11 no ambiente gerenciado do uv:

      No interpreter found for Python 3.11 in managed installations or
      search path

**A direção foi invertida: produção manda.** `.python-version`, os dois
`setup-python` do CI e a imagem do `docker-compose.yml` passaram todos a
**3.12** — o invariante "nenhuma divergência entre dev/CI/produção" é o mesmo,
com o valor que a plataforma realmente aceita em vez do que o container de
desenvolvimento usa.

⚠️ **O erro de direção foi barato porque a intenção estava certa.** O que
custaria caro seria pinar e não verificar: o valor errado só aparece na
instalação do build, não em teste nenhum.

**Verificado sob 3.12 de verdade**, não por "é só uma minor acima": instalado
um CPython 3.12.15 pelo próprio uv, venv limpo com as mesmas versões pinadas de
`requirements-dev.txt`, e a suíte rodada completa — **379 passed**, incluindo a
simulação dos dois jobs de CI de um checkout fora de `/workspace`. Zero
`DeprecationWarning` originada em `app/`, e nenhum uso de API removida em 3.12
(`utcnow`, `distutils`, `pkg_resources`).

**Três testes guardam o invariante, e a divisão entre eles importa:**

| Teste | Natureza |
|---|---|
| `..._is_pinned_to_what_vercel_supports` | **absoluto** — literal `3.12` |
| `..._matches_every_ci_job` | **relativo** — pin × `setup-python` |
| `..._dev_container_image_matches_the_pinned_version` | **relativo** — pin × `docker-compose.yml` |

O literal do primeiro não é a mesma coisa que o caminho hardcoded do item 4:
ele codifica uma **restrição externa**, não um fato derivável do repositório. E
é ele que impede alguém de subir dev e CI juntos para 3.13 sem confirmar a
Vercel — os dois relativos ficariam verdes, e só o deploy falharia.

> Observado ao escrever: com tudo uniformemente em 3.11, **só o teste absoluto
> ficou vermelho**. Os relativos passavam, porque consistência errada ainda é
> consistência. É a demonstração de por que os três existem.

⬜ **Divergência que sobra e não tem como fechar aqui:** o container do agente
tem só Python 3.11, então a `.venv` usada no dia a dia continua 3.11 enquanto
CI, compose e produção são 3.12. Não é corrigível pelo repositório — a imagem do
container do agente não é nossa. A mitigação é o **job de CI ser a autoridade**:
ele roda 3.12 em todo push, e foi em 3.12 que esta fatia foi validada. Quem
rodar a suíte só aqui está num interpretador que não é o de produção.

**Lição.** Configuração de plataforma não tem teste de comportamento possível
localmente, mas tem **contrato verificável sobre arquivo** — e foi isso que
sobrou como proteção nos dois casos. Vale também registrar que o aviso estava
no log desde o primeiro deploy: o diagnóstico levou duas rodadas por ele não
ter sido lido antes.

### 4. `PermissionError` no CI ao criar `/workspace` — caminho de máquina no código

**Sintoma (primeiro CI, 02/10/2026).** Os jobs `backend` **e** `backend-postgres` falharam com
o mesmo traceback: `PermissionError` em `os.makedirs`, tentando criar `/workspace` no runner
do GitHub Actions.

⚠️ **A causa não é a que o traceback sugere.** O `makedirs` parecia rodar
incondicionalmente, inclusive no job de Postgres — mas ele **sempre** foi guardado por
`sqlite_path_from_url`, que devolve `None` para Postgres. Verificado, não suposto. O
mecanismo real tem quatro passos:

1. **Nenhum dos dois jobs definia `DATABASE_URL`.** O de Postgres definia só
   `TEST_DATABASE_URL`, que governa o engine da **suíte**, não o da aplicação.
2. No runner não existe `backend/.env.local`, então nada preenchia a variável.
3. `resolve_database_url()` caía no **default**: `sqlite:////workspace/backend/database.db` —
   caminho absoluto do bind mount **deste** container.
4. O guard então acertava ao ver uma URL SQLite, e tentava criar `/workspace`, o que exige
   escrever na raiz do filesystem.

O guard funcionava; o defeito era o **default**. O sintoma apareceu no `makedirs` porque é a
primeira linha que toca o disco.

**Consequência que passou despercebida junto:** no job `backend-postgres`, o engine da
**aplicação** nunca foi Postgres — era o SQLite do default. O job testava Postgres apenas no
engine da suíte, e `test_foreign_keys_are_enforced_on_app_engine` rodava o ramo SQLite ali.

**Como foi resolvido.**

* `BACKEND_DIR` derivado de `__file__`, e `DEFAULT_DATABASE_URL` construído a partir dele —
  mesmo padrão que `ENV_FILE` já usava. O default acompanha o checkout.
* `prepare_sqlite_directory(url, makedirs=...)` extraída, com `makedirs` **injetável**: o
  comportamento que importa é *não haver chamada* no caminho Postgres, e com `monkeypatch`
  global não há como distinguir "não chamou" de "chamou outra coisa".
* O job `backend-postgres` passa a definir `DATABASE_URL` também, então nenhum caminho de
  SQLite é tocado nele e o ramo Postgres é de fato exercitado.
* O job `backend` **continua sem** `DATABASE_URL`, de propósito: é o único lugar que exercita
  o default num filesystem que não é este container. Definir a variável deixaria o default
  sem cobertura e o bug voltaria sem ninguém notar.

⚠️ **Um dos testes novos é falso verde nesta máquina, e está rotulado como tal.**
`test_the_default_database_lives_inside_the_backend_package` compara o caminho derivado de
`__file__` com o esperado — e aqui os dois **coincidem**, porque o checkout realmente mora em
`/workspace/backend`. Ele só ficaria vermelho na máquina onde o bug aparece, que é a máquina
onde não rodamos. O teste que **consegue** distinguir varre `app/` e proíbe literal
`/workspace` no código — contrato sobre arquivo, no mesmo espírito de
`test_every_requirement_is_pinned`.

### O CI seguinte falhou, e a falha confirmou a correção

`test_database_url_defaults_to_todays_hardcoded_path` comparava
`resolve_database_url({})` com `"sqlite:////workspace/backend/database.db"` **escrito à
mão**. Depois da correção, no runner o default passou a resolver para o checkout real
(`/home/runner/work/.../backend/database.db`) e o teste ficou vermelho — a expectativa era a
única coisa que seguia presa ao caminho deste container.

É a **imagem espelhada** do falso verde acima: o mesmo acoplamento, visível só na máquina
oposta. Localmente passava e no CI falhava; o outro passava no CI e falhava localmente.

A expectativa agora é **derivada do local do próprio arquivo de teste**, não de
`settings.BACKEND_DIR`. São duas derivações independentes do mesmo fato: concordarem é
verificação, enquanto reusar a constante da implementação seria tautologia — passaria mesmo
se `BACKEND_DIR` apontasse para o lugar errado. O nome passou a
`test_database_url_defaults_to_the_file_inside_the_backend_package`, porque "hardcoded path"
deixou de descrever o que o teste verifica.

Junto entrou `test_the_default_database_stays_inside_the_package`, que expressa o invariante
sem depender de qual é o caminho: o nome do arquivo pode mudar, mas o default não pode sair
de `backend/`.

**Verificado rodando a suíte de um checkout copiado para fora de `/workspace`**, sem
`.env.local` e sem `DATABASE_URL` — as mesmas condições do runner: 374 passed, nos dois
cenários de job.

**Lição.** Caminho absoluto escrito à mão é bomba-relógio de ambiente: funciona na máquina de
quem escreveu e falha em toda outra. A seção "Ambiente de Execução" já registra que
`/workspace` é bind mount específico deste container — faltava a consequência de que ele não
pode vazar para o código.

### 6. Frontend deployado devolvia o 404 **da Vercel** — artefato no lugar e formato errados

**Sintoma (02/10/2026).** `This page doesn't exist` — o 404 genérico da plataforma, não um
erro da aplicação. Indício de que a Vercel não achou output nenhum para servir.

⚠️ **Sintoma oposto ao do item 5, e a diferença é o diagnóstico.** No backend o 404 era
`{"detail":"Not Found"}` — formato do FastAPI, prova de que o app era alcançado. Aqui o 404
é HTML da Vercel: nada nosso respondeu.

**A causa.** O preset `vercel` do Nitro declara corretamente a Build Output API v3:

```js
output: {
  dir: "{{ rootDir }}/.vercel/output",
  serverDir: "{{ output.dir }}/functions/__server.func",
  publicDir: "{{ output.dir }}/static/{{ baseURL }}"
}
```

Mas o **`@lovable.dev/vite-tanstack-config` sobrescreve**, hardcodando `dist` para qualquer
preset:

```js
const output = {
  dir: "dist", serverDir: "dist/server", publicDir: "dist/client",
  ...userNitroOpts.output        // <- a única saída
};
```

O resultado é um **híbrido que não é BOA v3 válida**: `dist/` com `client/`+`server/` e um
`config.json` de BOA v3 solto dentro, faltando `static/` e `functions/`. Reproduzido com
build real: `.vercel` e `*.func` não existiam em lugar nenhum do projeto.

Coerente com o `nitro.json` gerado, que referenciava `../../static` e
`./functions/__server.func/index.mjs` — nomes da BOA v3 — enquanto os diretórios reais eram
outros. O preset *queria* emitir BOA v3 e era impedido.

🔴 **Nenhuma configuração na interface da Vercel corrigiria isso.** Minha hipótese registrada
antes — "o ajuste é o *Output Directory* do projeto" — estava **errada**: o layout estava
errado, não o caminho. Apontar a Vercel para `dist` não ajudaria, porque sem `static/` e
`functions/*.func` não há o que ela consuma em diretório nenhum.

**O log de build confirmou as duas pontas.** Três linhas:

      [start] [nitro] Building [Nitro] (preset: `vercel`, ...)   <- preset ativo
      [success] [nitro] Generated public dist/client             <- publicDir sobrescrito
      [info] Generated dist/nitro.json                           <- dir sobrescrito

E respondeu a dúvida que sobrava: **a Vercel NÃO detectou framework no frontend.** O log vai
de `vercel build` direto para `Installing dependencies` e `npm run build`, sem nenhuma linha
de detecção — ao contrário do backend, que anunciou *"backend framework projects"*. Logo não
há *Framework Preset* a ajustar: a Vercel só executa o build e coleta o que achar em
`.vercel/output`.

**Como foi resolvido.** `nitro.output` explícito no `vite.config.ts` — a última linha do
objeto da Lovable (`...userNitroOpts.output`) é o que permite. Verificado por build real: o
artefato passou a trazer `config.json`, `static/assets/` e
`functions/__server.func/` com `index.mjs` e `.vc-config.json`
(`launcherType: Nodejs`), e `dist/` deixou de ser criado. A linha do log virou
`Generated public .vercel/output/static`.

`.vercel/` entrou no `.gitignore` — o artefato passou a ser candidato a commit acidental.

**Três asserts novos em `vite-config.test.ts`**, porque o teste do preset sozinho ficava
**verde no estado quebrado**: preset certo com output sobrescrito era exatamente a falha.

**Lição, a mesma dos itens 4 e 5 por outro caminho:** valor default de biblioteca de terceiro
sobrescrevendo configuração de preset é invisível no código do projeto — o `vite.config.ts`
dizia `preset: "vercel"` e parecia correto. O que expôs foi **ler o código do preset
instalado**, não o nosso.

### 7. Três telas com `"Não autenticado."` — 307 de barra final perdendo o cookie

**Sintoma (02/10/2026).** Login funcionando, Dashboard e Relatórios carregando, mas
Transações, Categorias e Parcelamentos com `"Não autenticado."` no banner de erro.

**A correlação não era sobre as telas.** As três que falhavam eram exatamente as que
chamavam rota de **coleção com barra final**:

| Tela | Endpoints | Barra | Status |
|---|---|---|---|
| Dashboard | `/dashboard/summary` | não | ✅ |
| Relatórios | `/reports/overview`, `/installments/summary` | não | ✅ |
| Transações | `/transactions/` | **sim** | 🔴 |
| Categorias | `/categories/` | **sim** | 🔴 |
| Parcelamentos | `/installments/` + `/installments/summary` | **sim** | 🔴 |

Isso descartou query key, timing e chamadas simultâneas: Relatórios faz duas chamadas e
funciona. E descartou endpoint de escrita: nenhuma dessas telas escreve ao carregar.

**A cadeia, provada hop a hop em produção:**

      GET https://<front>/api/transactions/
        → 307  location: /api/transactions                     (Vercel, RELATIVO, REMOVE a barra)
      GET https://<front>/api/transactions
        → 307  location: https://<backend>/api/transactions/   (FastAPI, ABSOLUTO, domínio do BACKEND)
      GET https://<backend>/api/transactions/
        → 401  "Não autenticado."

A URL final fica no **domínio do backend**. O cookie de sessão é host-only no domínio do
**frontend** (D-Auth-3, sem `Domain`) — não acompanha, e `current_user` recusa.

Contraste medido: a rota que funciona faz **0 redirects** e termina no domínio do frontend; a
que falha faz **2** e termina no do backend.

🔴 **A chave é que as duas plataformas normalizam em direções opostas.** A Vercel remove a
barra final; o FastAPI adiciona. O backend nunca recebia a forma que exigia.

⚠️ **O risco estava registrado e não foi verificado.** A D-Vercel-3 dizia: *"o 307 de barra
final atravessando o rewrite merece verificação própria. O 307 não desapareceu com o uvicorn;
só mudou de proxy."* Ficou escrito e não foi exercitado até quebrar.

**Como foi resolvido.** `redirect_slashes=False` e um middleware `NormalizeTrailingSlash`
que resolve `/x` e `/x/` para a mesma rota. A forma canônica das rotas passou a ser **sem**
barra (10 decoradores de coleção de `"/"` para `""`).

Alternativa descartada: alinhar `trailingSlash` no `vercel.json`. Seria depender de
comportamento de plataforma que **já mudou sem aviso duas vezes nesta sessão** — o rewrite
por caminho (item 5) e o diretório de saída do build (item 6). Sem redirect, não há para onde
o cookie se perder.

Middleware em vez de duplicar 18 decoradores: repetição em que alguém esquece um é como o
defeito volta numa rota só, e aí o sintoma é uma tela quebrada entre cinco.

⚠️ **Dois testes existentes codificavam o comportamento antigo**, e um deles asseria o
defeito como correto: `test_overview_route_has_no_trailing_slash` exigia **307** na forma com
barra. Estava verde, e o que ele protegia era a causa. Renomeado e invertido, com o registro
dentro dele — teste pode fossilizar comportamento ruim.

**O `openapi.json` mudou:** os 5 paths de coleção perderam a barra.

⬜ **Resta um 307 same-origin**, da Vercel removendo a barra, em cada chamada que a leva.
É um round-trip a mais nas três telas, não erro. Tirar as barras das 7 chamadas do front
eliminaria — desempenho, não correção, e fatia própria.

**Lição.** Comportamento de normalização de URL não é detalhe: duas camadas normalizando em
direções opostas produzem um bug que não aparece em nenhuma das duas isoladamente. E o
`TestClient` segue redirect em silêncio, então a suíte não via o 307 — `follow_redirects=False`
é obrigatório para testar isso.

### 3. API "no ar" mas inacessível do Windows (`curl` exit 7)

**Sintoma:** o uvicorn sobe sem erro, loga `Uvicorn running on http://0.0.0.0:8000`, e
`curl http://localhost:8000/...` **de dentro do container** devolve 200. Do Windows, o
mesmo `curl` falha com *exit code 7 — failed to connect*, e o browser não carrega nada.

Parece erro de CORS ou de frontend. Não é: não há rota de rede até o processo.

**Causa:** o servidor foi iniciado **à mão dentro de um container que não publica a porta
8000**. `--host 0.0.0.0` resolve o binding *interno* — o processo escuta em todas as
interfaces do container —, mas publicar no host é decidido na criação do container
(`-p 8000:8000`) e **não pode ser adicionado depois**. Um container sem esse mapeamento dá
um servidor perfeitamente funcional e completamente inalcançável de fora.

Agrava o diagnóstico o fato de o container do agente ser **outro** container, não o
serviço `backend` do compose. Lá dentro não há `docker` nem `/var/run/docker.sock`, então
nem dá para inspecionar ou corrigir o mapeamento de dentro.

**Como confirmar em 10 segundos:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/health  # dentro: 200
hostname; hostname -i                    # é o container do compose ou outro?
which docker; ls /var/run/docker.sock    # ambos ausentes => container do agente
```

**Correção:** subir pelo compose, do host:

```
docker compose up backend
```

**Risco a evitar:** não deixe os dois rodando. O container do agente e o do compose montam
o **mesmo** `backend/database.db` pelo bind mount, e dois processos escrevendo o mesmo
arquivo SQLite sobre 9p é corrupção esperando acontecer — num arquivo que fica no disco do
host.

> Ocorrido em 10/08/2026, durante a integração da tela de Transações. A restrição já estava
> escrita em dois lugares (o comentário do `ports:` no `docker-compose.yml` e a seção
> "Via docker-compose") e ainda assim o comando manual foi escolhido, porque a seção
> "Backend" o apresentava sem ressalva. A ressalva agora está lá.
