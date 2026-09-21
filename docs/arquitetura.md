# Arquitetura do VastaFlow

> Este documento descreve a arquitetura pretendida. O que ja foi **implementado**
> esta marcado com [x]; o restante e plano, nao codigo existente.

## Principio central

A regra de negocio nao conhece nem o banco de dados, nem o canal pelo qual o
pedido chegou. Ela e o centro; tudo mais e periferia substituivel.

## Camadas

```
Controller     entrada HTTP: valida o DTO e delega. Sem regra de negocio.
    |
Service        regra de negocio. Nao conhece SQL nem HTTP.
    |
Repository     traducao para o banco. Unico lugar com detalhe de MySQL/Oracle.
    |
Database       MySQL ou Oracle (um ou outro, nunca os dois)
```

Regras:

- Controller nunca acessa Repository diretamente.
- Service nunca monta SQL.
- Repository nunca decide regra de negocio.

## Multiplos canais, uma regra

O sistema recebera comandos por varios canais. Cada canal traduz seu payload
para um comando interno; a regra de negocio e **unica**.

```
WhatsApp Adapter ---+
                    |
Telegram Adapter ---+---> MessageHandler ---> CommandService ---> Domain Service
                    |                                                   |
API REST -----------+                                              Repository
```

Nenhuma regra de negocio pode ser duplicada por canal. Um adapter so faz
traducao de formato.

> Nenhum adapter foi implementado. Endpoints, autenticacao e payloads de
> WhatsApp, Telegram, Plantae e NFS-e serao definidos apenas quando houver
> documentacao e acesso oficiais.

## Estrutura do backend

```
backend/src/
├── main.ts                    [x] bootstrap, Swagger, CORS
├── app.setup.ts               [x] pipes e filtros globais (compartilhado com os testes e2e)
├── app.module.ts              [x] modulo raiz
├── config/                    [x] validacao de variaveis de ambiente
├── common/                    [x] filtros, DTOs e utilitarios compartilhados
│   ├── decorators/            [x] @ClientIp
│   ├── dto/                   [x] ErrorResponseDto - formato unico de erro
│   └── filters/               [x] AllExceptionsFilter
├── database/                  [x] conexao TypeORM, migrations e seed
│   ├── database.config.ts     [x] DATABASE_* -> opcoes do TypeORM (MySQL | Oracle)
│   ├── database.module.ts     [x] conexao + recusa subir com migration pendente
│   ├── data-source.ts         [x] DataSource do CLI de migrations
│   ├── entities.ts            [x] lista unica de entities (app, CLI e testes)
│   ├── seed/                  [x] permissoes, perfis e administrador inicial
│   └── migrations/
│       ├── index.ts           [x] migrations registradas por banco
│       ├── mysql/             [x] schema inicial - validado em MySQL 8.4 real
│       └── oracle/            [~] schema inicial - gerado, NUNCA executado em Oracle
├── modules/
│   ├── health/                [x] GET /health
│   ├── auth/                  [x] login, register, me, logout, JWT, guards, decorators
│   ├── users/                 [x] entity User, hash de senha, GET /users
│   ├── roles/                 [x] entity Role, enum RoleName, permissoes padrao
│   ├── permissions/           [x] entity Permission, catalogo PermissionCode
│   └── audit/                 [x] entity AuditLog, AuditService, GET /audit-logs
└── integrations/              [ ] Etapa 5 - apenas contratos
```

## Modelo de dados

```
User  --- N:1 --->  Role  --- N:N --->  Permission
                     (tabela role_permissions)

AuditLog   (usuario_id sem FK, de proposito: a trilha sobrevive ao usuario)
```

| Tabela             | Colunas principais                                                              |
| ------------------ | ------------------------------------------------------------------------------- |
| `users`            | `id` (uuid), `nome`, `email` (unico), `senha_hash`, `ativo`, `role_id`, `created_at`, `updated_at` |
| `roles`            | `id`, `nome` (unico), `descricao`, `created_at`                                  |
| `permissions`      | `id`, `code` (unico, ex.: `users:read`), `descricao`, `created_at`                |
| `role_permissions` | `role_id`, `permission_id`                                                       |
| `audit_logs`       | `id`, `usuario_id` (nulo se nao identificado), `acao`, `modulo`, `descricao`, `ip`, `metadados` (JSON, nulo), `created_at` |

`metadados` guarda detalhes adicionais da operacao como JSON (`text` no MySQL,
`CLOB` no Oracle). Antes de gravar, o `AuditService` remove valores de chaves
sensiveis (senha, token, segredo, authorization, cookie...) em qualquer nivel e
descarta conteudo acima de 8.000 caracteres, registrando apenas um aviso - a
auditoria nunca falha por causa dos metadados. Hoje so `LOGIN_FAILED` os usa,
com o `motivo` da recusa.

