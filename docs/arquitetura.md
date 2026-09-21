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
├── main.ts                    [x] bootstrap, Swagger, pipes e filtros globais
├── app.module.ts              [x] modulo raiz
├── config/                    [x] validacao de variaveis de ambiente
├── common/                    [x] filtros, DTOs e utilitarios compartilhados
│   ├── dto/                   [x] ErrorResponseDto - formato unico de erro
│   └── filters/               [x] AllExceptionsFilter
├── database/                  [ ] Etapa 2 - DataSource, entities, migrations
│   └── migrations/
│       ├── mysql/             [ ] DDL especifico de MySQL
│       └── oracle/            [ ] DDL especifico de Oracle (ver ADR 0001)
├── modules/
│   ├── health/                [x] GET /health
│   ├── auth/                  [ ] Etapa 3 - login, JWT, guards
│   ├── users/                 [ ] Etapa 3
│   ├── roles/                 [ ] Etapa 3
│   ├── permissions/           [ ] Etapa 3
│   └── audit/                 [ ] Etapa 3 - AuditLog
└── integrations/              [ ] Etapa 5 - apenas contratos
```

## Modelo de dados previsto (Etapa 2)

```
User  --- N:1 --->  Role  --- N:N --->  Permission
  |
  | 1:N
  v
AuditLog
```

`AuditLog` registra: usuario responsavel, acao, modulo, descricao, data/hora,
IP quando disponivel e metadados.

Acoes previstas: `LOGIN`, `LOGOUT`, `CREATE`, `UPDATE`, `DELETE`, `EXECUTE`,
`INTEGRATION_REQUEST`, `INTEGRATION_RESPONSE`, `ERROR`.

Papeis iniciais: `ADMIN`, `GESTOR`, `OPERADOR`, `USUARIO`.

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
