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
| Banco de dados (TypeORM)          | Conexao e entities prontas; sem migrations ainda |
| Usuarios, perfis e permissoes     | Funcionando                             |
| Autenticacao (JWT + bcrypt)       | Funcionando                             |
| Autorizacao (RBAC)                | Funcionando                             |
| Auditoria basica                  | Funcionando                             |
| Frontend: login + dashboard       | Funcionando (demais telas nao iniciadas) |
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
| Node.js    | >= 24  | Recomendado >= 24.15.0 (ver ADR 0002)          |
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
├── frontend/           React + Vite (login e dashboard)
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
- **Docker** (opcional - somente para subir o MySQL local)

Verifique:

```bash
node -v
npm -v
```

---

## Instalacao

```bash
git clone https://github.com/equipe-vastaflow/vastaflow.git
cd vastaflow/backend && npm install
cd ../frontend && npm install
```

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
| `SWAGGER_ENABLED`         | `true`          | Expor `/docs`. Use `false` em producao                        |
| `FRONTEND_ORIGIN`         | vazio (CORS off) | Origens autorizadas a chamar a API, separadas por virgula     |
| `DATABASE_TYPE`           | `mysql`         | `mysql` \| `oracle`                                            |
| `DATABASE_HOST/PORT/NAME/USER/PASSWORD` | -   | Conexao. Dispensadas se `DATABASE_URL` estiver preenchida     |
| `DATABASE_SYNCHRONIZE`    | `false`         | Cria as tabelas a partir das entities. So dev; proibido em producao |
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

Com `DATABASE_SYNCHRONIZE=true` (padrao do `.env.example`), as tabelas
`users`, `roles`, `permissions`, `role_permissions` e `audit_logs` sao criadas no
primeiro boot, e o seed cria perfis, permissoes e o administrador inicial.
**Migrations ainda nao existem** - ver [database/README.md](database/README.md).

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
3. `cd backend && npm run start:dev` — o log deve mostrar
   `Administrador inicial criado: ...`.
4. Em outro terminal, `cd frontend && npm run dev`.
5. Abra http://localhost:5173 e entre com o e-mail/senha do administrador.

### Endpoints

| Metodo e rota          | Acesso               | Descricao                                                  |
| ---------------------- | -------------------- | ---------------------------------------------------------- |
| `POST /auth/register`  | publico              | Cadastra um usuario (sempre perfil `USUARIO`) e devolve o JWT |
| `POST /auth/login`     | publico              | Autentica e devolve o JWT                                    |
| `GET /auth/me`         | autenticado          | Usuario da sessao, com perfil e permissoes                    |
| `POST /auth/logout`    | autenticado          | Registra o logout na auditoria (204)                          |
| `GET /users`           | permissao `users:read` | Lista usuarios (ADMIN e GESTOR)                              |
| `GET /audit-logs`      | permissao `audit:read` | Ultimos registros de auditoria (ADMIN e GESTOR)              |

Respostas: `400` dados invalidos · `401` credenciais/token invalidos ·
`403` usuario inativo (no login) ou sem permissao · `409` e-mail ja cadastrado.

### Testar com curl

```bash
# cadastrar
curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" \
  -d '{"nome":"Maria Silva","email":"maria@vasta.com.br","senha":"Senha1234"}'

# login (guarde o accessToken)
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"maria@vasta.com.br","senha":"Senha1234"}'

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

Frontend, dentro de `frontend/`: `npm run dev`, `npm run build`,
`npm run typecheck`, `npm test`.

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

Documentacao em portugues. Codigo em ingles.
