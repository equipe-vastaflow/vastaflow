# VastaFlow

Sistema proprietario de automacao empresarial da
**Vasta Participacoes Empreendimentos e Agropecuaria LTDA.**

## Objetivo

Centralizar e automatizar operacoes da empresa numa unica plataforma, com
integracao futura a WhatsApp, Telegram, Plantae, NFS-e, sistemas financeiros,
bancos de dados, documentos, e-mail, relatorios e planilhas.

O desenvolvimento e **incremental**: a fundacao vem antes das automacoes.

---

## Estado atual

| Item                              | Estado                                  |
| --------------------------------- | --------------------------------------- |
| Backend NestJS + TypeScript       | Funcionando                             |
| `GET /health`                     | Funcionando                             |
| Swagger em `/docs`                | Funcionando                             |
| Validacao de ambiente no boot     | Funcionando                             |
| Tratamento global de erros        | Funcionando                             |
| Banco de dados (TypeORM)          | Migrations MySQL validadas em banco real; Oracle preparado, nao executado |
| Usuarios, perfis e permissoes     | Funcionando                             |
| Autenticacao (JWT + bcrypt)       | Funcionando                             |
| Autorizacao (RBAC)                | Funcionando                             |
| Auditoria basica                  | Funcionando                             |
| Administracao de usuarios         | Funcionando (API + telas)               |
| Dashboard administrativo          | Funcionando (usuarios e auditoria; sem dados de outros modulos) |
| Tela de auditoria                 | Funcionando (listagem paginada; sem filtros)   |
| Financeiro (backend)              | Fundacao: lancamentos internos + comando `/financeiro`. Sem tela |
| Configuracoes do sistema          | Funcionando (API + tela, so ADMIN). Nao guarda segredo; ainda nao lida por outros modulos |
| Notificacoes internas             | Funcionando (API + tela). Somente internas: sem e-mail, push ou mensageria |
| Perfil do proprio usuario         | Funcionando (API + tela). So o nome e editavel; sem troca de senha ou e-mail |
| Frontend: login, dashboard, usuarios, auditoria, financeiro, configuracoes | Funcionando |
| Integracoes externas              | Nao iniciado - apenas pastas reservadas |

> Nenhuma integracao possui endpoint, token ou payload definido. Nada foi
> inventado: cada uma sera implementada quando houver documentacao e acesso
> oficiais do provedor.

---

## Arquitetura

```
Controller  ->  Service  ->  Repository  ->  Database
   HTTP        regra de     traducao p/     MySQL ou
              negocio        o banco         Oracle
```

- Controller nao contem regra de negocio.
- Service nao monta SQL.
- Repository e o unico lugar que conhece detalhe de MySQL ou Oracle.

Canais diferentes (API, WhatsApp, Telegram) acionam **a mesma** regra de
negocio - um adapter so traduz o formato de entrada.

Detalhes em [docs/arquitetura.md](docs/arquitetura.md).

---

## Stack

### Backend

| Tecnologia | Versao | Observacao                                     |
| ---------- | ------ | ---------------------------------------------- |
| Node.js    | >= 24.15.0 | Minimo exigido pelas dependencias (ver abaixo) |
| TypeScript | 6.0.3  | TS 7 ainda nao e compativel com o ts-jest       |
| NestJS     | 12.0.4 | Pacotes ESM, consumidos em CommonJS via nodenext |
| Jest       | 30     | Testes unitarios e e2e                          |
| ESLint 10 + Prettier 3 | | Padronizacao de codigo                     |

### Banco de dados

**TypeORM**, com MySQL como alvo inicial e Oracle preparado.

O Prisma foi **descartado**: nao suporta Oracle e, na linha 8, ainda nao suporta
MySQL. A analise completa esta no
[ADR 0001](docs/adr/0001-escolha-do-orm-e-estrategia-de-banco.md).

Autenticacao: `@nestjs/jwt` (JWT HS256) e `bcrypt`. Validacao de DTOs com
`class-validator`.

### Frontend

React 19 + TypeScript + Vite + React Router. Testes com Vitest e Testing Library.

---

## Estrutura de pastas

