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
- Backup externo e restauracao; n8n; WhatsApp; Plantae; NFS-e.

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
