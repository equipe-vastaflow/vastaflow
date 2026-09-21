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
| Banco de dados                    | Nao iniciado (Etapa 2)                  |
| Autenticacao / JWT / RBAC         | Nao iniciado (Etapa 3)                  |
| Frontend                          | Nao iniciado (Etapa 4)                  |
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

### Frontend (Etapa 4)

React + TypeScript + Vite + React Router.

---

## Estrutura de pastas

```
vastaflow/
├── backend/            API NestJS
│   ├── src/
│   │   ├── config/         validacao de variaveis de ambiente
│   │   ├── common/         filtros, DTOs e utilitarios compartilhados
│   │   ├── modules/        modulos de dominio (health, auth, users, ...)
│   │   └── main.ts         bootstrap, Swagger, pipes e filtros globais
│   └── test/               testes end-to-end
├── frontend/           React + Vite (Etapa 4)
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
cd vastaflow/backend
npm install
```

---

## Configuracao de ambiente

Copie o modelo e preencha os valores do seu ambiente:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

O `.env` esta no `.gitignore` e **nunca** deve ser versionado.

Variaveis em uso hoje:

| Variavel          | Padrao       | Descricao                              |
| ----------------- | ------------ | -------------------------------------- |
| `NODE_ENV`        | `development`| `development` \| `production` \| `test` |
| `PORT`            | `3000`       | Porta HTTP do backend                   |
| `APP_NAME`        | `vasta-flow` | Identificador devolvido por `/health`   |
| `SWAGGER_ENABLED` | `true`       | Expor `/docs`. Use `false` em producao  |

As demais variaveis do `.env.example` (banco, JWT, integracoes) estao
documentadas mas **ainda nao sao lidas pelo codigo**. Elas passam a ser exigidas
quando os modulos correspondentes forem implementados.

A validacao ocorre no boot: uma configuracao invalida derruba o processo na
inicializacao, com mensagem explicita, em vez de gerar erro obscuro no primeiro
request.

> O backend le o `.env` a partir de `backend/`. Se rodar `npm run start:dev`
> dentro de `backend/`, o arquivo deve estar em `backend/.env`.

---

## Banco de dados

Ainda nao implementado (Etapa 2). Para subir o MySQL de desenvolvimento quando
chegar a hora:

```bash
docker compose up -d
docker compose logs -f mysql
docker compose down      # preserva os dados
docker compose down -v   # APAGA os dados do volume
```

As credenciais vem do `.env` da raiz. O container so aceita conexoes de
`127.0.0.1`.

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

Nao iniciado. Ver [frontend/README.md](frontend/README.md).

---

## Comandos disponiveis

Todos executados dentro de `backend/`:

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