```
vastaflow/
├── backend/            API NestJS
│   ├── src/
│   │   ├── config/         validacao de variaveis de ambiente
│   │   ├── common/         filtros, DTOs e utilitarios compartilhados
│   │   ├── database/       conexao TypeORM e seed (permissoes, perfis, admin)
│   │   ├── modules/        health, auth, users, roles, permissions, audit
│   │   └── main.ts         bootstrap, Swagger, CORS
│   └── test/               testes end-to-end (SQLite em memoria)
├── frontend/           React + Vite (login, dashboard e administracao de usuarios)
├── integrations/       whatsapp, telegram, plantae, nfse, email (reservado)
├── database/           scripts de inicializacao e notas por banco
├── docs/               documentacao e decisoes arquiteturais (ADR)
├── .env.example        modelo de variaveis de ambiente
├── docker-compose.yml  MySQL para desenvolvimento local
└── README.md
```

---

## Requisitos

- **Node.js >= 24.15.0** e npm 11+
- **Git**
- **Docker** (opcional - somente para subir o MySQL local) **ou** um MySQL 8.4
  ja instalado na maquina, com um banco e um usuario criados para o VastaFlow

Verifique:

```bash
node -v
npm -v
```

**Por que 24.15.0.** E o menor Node 24 aceito por todas as dependencias
instaladas. Quem exige sao ferramentas de desenvolvimento: `@nestjs/schematics`
e `@angular-devkit/*` (backend) e `jsdom` (testes do frontend) declaram
`^22.22.x || ^24.15.0 || >=26`. Com um Node mais antigo o `npm install` apenas
avisa (`EBADENGINE`) e hoje tudo ainda funciona, mas nao ha garantia - atualize.
O valor esta no campo `engines` de `backend/package.json` e
`frontend/package.json`.

---

## Instalacao

```bash
git clone https://github.com/equipe-vastaflow/vastaflow.git
cd vastaflow/backend && npm ci
cd ../frontend && npm ci
```

`npm ci` instala exatamente as versoes do `package-lock.json`. Use `npm install`
apenas quando for adicionar ou atualizar uma dependencia.

**Aviso esperado do npm 11 (`install-scripts`).** O npm bloqueia por padrao os
scripts de instalacao de `bcrypt`, `oracledb`, `@parcel/watcher`,
`unrs-resolver` e `@scarf/scarf` e lista-os ao final do `npm ci`. Nao e erro e
nao precisa aprovar nada: `bcrypt` usa o binario pre-compilado que ja vem no
pacote, `oracledb` roda em modo Thin (sem Oracle Instant Client) e `@scarf/scarf`
e apenas telemetria.

---

## Configuracao de ambiente

Copie o modelo e preencha os valores do seu ambiente:

```bash
# na raiz do repositorio

# Windows (PowerShell)
Copy-Item .env.example .env
Copy-Item .env backend\.env      # o backend le backend/.env; o docker compose le o da raiz

# Linux / macOS
cp .env.example .env
cp .env backend/.env
```

O `.env` esta no `.gitignore` e **nunca** deve ser versionado.

Para o backend subir voce **precisa preencher**: `JWT_SECRET` (minimo 32
caracteres), `DATABASE_PASSWORD` e, para ter um usuario administrador,
`SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`.