Acoes de auditoria implementadas: `REGISTER`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`.
Previstas para os proximos modulos: `CREATE`, `UPDATE`, `DELETE`, `EXECUTE`,
`INTEGRATION_REQUEST`, `INTEGRATION_RESPONSE`, `ERROR`.

Perfis: `ADMIN`, `GESTOR`, `OPERADOR`, `USUARIO`.

## Autenticacao e autorizacao

**Autenticacao.** JWT (HS256) assinado com `JWT_SECRET`, contendo apenas o `sub`
(id do usuario). O `JwtAuthGuard` e **global e nega por padrao**: toda rota exige
`Authorization: Bearer <token>`, exceto as marcadas com `@Public()`. A cada
requisicao o usuario e relido do banco, entao desativar uma conta ou trocar o
perfil dela vale na hora, sem esperar o token expirar.

**Autorizacao (RBAC).** Dois decorators, ambos avaliados por guards globais depois
da autenticacao:

- `@RequirePermissions(PermissionCode.UsersRead)` - exige **todas** as permissoes
  listadas. Forma preferida em rotas novas: o vinculo perfil -> permissao vive no
  banco (`role_permissions`) e pode mudar sem alterar codigo.
- `@Roles(RoleName.Gestor, RoleName.Operador)` - exige **um** dos perfis listados.

`ADMIN` passa por qualquer verificacao. Sem nenhum dos dois decorators a rota so
exige estar autenticado.

| Perfil     | Permissoes iniciais                          |
| ---------- | -------------------------------------------- |
| `ADMIN`    | todas (e ignora a checagem)                   |
| `GESTOR`   | `users:read`, `audit:read`                    |
| `OPERADOR` | nenhuma ainda (definidas junto com os modulos) |
| `USUARIO`  | nenhuma (acesso basico: `/auth/me`, logout)   |

**Dados iniciais (seed).** A cada boot, e de forma idempotente, o `SeedService`
cria as permissoes e os perfis que faltam e, se `SEED_ADMIN_EMAIL` e
`SEED_ADMIN_PASSWORD` estiverem definidos, o administrador inicial. Perfil ja
existente nunca tem as permissoes sobrescritas.

**Decisoes de seguranca.**

- Senha: bcrypt (`BCRYPT_SALT_ROUNDS`), 8 a 72 caracteres com maiuscula, minuscula e numero
  (72 bytes e o limite real do bcrypt).
- Login com e-mail inexistente e com senha errada respondem igual (401) e gastam
  o mesmo tempo (compara contra um hash descartavel); o status inativo (403) so
  e revelado a quem acertou a senha.
- O cadastro publico nao aceita `role`: sempre cria `USUARIO`.
- Falha ao gravar a auditoria e registrada em log mas nao derruba a operacao.

**Limitacoes conhecidas (para o hardening).**

- Logout nao invalida o JWT (stateless): apenas audita. O token vale ate expirar.
  Revogacao imediata exige lista de tokens revogados ou versao de token no usuario.
- Sem limite de tentativas de login (rate limiting / bloqueio temporario).
- Sem refresh token: ao expirar, o usuario faz login de novo.
- Migration Oracle nunca executada em banco real, e sem caminho definido para
  gerar as proximas (ver database/README.md).
- Atras de proxy reverso, o IP registrado na auditoria e o do proxy, a menos que
  o Express seja configurado com `trust proxy`.

## Tratamento de erros

Toda falha sai no formato de `ErrorResponseDto`:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Cannot GET /rota",
  "path": "/rota",
  "timestamp": "2026-09-21T18:22:38.127Z"
}
```

Erros 5xx **nao** expoem a causa: respondem `"Erro interno do servidor"` mais um
`incidentId` (UUID). A causa real vai somente para o log do servidor, com o
mesmo `incidentId`, permitindo correlacionar sem vazar detalhe de infraestrutura
para o cliente.

## Health check

`GET /health` responde `{ "status": "ok", "service": "vasta-flow" }`.

A extensao ja esta prevista: implemente a interface `HealthIndicator`
(`src/modules/health/health.types.ts`) e registre o indicador no provider
`HEALTH_INDICATORS` do `HealthModule`. Controller e service nao mudam. Quando ha
indicadores registrados, a resposta ganha um campo `checks` com o estado de cada
componente, e o status agregado assume o pior estado encontrado.

Um indicador que lanca excecao e reportado como `down` sem derrubar o endpoint,
e sua mensagem de erro **nao** vai para a resposta (poderia conter host, usuario
ou senha).

## Decisoes registradas

- [ADR 0001](adr/0001-escolha-do-orm-e-estrategia-de-banco.md) - ORM e estrategia MySQL/Oracle
- [ADR 0002](adr/0002-modulo-commonjs-vs-esm.md) - formato de modulo do backend
