# Containerizacao - estado da validacao

> Ultima validacao: **2026-10-08**, em Docker Desktop (Engine **29.8.2**,
> Compose **v5.5.1**) sobre Windows. A VM do Docker tinha 4 CPUs e ~3,8 GB.
>
> Este documento registra **somente o que foi executado e observado**. O que
> nao foi, esta na secao "Nao validado".

## Resumo

O nucleo web (Nginx + SPA, backend NestJS, MySQL com TLS, migration one-shot)
sobe, fica saudavel e funciona de ponta a ponta. A validacao encontrou **sete
defeitos** que nenhuma leitura de codigo mostraria; todos estao corrigidos e a
lista esta abaixo, porque o que eles tem em comum e o aviso mais util deste
documento: **arquivo de infraestrutura que nunca rodou nao esta pronto, mesmo
quando "parece certo".**

## O que foi provado

| Propriedade | Evidencia |
| ----------- | --------- |
| Backend constroi; modulos nativos funcionam na imagem | `bcrypt` gerou e comparou hash real; `oracledb` carregou em thin mode; Node 24.15.0, Debian glibc 2.36, processo como `node` (uid 1000) |
| Imagem sem segredos nem devDependencies do projeto | busca por `*.pem`/`*.key`/`.env*` no filesystem: vazia; `docker history`/`Config.Env` sem ARG/ENV sensivel; `@nestjs/cli`, `jest`, `eslint`, `ts-jest`, `prettier` ausentes |
| `VITE_API_URL` ausente derruba o build **cedo** | `docker build` sem `--build-arg`: falha no passo 2/8, exit 1, **antes do `npm ci`**, nenhuma imagem criada |
| Com `VITE_API_URL=/api` o build passa | exit 0; o `RUN nginx -t` do proprio build aceita a configuracao |
| Ordem `mysql healthy -> migrate -> exit 0 -> backend -> nginx` | eventos do daemon com timestamp: mysql healthy 98,4 s; migrate start 100,0 s e `die exit=0` 104,0 s; backend start 105,4 s; nginx start so depois do backend healthy |
| **Migrations aplicadas com TLS verificado dentro do Docker** | as 8 migrations (`InitialSchema` ... `Documents`) com `DATABASE_HOST=mysql`, `DATABASE_SSL_CA_FILE` montado, contra servidor com `require_secure_transport=ON` |
| **TLS visto pelo lado do servidor** | `sys.session_ssl_status` mostra o usuario `vastaflow` vindo do IP do backend em `TLSv1.3` / `TLS_AES_256_GCM_SHA384` |
| **Identidade do servidor e verificada** | certificado assinado pela **mesma CA confiavel** com SAN `wrong-mysql-name`, backend conectando em `mysql`: `ERR_TLS_CERT_ALTNAME_INVALID` / `HANDSHAKE_SSL_ERROR`, com **zero** falhas de cadeia, tanto no `migrate` quanto no backend |
| Certificado correto restaurado, tudo volta | fingerprint identico ao do backup; backend healthy; MySQL volta a ver TLSv1.3 |
| Falha de migration impede o backend | `migrate` com senha errada (falha real, antes de tocar o banco): `ER_ACCESS_DENIED_ERROR`, exit 1; `StartedAt` do backend identico ao anterior e status `exited`; `COUNT(*)` de `migrations` continua 8 |
| `PendingMigrationsCheck` segue como segunda barreira | backend contra banco vazio, sem `migrate`: `Banco de dados desatualizado: 8 migration(s) pendente(s)`, exit 1 |
| Migration e idempotente | segunda execucao: `No migrations are pending`, exit 0 |
| MySQL nao publicado; backend nao publicado | `docker inspect`: portas publicadas de mysql e backend = nenhuma; `:3000` e `:3306` nao escutam no host; `curl :3000` -> `000`; `connect :3306` -> recusada |
| Isolamento de rede | MySQL so em `app-data` (`internal=true`); Nginx so em `edge`; backend nas duas |
| Persistencia do MySQL | `--force-recreate` do container (container e id mudaram, volume o mesmo, **sem** `Initializing database` no log): os 2 lancamentos de teste continuam na API; o backend reconectou sozinho |
| Persistencia de documentos | PDF de 204.834 bytes: sha256 `f88ca51e...34c6` antes e depois de recriar o backend, **identico** |
| Nginx reaproveita o backend recriado em outro IP | backend movido de `172.19.0.4` para `172.19.0.5` com o Nginx **sem reiniciar** (mesmo `StartedAt`): 3 de 3 requisicoes `200` |
| Frontend, SPA fallback, cache | `/` e rotas do cliente (`/finance/relatorios`...) devolvem o `index.html`; assets com `immutable`; `index.html` com `no-cache` |
| Cabecalhos | `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, CSP em `/`, nos assets e nas respostas de erro; **sem HSTS** (decisao: HTTP local); `Server: nginx` sem versao |
| **CSP contra o frontend real, em Chrome 154** | login pela UI + 10 telas por navegacao direta + export de XLSX: **0 violacoes**, 0 erros de console, 0 respostas de API >= 400. Com **controle positivo** (um estilo inline injetado e bloqueado pelo header de producao), o que prova que a politica estava ativa |
| Autenticacao e financeiro | login 200; `/auth/me` ADMIN com 14 permissoes; sem token 401; criar lancamentos 201; summary fecha (1500,50 - 300,25 = 1200,25) |
| Export XLSX (pelo Nginx e pelo botao no Chrome) | `200`, MIME de XLSX, `attachment`, `Transfer-Encoding: chunked`, ZIP valido, 3 linhas, **0** elementos `<f>` |
| Upload/download | 201; nome acentuado preservado; nenhum caminho fisico na resposta; `.exe` -> 400 |
| Protecoes de producao vistas de fora | `/api/docs` 404; `/api/auth/register` 404; `/api/commands/execute` 401 sem token e 404 para ADMIN; `/api/health/readiness` 403 (Nginx); `/api/health` 200 |
| Rate limit do login | 10 tentativas rapidas: 4 chegam ao backend (401), 6 recebem 429 do Nginx |
| Rate limit da API | 600 requisicoes a ~1262 req/s: 69 passaram, 531 receberam 429; recuperacao imediata |
| Camadas de tamanho concordam | 9 MB -> 201; 10,5 MB -> 413 do **backend** (JSON); 13 MB -> 413 do **Nginx** (HTML); JSON de 200 kB -> 413 do backend; login com 20 kB -> 413 |
| IP do cliente na auditoria | `X-Forwarded-For: 6.6.6.6, 8.8.8.8` e `X-Real-IP: 7.7.7.7` forjados: a auditoria gravou `172.19.0.1`, **igual** ao `remote_addr` do access log do Nginx; nenhum IP forjado prevaleceu |
| Limites de recurso, logs e restart | aplicados e lidos de `HostConfig`: mysql 1,0 CPU/1 GB, backend 1,0/768 MB, nginx 0,5/128 MB; `json-file` 10m x 3 nos 4 containers; `unless-stopped` (e `no` no migrate). Uso medido: mysql 447 MiB, backend 105 MiB, nginx 5,8 MiB |
| Separacao do material TLS | backend enxerga **so** `ca.pem`, mount somente leitura; nenhuma chave privada em qualquer lugar do filesystem do backend; chave da CA fora dos dois containers |

## Defeitos que so a execucao revelou (todos corrigidos)

1. **`limit_req_zone` fora de contexto: o Nginx recusava a configuracao
   inteira.** O arquivo de cabecalhos misturava a diretiva de zona (so existe em
   `http`) e era incluido dentro de `server`. Pego por `nginx -t`. Correcao:
   zonas em `conf.d/00-rate-limit.conf`, cabecalhos em `snippets/`, e `RUN
   nginx -t` no Dockerfile.
2. **`MYSQL_PWD` no ambiente quebrava a inicializacao, e o healthcheck aprovava
   o resultado.** O cliente `mysql` do entrypoint le a variavel antes de a senha
   de root existir, recebe `Access denied`, o entrypoint aborta e o container
   reinicia; na segunda subida o diretorio de dados ja existe e a configuracao e
   pulada. Resultado: container `healthy` com **root sem senha e sem o banco e o
   usuario da aplicacao**. `mysqladmin ping` sai com **exit 0 mesmo com
   `Access denied`** (verificado). Correcao: removido `MYSQL_PWD`; healthcheck
   agora autentica **como o usuario da aplicacao, por TCP, e executa uma
   query** (TCP tambem exclui o servidor temporario do entrypoint, que sobe com
   `--skip-networking`). Verificado: senha errada -> exit 1.
3. **`DATABASE_SSL_CA_FILE` nao era repassada pelo `DatabaseModule`**: o backend
   entrava em laco de reinicio enquanto o `migrate` (que recebe o `env`
   inteiro) funcionava. Os testes unitarios nao pegavam (chamam
   `buildDataSourceOptions` direto) e os e2e trocam esse modulo por SQLite. O
   compilador tambem nao, porque as chaves sao opcionais no tipo. Correcao:
   tipo `Exhaustive<>` que torna a omissao de qualquer chave um erro de
   compilacao (`TS2741`), testado removendo uma chave opcional e uma
   obrigatoria.
4. **Nginx ficava com o IP antigo do backend: 502 em toda requisicao apos um
   recreate.** Reproduzido movendo o backend de `.4` para `.5`. Recriar o
   backend e exatamente o que um deploy faz. Correcao: `resolver 127.0.0.11` e
   upstream em variavel, com `rewrite` explicito dos prefixos.
5. **`Cache-Control` duplicado nos assets** (`expires` + `add_header`).
   Corrigido para um unico cabecalho.
6. **`'unsafe-inline'` em `style-src` nao era necessario.** O arquivo afirmava
   que sim, por suposicao: o React no cliente aplica estilo pelo CSSOM, que a CSP
   nao bloqueia. Medido em Chrome real com controle positivo; removido.
7. **Chave do servidor `0600` do seu usuario nao e legivel pelo uid 999 do
   MySQL numa VPS Linux** (o Windows esconde isso: o bind mount mostra tudo
   `0777`). Demonstrado com permissoes reais num volume nomeado: `root:root 0600`
   -> `Permission denied` para o uid 999; `chown 999:999` + `0600` -> o MySQL le
   e o uid 1000 (backend) nao. O script agora imprime o `chown` necessario.

## Nao validado

- **VPS Linux nativa.** Permissoes reais de bind mount (defeito 7), kernel,
  rede. Todos os testes foram em Docker Desktop.
- **HTTPS publico.** Sem dominio, DNS nem certificado. `HSTS` fica ausente de
  proposito; entra junto com o certificado real. O webhook da Meta rejeita
  certificado autoassinado.
- **IP externo real do cliente.** No Docker Desktop a conexao do host passa por
  NAT e chega como o gateway da bridge (`172.19.0.1`). O teste prova a
  **integridade da cadeia** (o forjado nao prevalece e a auditoria bate com o
  Nginx), nao o IP de um cliente remoto.
- **Streaming do proxy medido.** `proxy_buffering off` esta aplicado e o export
  chega com `Transfer-Encoding: chunked`, mas com payloads de ~6 KB nao ha como
  distinguir buffering ligado de desligado pelo tempo ate o primeiro byte.
- **CSP fora do Chrome e fora das 10 rotas.** Firefox e Safari nao foram
  testados; dialogos, estados de erro e o upload pela interface nao foram
  exercitados no navegador.
- **Servidor MySQL com a chave `0600` de dono 999** (o fix do defeito 7 foi
  demonstrado com `cat`, nao subindo o MySQL com ela).
- Backup externo e restauracao; n8n; WhatsApp; Plantae; NFS-e (so simulada: sem certificado nem Sefin reais).

## Observacoes que nao bloqueiam

- A imagem do backend tem **585 MB** (base 325 MB + `node_modules` 211 MB).
  `typescript` e `sql.js` estao nela por dependencias transitivas
  (`typeorm -> ts-node -> typescript`), nao por devDependency do projeto.
  Enxugar fica para depois.
- `X-Content-Type-Options: nosniff` aparece duplicado no download de documento
  (backend e Nginx), com valor identico. Inofensivo.
- A mensagem do `PendingMigrationsCheck` manda rodar `npm run migration:run`,
  que **nao existe na imagem de producao** (faz `nest build`, devDependency). No
  container o comando e o do servico `migrate`. A mensagem nao foi alterada
  porque o check deve permanecer intacto.
- `Content-Disposition` envia o nome ASCII sem os caracteres acentuados
  (`Declarao...`) e o nome correto em `filename*=UTF-8''...`. Comportamento
  anterior a esta fase.

## Fase 3 - n8n + PostgreSQL + autenticacao de servico

Validado em Docker Desktop (Engine 29.8.2 / Compose v5.5.1; VM de 4 CPU e
3,8 GB; host Windows de 8 GB) em 2026-10-08. **Nao validado:** VPS Linux, HTTPS
publico, carga, proprietario de volume/bind mount em Linux.

### Servicos, redes e volumes

| Servico | Imagem (fixa) | Porta | Rede(s) | Volume | Limite |
| --- | --- | --- | --- | --- | --- |
| `n8n-postgres` | `postgres:18.6-alpine3.24` | nenhuma | `n8n-internal` | `n8n-postgres-data` -> `/var/lib/postgresql` | 0,5 CPU / 384 MB |
| `n8n` | `docker.n8n.io/n8nio/n8n:2.43.1` | `127.0.0.1:${N8N_EDITOR_PORT:-5678}` | `n8n-internal`, `automation` | `n8n-state` -> `/home/node/.n8n` | 1 CPU / 768 MB |

Redes: `automation` (n8n + backend), `n8n-internal` (**internal**: n8n +
PostgreSQL). O MySQL continua so em `app-data`. O backend entrou em
`automation` e ganhou o diretorio `infra/service-auth` (somente leitura) e
`SERVICE_CREDENTIALS_FILE`. Limites somados: 3.072 MB (+512 MB do `migrate` so no
boot) na VM de 3,8 GB.

Endurecimento do n8n: `cap_drop: ALL`, `no-new-privileges`, usuario `node`,
sem `docker.sock`, sem `privileged`, sem acesso ao MySQL,
`N8N_BLOCK_ENV_ACCESS_IN_NODE`, `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS`,
telemetria/versao/templates desligados, nos de executar comando/arquivo
excluidos, poda de execucoes (14 dias), `N8N_ENCRYPTION_KEY` explicita.
PostgreSQL: `no-new-privileges` (sem `cap_drop`: o entrypoint precisa de
CHOWN/SETUID).

### O que foi provado (executado)

| # | Prova | Resultado |
| --- | --- | --- |
| 1 | PostgreSQL inicializa; n8n usa-o (157 tabelas, 300 migrations) | PASS |
| 2 | Healthcheck do Postgres **autentica** (controle negativo com senha errada: exit 1) | PASS |
| 3 | n8n `healthy` via `/healthz/readiness` | PASS |
| 4 | Editor carrega no Chrome real, senha errada recusada, certa aceita, cookie `Secure`+`HttpOnly` | PASS |
| 5 | Editor so em `127.0.0.1` (`docker compose ps`, `netstat`); nada em `0.0.0.0` | PASS |
| 6 | n8n resolve `backend` e `n8n-postgres`; **nao** resolve `mysql`; TCP ao IP do MySQL expira (com controle positivo: backend->mysql conecta) | PASS |
| 7 | Sem `docker.sock`, sem `privileged`; redes `n8n-internal`/`app-data` `internal=true` | PASS |
| 8 | Credencial do n8n **cifrada** no banco (`Salted__`); token e chave em 0 ocorrencias nos logs e no dump | PASS |
| 9 | Persistencia: `up --force-recreate` (sem `-v`): dono, workflows e credencial sobrevivem e a credencial **decifra** (chamada ao backend 200); nenhum volume anonimo criado | PASS |
| 10 | Chave de criptografia errada: n8n **recusa subir** (`Mismatching encryption keys`) | PASS |
| 11 | n8n -> backend: A token valido 200; B ausente 401; C invalido 401; D revogado 401; E JWT humano na rota de servico 401; F token de servico em 7 rotas humanas 401 | PASS |
| 12 | Revogacao sem reiniciar: recusa 0,54 s apos o CLI; rotacao com janela de duas credenciais | PASS |
| 13 | Nginx bloqueia `/api/service*` (10 variantes) e `/api/health` + SPA seguem OK | PASS |
| 14 | Fluxo humano no Chrome real, CSP estrita: 10 telas, export XLSX, 0 violacoes | PASS |
| 15 | MySQL real: nenhum usuario n8n/servico, 1 usuario; auditoria sem rastro de servico | PASS |

### Defeitos que so a execucao revelou (corrigidos)

1. **Healthcheck do PostgreSQL nao validava a senha.** A imagem deixa
   `127.0.0.1` em `trust` no `pg_hba.conf`; por loopback qualquer senha passa
   (senha errada devolveu `1`, exit 0). Corrigido: o check conecta pelo IP do
   proprio container (`hostname -i`), que cai na regra `scram-sha-256`.
2. **Bloqueio do Nginx contornavel por caixa.** `location ^~ /api/service`
   deixou passar `/api/Service/identity` (200): o Express ignora caixa, o
   `location` nao. Corrigido com regex `~*`; as 10 variantes dao 404.
3. **`start_period` do n8n (40 s) curto demais:** o boot a frio levou ~4-5 min
   (centenas de nos + ~300 migrations) e o container aparecia `unhealthy`.
   Subiu para 360 s. Reinicio com estado existente levou ~45-50 s.
4. **`docker compose up` desistiu cedo** (`mysql ... unhealthy`) logo apos o
   build, com o host saturado; os dois bancos ficaram saudaveis minutos depois.
   Nao e defeito de configuracao, e consequencia de recurso (abaixo). Reexecutar
   `up -d` concluiu.
5. Artefatos **de teste** (nao do produto): Git Bash converte `/api` em
   `C:/Program Files/Git/api` em `--build-arg` e em query strings (use
   `MSYS_NO_PATHCONV=1`); o cookie `Secure` do n8n nao e reenviado por clientes
   HTTP que respeitam o atributo.

### Recursos (Docker Desktop, 3,8 GB)

Ocioso: n8n ~370 MiB, MySQL ~494 MiB, backend ~92 MiB, PostgreSQL ~38 MiB, nginx
~6 MiB (~1 GiB no total). Pico do n8n medido durante reinicio: **468 MiB de 768**.
`OOMKilled=false` e `RestartCount=0` em todos os containers atuais. Memoria livre
do **host Windows** ficou em ~740 MB de 8 GB durante a validacao: o gargalo e o
host, e explica os boots lentos. O pico no boot **a frio** nao foi amostrado
(so confirmado que nao houve OOM). Os limites nao foram alterados.

### Nao validado / limitacoes

- Linux/VPS: propriedade e modo de `infra/service-auth` e dos volumes; o
  bind mount "imediato" do Linux nao foi medido.
- n8n -> backend e HTTP puro na rede Docker (sem TLS).
- Sem rate limit na rota de servico (nao passa pelo Nginx).
- Backup/restore do volume do n8n e do PostgreSQL **nao foram exercitados**;
  so a persistencia a `--force-recreate`.
- Segundo `docker compose up` apos a reinicializacao da VM do Docker nao foi
  testado.
- Os workflows criados foram **descartaveis** e nao devem ir para producao.

### Backup (o que precisa existir)

1. `N8N_ENCRYPTION_KEY`: copia **fora da VPS**, separada dos demais backups.
   Sem ela o backup do banco nao recupera as credenciais.
2. Banco do n8n: `pg_dump` (nao copiar o volume com o banco ligado).
3. Volume `n8n-state` (`/home/node/.n8n`, contem o arquivo `config` com a chave).
4. `infra/service-auth/credentials.json` (recriavel, so hashes).

## Fase 4 - Plantae no Docker (somente com a integracao DESLIGADA ou sem token)

Validado em Docker Desktop em 2026-10-10. **Nesta validacao em Docker nenhuma chamada
ao Plantae foi feita**: a rede, o TLS de saida e o DNS **a partir do container** nao
foram exercitados. A validacao REAL contra a homologacao foi feita depois, a partir do
computador do desenvolvedor, e esta em `docs/integracao-plantae.md` (secao 7.1).

| # | Prova | Resultado |
| --- | --- | --- |
| 1 | Imagem do backend compila e contem o modulo (16 arquivos `.js`, nenhum `.spec`) | PASS |
| 2 | Stack inteira `healthy` com o Plantae no padrao (desligado); `migrate` sai com 0 | PASS |
| 3 | Plantae desligado, pelo caminho real (Nginx -> backend): `status` = `DISABLED`; consulta = 424 `PLANTAE_DISABLED`; sem login = 401; filtro invalido = 400 | PASS |
| 4 | Habilitado **sem token**: o backend sobe `healthy`, `status` = `NOT_CONFIGURED`, consulta = 424 `PLANTAE_NOT_CONFIGURED` | PASS |
| 5 | URL base invalida (com usuario/senha embutidos) e token invalido: o **boot e recusado** (exit 1) e a mensagem **nao repete** o valor | PASS |
| 6 | Nenhuma conexao TCP de saida do backend na porta 443 (so a 3306, MySQL); os logs da integracao mostram falha `disabled` em 0 ms | PASS |
| 7 | Auditoria `PLANTAE_QUERIED` gravada no **MySQL real** (valores cabem nas colunas `varchar(30)`; sem migration) | PASS |
| 8 | Privacidade de log: `?busca=<valor>` **nao** aparece no log do Nginx nem no do backend (com a linha de log presente como controle positivo) | PASS |
| 9 | Service auth do n8n continua: do container do n8n, token valido = 200 `service:identity`; invalido = 401; o **mesmo token valido em `/integrations/plantae/*` = 401** | PASS |
| 10 | `/api/service/*` continua 404 pelo Nginx | PASS |
| 11 | MySQL: `require_secure_transport=1` e a conexao do backend em TLSv1.3 / `TLS_AES_256_GCM_SHA384` | PASS |
| 12 | PostgreSQL e n8n `healthy`; portas: so `127.0.0.1:8080` e `127.0.0.1:5678` publicadas, nenhum `0.0.0.0` | PASS |
| 13 | Fluxo humano no Chrome real, CSP estrita: telas, export XLSX, 0 violacoes, 0 respostas `/api` >= 400 | PASS |

### Defeitos que so a execucao revelou (corrigidos)

1. **Nome de tipo colidindo com decorador.** No controller declarei `type Query = ...`
   com o mesmo nome do decorador `@Query()` importado; o TypeScript emitiu a FUNCAO do
   decorador como metadado do parametro e o `ValidationPipe` global a tratou como
   classe: **400 em toda rota**. Renomeado para `RawQuery`; um teste de arquitetura
   agora exige que o metadado de cada `@Query` seja `Object`.
2. **Query string em log.** O `AllExceptionsFilter` (preexistente) e o log de acesso
   do Nginx gravavam a URL com `?busca=` - que pode ser CPF/CNPJ. O filtro agora loga
   so o caminho (a resposta ao chamador nao mudou) e o Nginx usa o formato
   `vastaflow_privacy` (`01-log-format.conf`). Vale para todas as rotas, nao so o Plantae.
3. **`Retry-After: -5` / `1.5`** eram lidos por `Date.parse` como datas e gerariam uma
   pausa de ~31 anos. So se aceita segundos inteiros ou o formato fixo de data HTTP,
   e qualquer pausa e limitada a 24 h.
4. **Bloqueio do `links.next`** e coberto por teste: um destino fora do host/caminho
   do Plantae e `invalid-response`, nunca seguido.

### Nao validado

- Egress HTTPS **do container** do backend ate `rc.plantae.agr.br` (DNS e cadeia de
  certificados com os CAs da imagem). Nenhuma chamada foi feita a partir do Docker.
- O que ainda nao foi exercitado na API real: `docs/integracao-plantae.md`, secoes 6 e 7.2.
- Linux/VPS.

## Fase 5 - Telegram + n8n no Docker (mensagens SIMULADAS; bot real NAO ativado)

Validado em Docker Desktop em 2026-10-13, com a imagem reconstruida a partir do codigo da fase,
MySQL 8.4.9 (TLS) e n8n 2.43.1 reais. **Nenhuma mensagem foi enviada ao Telegram, nenhum token de bot
foi usado, o Plantae ficou desligado.** Detalhes e modelo de confianca: `docs/telegram-n8n.md`.

| # | Prova | Resultado |
| --- | --- | --- |
| 1 | O backend **se recusou a subir** com a migration nova pendente (`PendingMigrationsCheck`); depois de reconstruir e rodar o `migrate`, aplicou `TelegramInboundEvents1791500000000` **sobre o banco existente** (8 migrations anteriores) | PASS |
| 2 | Tabela `telegram_inbound_events` no MySQL real com indice unico `ux_tg_evt_bot_update (canal, bot_id, update_id)` e `update_id decimal(20,0)` | PASS |
| 3 | Workflow versionado importado no n8n (credencial Header Auth do principal `n8n-telegram`) e **ativado** | PASS |
| 4 | Simulador -> n8n -> backend: ADMIN `/ajuda`, `/status`, `/financeiro` = `EXECUTED` com assinatura da resposta valida; a ajuda do OPERADOR lista so o que ele pode | PASS |
| 5 | OPERADOR `/financeiro` = `DENIED`; id nao vinculado = `UNLINKED`; ADMIN `/contas_pagar` com o chat desligado = frase fixa, nenhuma consulta | PASS |
| 6 | Mesmo update 2x = `DUPLICATE` (sem resposta); apos **reiniciar o backend** continua duplicado; **6 entregas simultaneas** do mesmo update = **1** executa, 5 duplicadas | PASS |
| 7 | Assinatura com chave errada = o backend recusa (403) e o workflow devolve `UNAVAILABLE`, que o simulador classifica como assinatura invalida | PASS |
| 8 | Workflow desativado = entrega falha (`http`); credencial do principal `n8n` (so identidade) = 403 -> `UNAVAILABLE`; credencial desconhecida = 401 -> `UNAVAILABLE`; credencial correta restaurada | PASS |
| 9 | O n8n **nao** tem variavel de Telegram/Plantae/chave de assinatura; **nao resolve** `mysql`; execucoes nao aparecem na API (**mas o corpo e gravado transitoriamente no PostgreSQL**; corrigido/medido na Fase 5.3, `docs/telegram-n8n.md` secao 14) | PASS com ressalva |
| 10 | `/api/service/telegram/ingest` e `/api/service/identity` = 404 pela borda; so `127.0.0.1:8080` e `127.0.0.1:5678` publicados | PASS |
| 11 | Auditoria `CHANNEL_MESSAGE` (7 desfechos vistos) com `principal` e `servicoId`, **sem** texto, id do Telegram nem chave; logs do backend e do n8n sem texto sentinela, id, chave nem token (com controle positivo) | PASS |

### Defeitos que so a execucao revelou (corrigidos)

1. **`migrate` usa imagem propria.** Reconstruir so o `backend` deixou o `migrate` velho ("No migrations are
   pending") e o backend, corretamente, nao subiu. Em todo deploy: `build` de **ambos**.
2. **Mensagens encaminhadas nao eram ignoradas** (achado na revisao final, nao no Docker): o mapper so
   filtrava grupo, bot e nao-texto. Passou a ignorar `forward_*`, `is_automatic_forward` e `via_bot`, nos dois
   modos de entrega.
3. Artefatos do Git Bash no Windows: `/ajuda` virou caminho (`MSYS_NO_PATHCONV=1`); o rate limit de login do
   n8n (429) apareceu ao automatizar logins repetidos.

### Nao validado

- `getUpdates` -> relay -> `sendMessage` contra o Telegram real (so testes unitarios com cliente falso).
- `/contas_pagar` contra o Plantae real; Oracle; Linux/VPS; HTTPS publico.

## Fase 5.1 - transporte do Telegram com Bot API FALSO

Validado em Docker Desktop em 2026-10-13: Bot API falso (`telegram-fake`) -> polling real do backend ->
n8n 2.43.1 real -> ingestao -> `sendMessage` no falso. **Sem Telegram real, sem Plantae real.**
Cenarios A a L, mensagens antigas e limite por remetente: ver `docs/telegram-n8n.md` secao 12.7.

| # | Prova | Resultado |
| --- | --- | --- |
| 1 | Imagens `backend` e `migrate` reconstruidas juntas; stack `healthy` (backend, mysql, postgres, n8n, nginx, telegram-fake) | PASS |
| 2 | Migration em banco **vazio** (9 migrations, `ux_tg_evt_bot_update` unico em `(canal,bot_id,update_id)`, tabela vazia) e 2a execucao "No migrations are pending" | PASS |
| 3 | Migration sobre banco **existente** sem apagar dados (Fase 5) e backend so sobe depois do `migrate` (`PendingMigrationsCheck`) | PASS |
| 4 | Cadeia real: A, B, C, E, J, D (apos reiniciar o backend), G (0 conflitos de `getUpdates`) | PASS |
| 5 | Adulteracao no n8n real: resposta (H), envelope/chat (I), escopo errado (L), Plantae desligado (K), n8n parado (F) | PASS |
| 6 | Service auth do container do n8n: token `n8n-telegram` na rota de identidade = 403; token `n8n` = 200; desconhecido = 401 | PASS |
| 7 | Eventos presos: `report`, aviso no boot, `abandon` (recusa recente/inexistente), `purge` (piso de 7 dias, simulacao, so terminais), auditoria `TELEGRAM_EVENT_ADMIN` | PASS |
| 8 | Privacidade: logs de backend/n8n/PostgreSQL/Nginx/migrate e auditoria sem texto sentinela, id do Telegram, token do bot, chave nem tokens de servico (com controles positivos); n8n sem execucoes gravadas | PASS |

### Defeitos corrigidos nesta fase (achados ao executar)

1. A auditoria do roteador gravava `conversationId` (= id da conta no Telegram) nas linhas de comandos
   auditados; agora so no endpoint de teste. Linhas antigas nao foram reescritas.
2. `Buffer.from(hex)` aceitava assinatura valida + lixo no lado da resposta (hex estrito agora).
3. Updates antigos reentregues apos queda eram executados; agora a mensagem tem prazo de 10 min.
4. Sem limite por remetente; agora ha (secao 12.5 do doc do Telegram).
5. No teste: `iniciarN8n()` repetido vazava um servidor (Jest nao encerrava); a base da Bot API estava fixa.

### Reproduzir com o Bot API falso

```bash
# .env de TESTE: TELEGRAM_API_BASE_URL=http://telegram-fake:8081, TELEGRAM_BOT_TOKEN=<ficticio>,
#                TELEGRAM_POLLING_ENABLED=true, TELEGRAM_DELIVERY_MODE=n8n (+ URL do webhook e chave)
docker compose -f docker-compose.production.yml -f backend/test/fake-telegram/docker-compose.fake-telegram.yml up -d
```

## Fase 5.2 e 5.3 - bot real e privacidade do n8n

Bot real `@VastaOficialBot` ativado **so em ambiente local** (Fase 5.2) e achado/correcao da persistencia transitoria
do n8n (Fase 5.3): ver `docs/telegram-n8n.md`, secoes 13 e 14. Em Docker: `EXECUTIONS_DATA_HARD_DELETE_BUFFER=0` e
`EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=1` reduziram a retencao do corpo das mensagens de ~1 h 15 min para ~25 s
(medido com sentinela); stack saudavel, volumes preservados.

## Reproduzir

Pre-requisitos: Docker Engine + Compose, `openssl`.

```bash
# 1. Material TLS local, com SAN = nome do servico no Compose
./scripts/gerar-tls-dev.sh mysql        # grava em infra/tls/ (gitignored)

# 2. Ambiente - SEGREDOS DE TESTE, fora do repositorio
#    Preencher: DATABASE_ROOT_PASSWORD, DATABASE_NAME, DATABASE_USER,
#    DATABASE_PASSWORD, JWT_SECRET, SEED_ADMIN_EMAIL/PASSWORD, VITE_API_URL=/api

# 3. Projeto isolado, para nao colidir com nada existente
DC="docker compose -p vastaflow-val --env-file /caminho/fora/do/repo/val.env \
    -f docker-compose.production.yml"

$DC config -q                  # valida o Compose
$DC up -d --build              # build + start, na ordem correta
$DC ps

# Nunca use `down -v` para "limpar": apaga os dados. `down` sem -v preserva.
$DC down
```

O Compose publica `${HTTP_PORT:-8080}:80` em **todas** as interfaces, o que e o
desejado na VPS. Para validar localmente sem expor a porta na rede, prenda-a ao
loopback com um segundo arquivo (`-f override.yml`) usando `ports: !override`.

### Provas que valem repetir

```bash
# Ordem real de inicializacao
docker events --since "$(date +%s)" --filter type=container \
  --filter label=com.docker.compose.project=vastaflow-val

# TLS visto pelo MySQL
mysql -uroot -e "SELECT t.PROCESSLIST_USER, s.ssl_version, s.ssl_cipher
  FROM sys.session_ssl_status s JOIN performance_schema.threads t
  ON t.THREAD_ID = s.thread_id WHERE t.PROCESSLIST_USER = 'vastaflow'"

# Teste negativo de identidade: gerar um certificado de SAN errado assinado
# pela MESMA CA, trocar em infra/tls/mysql, reiniciar o mysql e rodar
#   $DC run --rm migrate
# Esperado: ERR_TLS_CERT_ALTNAME_INVALID. DEPOIS restaurar o certificado correto.
```

## Na VPS (Linux)

```bash
sudo chown 999:999 infra/tls/mysql/server-key.pem
sudo chmod 600     infra/tls/mysql/server-key.pem
```

Sem isso o MySQL nao le a chave e nao sobe. A chave da CA (`ca-private/`) **nao
deve ficar na VPS**: gere o material em outra maquina e copie so
`mysql/` e `backend/`.

## Limites de recurso: validacao local x proposta KVM 4

| Servico | Local (aplicado) | Proposta KVM 4 (4 vCPU, 16 GB) |
| ------- | ---------------- | ------------------------------ |
| mysql | 1,0 CPU / 1 GB · buffer pool 256M | 2,0 CPU / 3 GB · buffer pool 1-2 GB |
| backend | 1,0 CPU / 768 MB | 1,0-1,5 CPU / 1 GB |
| nginx | 0,5 CPU / 128 MB | 0,5 CPU / 256 MB |
| migrate | 0,5 CPU / 512 MB | igual (one-shot) |

O backend tem limite folgado por causa do upload: o `multer` bufferiza o arquivo
inteiro na memoria antes de entregar ao storage. Rotacao de log: `json-file`,
`max-size=10m`, `max-file=3`, ~30 MB por servico.