| Variavel                  | Padrao          | Descricao                                                    |
| ------------------------- | --------------- | ------------------------------------------------------------ |
| `NODE_ENV`                | `development`   | `development` \| `production` \| `test`                       |
| `PORT`                    | `3000`          | Porta HTTP do backend                                         |
| `APP_NAME`                | `vasta-flow`    | Identificador devolvido por `/health`                          |
| `SWAGGER_ENABLED`         | `false`         | Expor `/docs`. A aplicacao recusa iniciar com `true` em producao |
| `FRONTEND_ORIGIN`         | vazio (CORS off) | Origens autorizadas a chamar a API, separadas por virgula     |
| `DATABASE_TYPE`           | `mysql`         | `mysql` \| `oracle`                                            |
| `DATABASE_HOST/PORT/NAME/USER/PASSWORD` | -   | Conexao. Dispensadas se `DATABASE_URL` estiver preenchida     |
| `DATABASE_SYNCHRONIZE`    | `false`         | Cria as tabelas a partir das entities. So dev; proibido em producao |
| `DATABASE_SSL`            | `false`         | Exige TLS no MySQL, validando cadeia **e** identidade do servidor. Obrigatorio em producao |
| `DATABASE_SSL_CA`         | (vazio)         | CA em PEM (o conteudo). **Obrigatoria** quando `DATABASE_SSL=true` |
| `DOCUMENT_STORAGE_PATH`   | `./storage/documents` | Raiz do storage local de documentos                     |
| `DOCUMENT_MAX_FILE_SIZE`  | `10485760`      | Tamanho maximo de um documento, em bytes (10 MB)              |
| `JWT_SECRET`              | **obrigatorio** | Segredo de assinatura, >= 32 caracteres                        |
| `JWT_EXPIRES_IN`          | `1h`            | Validade do token: `30s`, `15m`, `1h`, `7d`                    |
| `BCRYPT_SALT_ROUNDS`      | `12`            | Custo do hash (4 a 15)                                        |
| `SEED_ADMIN_EMAIL/PASSWORD/NAME` | -        | Administrador inicial, criado no boot se nao existir           |

Gerar um `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

A validacao ocorre no boot: uma configuracao invalida derruba o processo na
inicializacao, com mensagem explicita, em vez de gerar erro obscuro no primeiro
request.

---

## Banco de dados

O backend usa **MySQL** em desenvolvimento. Suba-o com Docker:

```bash
docker compose up -d
docker compose logs -f mysql
docker compose down      # preserva os dados
docker compose down -v   # APAGA os dados do volume
```

As credenciais vem do `.env` da raiz (`DATABASE_ROOT_PASSWORD`, `DATABASE_NAME`,
`DATABASE_USER`, `DATABASE_PASSWORD`). O container so aceita conexoes de
`127.0.0.1`.

> O `docker-compose.yml` **ainda nao foi executado**: a maquina onde o projeto
> foi montado nao tem Docker. O MySQL em si foi validado (veja abaixo), mas por
> outro meio.

### Migrations

O schema e criado e evoluido **por migrations**, uma pasta por banco
(`backend/src/database/migrations/{mysql,oracle}/`). Com o MySQL no ar:

```bash
cd backend
npm run migration:run      # cria/atualiza as tabelas
npm run start:dev          # o seed cria perfis, permissoes e o administrador inicial
```

A aplicacao **recusa iniciar** se houver migration pendente, com uma mensagem
dizendo qual comando rodar - em vez de falhar depois com "tabela inexistente".

| Comando                      | Descricao                                                  |
| ---------------------------- | ---------------------------------------------------------- |
| `npm run migration:show`     | Lista as migrations e quais ja rodaram                      |
| `npm run migration:run`      | Executa as pendentes                                        |
| `npm run migration:revert`   | Desfaz a ultima                                             |
| `npm run migration:generate -- src/database/migrations/mysql/<Nome>` | Gera a partir da diferenca entre entities e banco |
| `npm run schema:log`         | Mostra o SQL que faltaria para o banco bater com as entities (vazio = em dia) |

`DATABASE_SYNCHRONIZE=true` (criar tabelas direto das entities) continua
disponivel para prototipos locais, mas **nao e o fluxo padrao** e e proibido em
producao. Detalhes e o procedimento para mudancas de schema em
[database/README.md](database/README.md).

### O que foi validado de verdade

| Banco  | Situacao |
| ------ | -------- |
| MySQL 8.4 | Migrations executadas, revertidas e reexecutadas num MySQL real; `schema:log` sem divergencias; aplicacao subiu contra ele com seed, login, RBAC e auditoria funcionando. |
| Oracle | **Nunca executado.** Metadata e DDL verificados por testes automatizados, sem banco. Falta uma instancia de homologacao. |

**Oracle nao esta containerizado** - as imagens oficiais exigem login no
`container-registry.oracle.com` e aceite de licenca. Ver
[database/README.md](database/README.md).

---

## Execucao do backend

```bash
cd backend

npm run start:dev     # desenvolvimento, com hot reload
npm run build         # compila para dist/
npm run start:prod    # executa o build
```

Com o servidor no ar:

| URL                              | Descricao          |
| -------------------------------- | ------------------ |
| http://localhost:3000/health     | Health check       |
| http://localhost:3000/docs       | Swagger UI         |
| http://localhost:3000/docs-json  | OpenAPI em JSON    |

Resposta esperada de `GET /health`:

```json
{ "status": "ok", "service": "vasta-flow" }
```

---

## Execucao do frontend

```bash
cd frontend
cp .env.example .env     # Windows: Copy-Item .env.example .env
npm run dev              # http://localhost:5173
```

Detalhes em [frontend/README.md](frontend/README.md).

---

## Autenticacao e como testar o login

### Rodar tudo localmente

1. Configure o ambiente (secao acima) com `JWT_SECRET`, `DATABASE_PASSWORD`,
   `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`.
2. `docker compose up -d` (aguarde o MySQL ficar `healthy`).
3. `cd backend && npm run migration:run` — cria as tabelas.
4. `npm run start:dev` — o log deve mostrar `Administrador inicial criado: ...`.
5. Em outro terminal, `cd frontend && npm run dev`.
6. Abra http://localhost:5173 e entre com o e-mail/senha do administrador.

### Endpoints

| Metodo e rota          | Acesso               | Descricao                                                  |
| ---------------------- | -------------------- | ---------------------------------------------------------- |
| `POST /auth/register`  | publico              | Cadastra um usuario (sempre perfil `USUARIO`) e devolve o JWT |
| `POST /auth/login`     | publico              | Autentica e devolve o JWT                                    |
| `GET /auth/me`         | autenticado          | Usuario da sessao, com perfil e permissoes                    |
| `POST /auth/logout`    | autenticado          | Registra o logout na auditoria (204)                          |
| `GET /users?page=&limit=` | `users:read`      | Lista paginada (padrao 20, maximo 100), ordenada por nome      |
| `GET /users/:id`       | `users:read`         | Consulta um usuario                                          |
| `GET /users/assignable-roles` | `users:read`  | Perfis que voce pode conceder (usado pelo frontend)          |
| `POST /users`          | `users:create`       | Cria usuario ativo (senha obrigatoria, perfil padrao `USUARIO`) |
| `PATCH /users/:id`     | `users:update`       | Edita nome e e-mail. Senha, perfil e status sao recusados (400) |
| `PATCH /users/:id/status` | `users:status`    | Ativa ou desativa (`{ "ativo": false }`)                     |
| `PATCH /users/:id/role` | `users:role`        | Altera o perfil (`{ "role": "OPERADOR" }`)                   |
| `GET /users/:id/external-identities` | `users:read` | Lista os vinculos ATIVOS de conta externa (Telegram) do usuario |
| `DELETE /users/:id/external-identities/:linkId` | `users:update` | Remove o vinculo ativo (204) |
| `GET /users/:id/external-identities/link-requests` | `users:read` | Solicitacoes de vinculo pendentes (sem codigo) |
| `POST /users/:id/external-identities/link-requests` | `users:update` | Inicia a vinculacao (`{ "canal": "telegram" }`): devolve um codigo de uso unico que a propria conta envia ao bot (`/vincular <codigo>`) |
| `DELETE /users/:id/external-identities/link-requests/:requestId` | `users:update` | Cancela a solicitacao pendente (204) |
| `GET /audit-logs?page=&limit=` | permissao `audit:read` | Registros de auditoria, paginado (padrao 20, maximo 100), do mais recente ao mais antigo |
| `GET /dashboard/summary` | autenticado        | Indicadores do dashboard. Cada secao vem conforme a permissao (ver abaixo) |
| `GET /finance/entries?page=&limit=` | `finance:read` | Lancamentos financeiros, paginado (padrao 20, maximo 100), por data decrescente |
| `GET /finance/entries/:id` | `finance:read`   | Consulta um lancamento                                        |
| `POST /finance/entries` | `finance:create`   | Cria um lancamento (nasce `PENDENTE`; o autor e o usuario autenticado) |
| `PATCH /finance/entries/:id` | `finance:update` | Edita os dados. Status e autor sao recusados (400)          |
| `PATCH /finance/entries/:id/status` | `finance:status` | Altera o status respeitando as transicoes permitidas  |
| `GET /settings`        | `settings:read`      | Configuracoes do sistema, lista completa ordenada pela chave (sem paginacao) |
| `GET /settings/:key`   | `settings:read`      | Consulta uma configuracao pela chave                          |
| `PATCH /settings/:key` | `settings:update`    | Altera SOMENTE o valor. Chave, tipo, descricao e responsavel sao recusados (400) |
| `GET /notifications?page=&limit=` | autenticado | Notificacoes do proprio usuario, paginado. Nao lidas primeiro, depois as mais recentes |
| `GET /notifications/unread-count` | autenticado | Quantas o usuario tem por ler |
| `GET /notifications/:id` | autenticado         | Uma notificacao do proprio usuario (404 se for de outra pessoa) |
| `PATCH /notifications/:id/read` | autenticado  | Marca uma como lida. Idempotente; corpo com qualquer campo e recusado (400) |
| `PATCH /notifications/read-all` | autenticado  | Marca todas as nao lidas como lidas. Idempotente |
| `GET /profile`         | autenticado          | Dados pessoais de quem esta autenticado (sem permissao granular) |
| `PATCH /profile`       | autenticado          | Altera os proprios dados. Hoje so `nome`; qualquer outro campo e recusado (400) |

**Dashboard.** `GET /dashboard/summary` e somente leitura e **nao gera registro
de auditoria**. Nao ha permissao propria de dashboard: qualquer usuario
autenticado acessa, e cada secao so vem para quem tem a permissao
correspondente - `usuarios` exige `users:read`, `auditoria` exige `audit:read`.
Um perfil sem nenhuma das duas recebe `{}` com status 200 (a pagina existe, sem
indicadores). Consultas agregadas: nenhuma lista completa e carregada para
contar, e os nomes dos responsaveis pelos eventos saem numa unica consulta.

```json
{
  "usuarios": { "total": 12, "ativos": 10, "inativos": 2 },
  "auditoria": {
    "total": 128,
    "recentes": [
      {
        "id": "…",
        "acao": "LOGIN",
        "modulo": "AUTH",
        "descricao": "Login realizado por maria@example.com",
        "usuario": { "id": "…", "nome": "Maria Silva" },
        "createdAt": "2026-09-22T12:30:00.000Z"
      }
    ]
  }
}
```

Financeiro, automacoes e integracoes entrarao como novas secoes opcionais quando
esses modulos existirem - nenhum dado foi inventado para ocupar espaco.

**Configuracoes.** `settings:read` e `settings:update` sao exclusivas do ADMIN
nesta etapa - o `GESTOR` nao as recebe. A tabela `system_settings` **nao guarda
segredo**: senha, token, API key e credencial continuam vindo de variavel de
ambiente, e as chaves nascem de um catalogo em codigo (por isso nao ha `POST`
nem `DELETE`). O valor e devolvido ja tipado conforme `tipo`, e enviado no mesmo
tipo - `"false"` numa chave `BOOLEAN` e recusado com 400, nao convertido.

```json
{
  "chave": "PAGINATION_DEFAULT_LIMIT",
  "valor": 20,
  "descricao": "Quantidade padrao de itens por pagina nas listagens",
  "tipo": "NUMBER",
  "atualizadoPorId": null,
  "atualizadoPor": null,
  "createdAt": "2026-09-24T10:00:00.000Z",
  "updatedAt": "2026-09-24T10:00:00.000Z"
}
```

Alterar: `PATCH /settings/PAGINATION_DEFAULT_LIMIT` com `{ "valor": 25 }`. Cada
alteracao efetiva gera `SYSTEM_SETTING_UPDATED` (modulo `SETTINGS`) com a chave,
**nunca** o valor. Detalhes em
[docs/arquitetura.md](docs/arquitetura.md#configuracoes-do-sistema).

**Notificacoes.** Avisos INTERNOS, por usuario: nao ha e-mail, push, WhatsApp,
Telegram, WebSocket nem SSE. Nenhuma permissao granular nova - ver as proprias
notificacoes nao e privilegio administrativo, e o destinatario vem sempre do
JWT. Nao existe `POST` nem `DELETE`: quem cria e outro modulo do sistema, pelo
`NotificationsService.createForUser`, que nenhum modulo chama ainda. Consultar
notificacao de outra pessoa responde 404, nunca 403 - um 403 confirmaria que
aquele id existe.

```json
{
  "items": [
    {
      "id": "...",
      "titulo": "Lancamento aprovado",
      "mensagem": "O lancamento de manutencao foi marcado como pago.",
      "tipo": "SUCCESS",
      "lida": false,
      "createdAt": "2026-09-24T12:30:00.000Z",
      "updatedAt": "2026-09-24T12:30:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

Marcar como lida **nao** entra na trilha de auditoria; a decisao e a razao estao
em [docs/arquitetura.md](docs/arquitetura.md#notificacoes-internas).

**Perfil proprio.** `/profile` trabalha sempre com o usuario do JWT - nao ha
parametro de usuario na rota, na query nem no corpo, entao nao existe caminho
para o perfil de outra pessoa. Nenhuma permissao granular foi criada: ver e
editar os proprios dados nao e privilegio administrativo.

Hoje o unico campo editavel e `nome`. `email`, `role`, `ativo`, `id`, senha e
permissoes sao somente leitura e, por estarem fora do DTO, resultam em **400**
se enviados - recusados pelo contrato, nunca ignorados. A gravacao e um
`UPDATE` que cita apenas `nome` e `updated_at`, entao uma alteracao
administrativa concorrente (desativacao, troca de perfil) nunca e revertida
pelo perfil. Troca de senha e de
e-mail continuam fora do escopo. A alteracao reusa a acao de auditoria
`USER_UPDATED`, gravando apenas os NOMES dos campos alterados. Detalhes em
[docs/arquitetura.md](docs/arquitetura.md#perfil-do-proprio-usuario).

Respostas: `400` dados invalidos · `401` credenciais/token invalidos ·
`403` usuario inativo (no login), sem permissao ou alvo fora do seu alcance ·
`404` usuario inexistente · `409` e-mail ja cadastrado ou operacao que deixaria o
sistema sem ADMIN ativo.

Alem da permissao, a administracao de usuarios aplica regras sobre o **alvo**
(detalhes em [docs/arquitetura.md](docs/arquitetura.md#administracao-de-usuarios)):
quem nao e ADMIN so gerencia e concede perfis com menos permissoes que as suas;
ninguem altera o proprio status ou perfil; e o ultimo ADMIN ativo nao pode ser
desativado nem rebaixado.

Toda alteracao administrativa gera um registro de auditoria (modulo `USERS`).
A auditoria e **best-effort**: se a gravacao do log falhar, a alteracao
permanece e o erro vai apenas para o log da aplicacao. Detalhes e consequencias
em [docs/arquitetura.md](docs/arquitetura.md#administracao-de-usuarios).

### Testar com curl

```bash
# cadastrar
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"nome":"Maria Silva","email":"maria@example.com","senha":"Senha1234"}'

# login (guarde o accessToken)
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"maria@example.com","senha":"Senha1234"}'

# rota protegida
curl http://localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"

# sem token -> 401
curl -i http://localhost:3000/auth/me

# RBAC: USUARIO recebe 403; o administrador do seed recebe 200
curl -i http://localhost:3000/users -H "Authorization: Bearer <accessToken>"
```

No PowerShell use `Invoke-RestMethod` ou o Swagger em http://localhost:3000/docs
(faça login em `POST /auth/login`, copie o `accessToken` e clique em
**Authorize**).

A senha precisa ter 8 a 72 caracteres, com maiuscula, minuscula e numero.

Como a autenticacao e a autorizacao funcionam, e as limitacoes conhecidas (logout
sem revogacao do JWT, sem rate limiting), estao em
[docs/arquitetura.md](docs/arquitetura.md).

---

## Comandos disponiveis

Backend, executados dentro de `backend/`:

| Comando                | Descricao                                       |
| ---------------------- | ----------------------------------------------- |
| `npm run start:dev`    | Sobe a API com hot reload                        |
| `npm run start:debug`  | Sobe a API em modo debug                         |
| `npm run build`        | Compila para `dist/`                             |
| `npm run start:prod`   | Executa o build                                  |
| `npm test`             | Testes unitarios                                 |
| `npm run test:watch`   | Testes unitarios em watch                        |
| `npm run test:cov`     | Testes com cobertura                             |
| `npm run test:e2e`     | Testes end-to-end                                |
| `npm run typecheck`    | Verifica tipos sem gerar arquivos                |
| `npm run lint`         | ESLint (falha com qualquer aviso)                |
| `npm run lint:fix`     | ESLint corrigindo o que for automatico           |
| `npm run format`       | Aplica Prettier                                  |
| `npm run format:check` | Verifica formatacao sem alterar arquivos         |
| `npm run migration:*`  | Migrations - ver secao [Banco de dados](#banco-de-dados) |

Frontend, dentro de `frontend/`: `npm run dev`, `npm run build`,
`npm run typecheck`, `npm test`, `npm run lint`, `npm run lint:fix`.

---

## Estrategia de Git

O repositorio e usado por dois desenvolvedores.

```
main        codigo estavel
develop     integracao do trabalho em andamento

feature/auth       feature/database     feature/users
feature/dashboard  feature/telegram     feature/whatsapp
feature/plantae    feature/nfse
```

Regras:

1. Nao commitar direto na `main`.
2. Uma branch por feature, partindo de `develop`.
3. Rodar `npm run lint` e `npm test` antes de abrir PR.
4. Nunca commitar `.env`, credencial, token, certificado ou dado real da Vasta.

> As branches nao foram criadas automaticamente - crie apenas conforme a
> necessidade real.

### Aviso para quem ja tinha o repositorio clonado

O repositorio continha um **submodulo quebrado**: a pasta `vastaflow/` estava
registrada no indice como gitlink (modo `160000`), apontando para um clone do
proprio repositorio, sem `.gitmodules`. Na pratica, um `git clone` trazia essa
pasta vazia.

A entrada foi removida. Quem tinha o repositorio clonado antes dessa correcao
deve sincronizar e apagar a pasta `vastaflow/vastaflow/` residual, se existir.

**Fim de linha e dependencias.** O `.gitattributes` (LF em todo o repositorio)
entrou depois do primeiro clone. Numa copia antiga, arquivos podem continuar em
CRLF no disco e o `npm run format:check` acusa-los, mesmo com `git status`
limpo. Com a arvore limpa (sem alteracoes pendentes), recrie-os a partir do
indice e reinstale as dependencias:

```bash
git rm -r --cached --quiet . && git reset --hard   # APAGA alteracoes nao commitadas
cd backend && npm ci && cd ../frontend && npm ci
```

---

## Observacoes sobre integracoes externas

**Nenhuma integracao foi implementada.** As pastas em `integrations/` apenas
reservam a estrutura.

Nao ha - e nao deve haver ate que tenhamos documentacao e acesso oficiais -
endpoint, URL, token, credencial, payload ou metodo HTTP de qualquer provedor.
Codigo que simula uma integracao funcionando e pior que ausencia de codigo:
esconde o que falta e precisa ser descartado depois.

Pendencias por integracao em [integrations/README.md](integrations/README.md).

---

## Seguranca

Nunca versionar: senha, token, API key, credencial, secret, certificado privado
ou dado real de cliente. O `.gitignore` bloqueia `.env`, `*.pem`, `*.key`,
`*.pfx`, `*.p12`, `certs/` e `secrets/`, mas a regra vale acima da ferramenta.

Respostas de erro 5xx nao expoem a causa: devolvem mensagem generica e um
`incidentId` que permite localizar a falha no log do servidor.

---

## Documentacao

- [docs/arquitetura.md](docs/arquitetura.md) - camadas, modulos e modelo de dados
- [ADR 0001](docs/adr/0001-escolha-do-orm-e-estrategia-de-banco.md) - ORM e estrategia MySQL/Oracle
- [ADR 0002](docs/adr/0002-modulo-commonjs-vs-esm.md) - formato de modulo do backend
- [ADR 0003](docs/adr/0003-topologia-de-producao.md) - topologia de producao (VPS unica, Docker Compose, n8n self-hosted)
- [docs/autenticacao-servico-a-servico.md](docs/autenticacao-servico-a-servico.md) - contrato proposto para o n8n chamar a API (**nao implementado**)

Documentacao em portugues. Codigo em ingles.
