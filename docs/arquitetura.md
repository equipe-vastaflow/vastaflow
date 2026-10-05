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

> O adapter do **Telegram** existe (ver "Canal Telegram" abaixo). WhatsApp,
> Plantae e NFS-e continuam sem implementacao: endpoints, autenticacao e
> payloads so serao definidos quando houver documentacao e acesso oficiais.

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
│   ├── users/                 [x] entity User, hash de senha, administracao (/users)
│   │   └── user-directory     [x] modulo de fronteira: le id/nome/e-mail (sem regra de negocio)
│   ├── roles/                 [x] entity Role, enum RoleName, permissoes padrao
│   ├── permissions/           [x] entity Permission, catalogo PermissionCode
│   ├── finance/               [x] lancamentos financeiros - primeiro dominio de negocio
│   ├── audit/                 [x] entity AuditLog, AuditService, GET /audit-logs (paginado)
│   │                              usa UserDirectoryModule para nomear o responsavel
│   ├── dashboard/             [x] GET /dashboard/summary - agrega os modulos acima
│   ├── external-identities/   [x] vinculo conta externa -> usuario, com prova de posse; resolvedor
│   └── integrations/          [x] foundation: contrato, estados e registro
│       ├── channels/          [x] mensagem e identidade externa, neutras de fornecedor
│       └── telegram/          [x] canal Telegram (long polling) -> Command Engine
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
| `financial_entries` | `id`, `tipo`, `descricao`, `valor` DECIMAL(15,2), `data` DATE, `categoria`, `status`, `observacao` (nulo), `criado_por_id` (sem FK), `created_at`, `updated_at` |
| `system_settings`  | `id`, `chave` (unica), `valor` (texto), `descricao`, `tipo`, `atualizado_por_id` (nulo, sem FK), `created_at`, `updated_at` |
| `notifications`    | `id`, `usuario_id` (destinatario, sem FK), `titulo`, `mensagem`, `tipo`, `lida`, `created_at`, `updated_at`, `read_at` (nulo enquanto nao lida) |
| `external_identity_links` | `id`, `canal`, `id_externo` (UNICO com `canal`), `usuario_id` (sem FK), `created_at`, `updated_at` |
| `identity_link_requests` | `id`, `canal`, `usuario_id`, `codigo_hash` (UNICO), `status`, `pendente_chave` (UNICA, nula fora de PENDENTE), `expira_em`, `criado_por_id`, `created_at`, `updated_at` |

`metadados` guarda detalhes adicionais da operacao como JSON (`text` no MySQL,
`CLOB` no Oracle). Antes de gravar, o `AuditService` remove valores de chaves
sensiveis (senha, token, segredo, authorization, cookie...) em qualquer nivel e
descarta conteudo acima de 8.000 caracteres, registrando apenas um aviso - a
auditoria nunca falha por causa dos metadados. Usados por `LOGIN_FAILED` (o `motivo`
da recusa) e pelas acoes de administracao de usuarios (o `alvoId` e o que mudou).

Acoes de auditoria implementadas: `REGISTER`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`
(modulo `AUTH`); `USER_CREATED`, `USER_UPDATED`, `USER_ACTIVATED`,
`USER_DEACTIVATED`, `USER_ROLE_CHANGED`, `IDENTITY_LINK_REQUESTED`,
`IDENTITY_LINK_CANCELLED`, `EXTERNAL_IDENTITY_LINKED`, `EXTERNAL_IDENTITY_UNLINKED`
(modulo `USERS`); e
`FINANCE_ENTRY_CREATED`, `FINANCE_ENTRY_UPDATED`,
`FINANCE_ENTRY_STATUS_CHANGED` (modulo `FINANCE`); e `SYSTEM_SETTING_UPDATED`
(modulo `SETTINGS`). Previstas
para os proximos modulos: `DELETE`, `EXECUTE`, `INTEGRATION_REQUEST`,
`INTEGRATION_RESPONSE`, `ERROR`.

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
| `GESTOR`   | `users:*`, `audit:read` e `finance:read/create/update/status` - **sem** `settings:*` |
| `OPERADOR` | nenhuma ainda (definidas junto com os modulos) |
| `USUARIO`  | nenhuma (acesso basico: `/auth/me`, logout)   |

**Dados iniciais (seed).** A cada boot, e de forma idempotente, o `SeedService`
cria as permissoes e os perfis que faltam e, se `SEED_ADMIN_EMAIL` e
`SEED_ADMIN_PASSWORD` estiverem definidos, o administrador inicial. Perfil ja
existente nunca perde permissoes nem tem ajustes desfeitos, mas **recebe as
permissoes novas do catalogo** que constem no seu padrao (`role-defaults.ts`).
Exemplo: num banco criado antes da administracao de usuarios, o `GESTOR` ganha
`users:create`, `users:update`, `users:status` e `users:role` no primeiro boot
da versao nova.

## Administracao de usuarios

Rotas em `/users`, cada uma com a sua permissao granular (ver README). O guard
de permissao nao conhece o usuario-alvo, entao o `UserManagementService` aplica
mais tres regras:

1. **Hierarquia** (`user-access.policy.ts`). Quem nao e ADMIN so gerencia
   usuarios - e so concede perfis - cujas permissoes sejam um subconjunto
   **estrito** das suas. Com os padroes: GESTOR gerencia OPERADOR e USUARIO, mas
   nao outro GESTOR nem ADMIN. Ninguem concede permissao que nao tem. ADMIN e
   reconhecido pelo nome: so ADMIN concede ADMIN ou gerencia quem o tem.
2. **Auto-alteracao.** Ninguem altera o proprio status nem o proprio perfil. Os
   proprios nome e e-mail podem ser editados por quem tem `users:update`.
3. **Ultimo ADMIN ativo.** Desativar ou rebaixar um ADMIN ativo e recusado (409)
   se nao houver outro ADMIN ativo. A checagem roda numa transacao com as linhas
   dos ADMINs travadas (`SELECT ... FOR UPDATE` no MySQL e no Oracle), para que
   dois ADMINs desativando um ao outro ao mesmo tempo nao deixem o sistema sem
   nenhum. O SQLite dos testes nao tem esse lock; o comportamento concorrente so
   pode ser verificado em MySQL/Oracle reais.

O `PATCH /users/:id` generico so aceita nome e e-mail: senha, perfil e status
sao recusados com 400. Nao ha fluxo de troca de senha ainda.

O frontend usa `GET /users/assignable-roles` para saber quais acoes mostrar, sem
reimplementar a hierarquia. Esconder botoes e so conveniencia: toda operacao e
autorizada de novo no backend.

**Auditoria.** Toda alteracao efetivada gera um AuditLog (modulo `USERS`) com o
autor em `usuarioId` e o alvo em `metadados.alvoId`; `USER_UPDATED` guarda os
valores anterior e novo de nome e e-mail. Nao geram registro: operacoes que nao
mudam nada (ativar quem ja esta ativo, repetir o mesmo perfil) e tentativas
recusadas (403, 409). Senha nunca e gravada - nem aparece nas operacoes, e o
`sanitizeAuditMetadata` removeria de qualquer forma.

> **A auditoria e best-effort.** O registro e gravado **depois** da alteracao,
> fora da transacao dela. Se a gravacao do AuditLog falhar (ex.: banco
> indisponivel naquele instante), o erro vai para o log da aplicacao, a
> alteracao **permanece** e a resposta ao cliente e de sucesso. Consequencia: a
> trilha pode ter lacunas e **nao serve, hoje, como prova de que uma alteracao
> nao ocorreu**. Tornar a auditoria obrigatoria (gravar na mesma transacao e
> desfazer a operacao se o log falhar) e uma decisao em aberto; o ponto de
> mudanca e o `AuditService.record`.

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

## Dashboard administrativo

`GET /dashboard/summary` **agrega**: nao tem entity, tabela nem repositorio
proprio, apenas consome `UsersService` e `AuditService`. Por isso o modulo nao
exigiu nenhuma migration.

**Autorizacao sem permissao nova.** Qualquer usuario autenticado chama o
endpoint; cada secao e incluida apenas para quem tem a permissao correspondente:

| Secao       | Permissao    | Conteudo                                    |
| ----------- | ------------ | ------------------------------------------- |
| `usuarios`  | `users:read` | total, ativos, inativos                      |
| `auditoria` | `audit:read` | total de eventos e os 10 mais recentes       |

A decisao usa `hasPermission()` (`modules/auth/has-permission.ts`), a **mesma**
funcao do `PermissionsGuard` - assim a regra de ADMIN e de permissao granular
nao diverge entre "barrar a rota" e "montar a resposta". Um perfil sem nenhuma
das duas recebe `{}` com 200: o dashboard e a pagina inicial de todo usuario
autenticado, entao um 403 quebraria a navegacao de quem so tem acesso basico.

**Somente leitura.** Abrir o dashboard nao gera `AuditLog`.

**Consultas (por requisicao, independentemente do volume de dados):**

1. contagem de usuarios: uma agregacao (`COUNT` + `SUM(CASE ...)`), sem carregar linhas;
2. `COUNT` de `audit_logs`;
3. os 10 eventos mais recentes (`ORDER BY created_at DESC` + `LIMIT`);
4. nomes dos responsaveis: uma consulta `WHERE id IN (...)` para todos de uma vez.

O passo 4 existe porque `audit_logs.usuario_id` **nao** tem chave estrangeira -
de proposito, para a trilha sobreviver ao usuario -, entao nao ha relacao para o
TypeORM carregar junto. Resolver nome por evento seria N+1; a consulta em lote
evita isso. Medido contra MySQL real: 6 consultas por requisicao com 2 usuarios
distintos na auditoria, e as mesmas 6 com 6 usuarios distintos.

**Ainda nao existe** campo de "alvo" no `AuditLog`. Quando existir, entra como
mais uma coluna da tabela do dashboard. Financeiro, automacoes e integracoes
entram como novas secoes opcionais quando os modulos existirem.

## Auditoria: dashboard x tela completa

Sao duas leituras da mesma tabela, com contratos diferentes de proposito:

| | `GET /dashboard/summary` | `GET /audit-logs` |
| --- | --- | --- |
| Quem usa | Cartao do dashboard | Tela `/audit-logs` |
| Quantidade | 10 mais recentes, fixo | Pagina (padrao 20, maximo 100) + `total` |
| Responsavel | `{ id, nome }` | `usuarioId` + `{ id, nome, email }` |
| `ip` e `metadados` | Nao devolvidos | Devolvidos, mas **nao exibidos** na tela |

### Como o responsavel e identificado sem criar ciclo

`audit_logs.usuario_id` nao tem chave estrangeira **de proposito** - a trilha
sobrevive ao usuario -, entao nao ha relacao para o TypeORM carregar junto: o
nome precisa vir de outra consulta.

O caminho obvio seria o `AuditModule` importar o `UsersModule`. Isso **nao
funciona**: `UsersModule` ja importa `AuditModule` para gravar auditoria, e o
import de volta fecharia o ciclo `UsersModule -> AuditModule -> UsersModule`.

A saida foi um modulo de fronteira minusculo, `UserDirectoryModule`
(`modules/users/user-directory.*`):

```
UsersModule ──> AuditModule ──> UserDirectoryModule ──> (so a entity User)
```

Ele expoe um unico metodo somente-leitura, `findByIds(ids)`, que devolve
`id -> { id, nome, email }`. Nao importa `UsersModule` nem `AuditModule`, entao
nao ha ciclo - e nao foi preciso `forwardRef` (o projeto nao usa nenhum). Criar,
alterar e aplicar regra de negocio sobre usuarios continua exclusividade do
`UsersModule`.

**Sem N+1:** o `AuditService` junta os `usuario_id` da pagina e faz UMA busca em
lote, independentemente de quantos eventos ou quantos usuarios distintos a
pagina tenha. Sao sempre 2 consultas de dados por pagina (a pagina com `COUNT` e
o lote de responsaveis).

Tres situacoes possiveis na coluna "Responsavel" da tela:

| Situacao | `usuarioId` | `usuario` | Tela mostra |
| --- | --- | --- | --- |
| Acao de um usuario existente | preenchido | `{ id, nome, email }` | nome + e-mail |
| Evento sem usuario (ex.: login com e-mail inexistente) | `null` | `null` | "Não identificado" |
| Usuario removido do sistema | preenchido | `null` | "Usuário removido (id curto)" |

A paginacao usa `ORDER BY created_at DESC, id DESC`. O `id` desempata: varios
eventos podem cair no mesmo instante, e sem criterio estavel o mesmo evento
poderia aparecer em duas paginas - ou em nenhuma.

## Financeiro

Primeiro dominio de negocio. Deliberadamente pequeno: apenas lancamentos
internos, sem fornecedor, cliente, conta bancaria, centro de custo, parcela,
recorrencia, moeda nem documento fiscal.

| Permissao         | Rota                                  |
| ----------------- | ------------------------------------- |
| `finance:read`    | `GET /finance/entries`, `GET /finance/entries/:id`, `GET /finance/reports/summary`, `GET /finance/reports/export`, comando `/financeiro` |
| `finance:create`  | `POST /finance/entries`               |
| `finance:update`  | `PATCH /finance/entries/:id`          |
| `finance:status`  | `PATCH /finance/entries/:id/status`   |

Nao existe `finance:export`. Relatorio e exportacao entregam o mesmo conjunto
que quem tem `finance:read` ja percorre pagina por pagina pela listagem; uma
permissao separada sugeriria uma barreira que de fato nao existe. O que
diferencia a exportacao e a trilha de auditoria, nao o acesso.

**Status.** Todo lancamento nasce `PENDENTE`. Transicoes permitidas:
`PENDENTE -> PAGO`, `PENDENTE -> CANCELADO` e `PAGO -> CANCELADO`. `CANCELADO` e
terminal, e `PAGO -> PENDENTE` e recusado (409) porque apagaria o fato de que o
lancamento foi pago. Repetir o status atual nao e transicao: responde 200 sem
gravar nem auditar, mesmo criterio de ativar um usuario que ja esta ativo.

**Edicao por status** (`entry-status.policy.ts`), para preservar a integridade
do fato financeiro ja consumado:

| Status      | `tipo`, `valor` e `data` | `descricao`, `categoria`, `observacao` | Observacao |
| ----------- | ------------------------ | -------------------------------------- | ---------- |
| `PENDENTE`  | editaveis                | editaveis                              | ainda e uma previsao |
| `PAGO`      | **congelados**           | editaveis                              | corrige-se o texto sem apagar o fato |
| `CANCELADO` | **congelados**           | **congelados**                         | terminal tambem para a edicao |

Em `PAGO`, os tres campos congelados sao os que respondem *o que* foi pago,
quanto e quando. `tipo` entra nessa lista porque trocar `RECEITA` por `DESPESA`
inverte o sinal de um pagamento que ja aconteceu - nao e correcao de texto.

`CANCELADO` bloqueia tudo pela mesma razao que nenhuma transicao sai dele: o
registro esta encerrado e serve de historico. Para corrigir algo depois do
cancelamento, cria-se um lancamento novo - o anterior permanece.

A recusa vem como **409**, ANTES de qualquer escrita: o banco nao muda e nenhum
`FINANCE_ENTRY_UPDATED` e gravado. Corpo vazio continua sendo operacao sem
efeito (200), em qualquer status.

**Autoria.** O autor e sempre o usuario autenticado; o corpo nao aceita
identificador de usuario. `criado_por_id` nao tem FK (mesmo motivo de
`audit_logs.usuario_id`) e o nome do autor e resolvido em lote pelo
`UserDirectoryService` - uma consulta por pagina, nunca uma por lancamento.

**Auditoria.** Apenas o que MUDA entra na trilha - criacao, edicao e mudanca de status -, com
metadados minimos: `alvoId`, e conforme o caso `tipo`/`status`, os NOMES dos
campos alterados, ou `de`/`para`. Valor e descricao do lancamento **nao** vao
para a trilha - sao dados de negocio, e quem tem `finance:read` os consulta pela
API. **Nenhuma leitura audita**: nem `GET /finance/entries`, nem `GET /finance/entries/:id`,
nem o resumo dos relatorios, nem o comando `/financeiro`. A unica excecao e a
EXPORTACAO, pelo motivo explicado em [Relatorios e exportacao](#relatorios-e-exportacao).

### Dinheiro e data: duas armadilhas de portabilidade, ambas verificadas

**`valor` e `DECIMAL(15,2)`** (`NUMBER(15,2)` no Oracle) - nunca ponto
flutuante. Os drivers divergem na LEITURA e o TypeORM nao normaliza isso: MySQL
devolve `string`, Oracle e SQLite devolvem `number`. Sem tratamento, o mesmo
codigo se comportaria diferente em teste e em producao. O `moneyTransformer`
uniformiza para `number` e arredonda para 2 casas na escrita.

**`data` usa `utc: true`.** O MySQL devolve a coluna DATE como um `Date` em
00:00 UTC e, sem essa opcao, o TypeORM a formata no fuso LOCAL do servidor: em
qualquer fuso negativo - o do Brasil, por exemplo - o dia volta um. Isso foi
observado na pratica contra um MySQL real: gravou-se `2026-09-23` e leu-se
`2026-09-22`. Com `utc: true` a leitura usa os getters UTC e o dia se preserva.
A opcao nao altera o DDL. O `database-compatibility.spec.ts` falha se ela for
removida, em qualquer fuso.

### Comando `/financeiro`

Primeiro comando de negocio do motor. Exige `finance:read` - a mesma permissao
de quem lista pela API - e responde com o total de lancamentos e os 5 mais
recentes, lidos do banco. Sem lancamentos, diz exatamente isso: nao ha numero
inventado nem exemplo ficticio. Depende do `FinanceService`, nunca do
repositorio, e nao conhece HTTP, Telegram nem WhatsApp.

A execucao **nao** entra na trilha: a auditoria do motor e opt-in e este comando
so consulta, como `/ajuda` e `/status`. A trilha registra o que muda.

Nao existe `/receitas`, `/despesas`, `/pagar`, `/saldo` nem `/relatorio`: este
comando e apenas o ponto de entrada do dominio. Relatorio existe, mas por HTTP
(abaixo) - nao ha comando de chat que o produza, e a planilha nao seria
entregavel por um canal de texto.

### Relatorios e exportacao

Duas rotas de leitura sobre os MESMOS lancamentos, sem modelo novo e sem
migration: `GET /finance/reports/summary` devolve os totais agregados do periodo
e `GET /finance/reports/export` devolve a planilha das linhas daquele periodo.

**Filtros: uma estrutura so.** `FinanceFilter` (`de`, `ate`, `status`, `tipo`,
`categoria`) atende a listagem e os dois relatorios, pelo mesmo caminho no
repositorio. Dois dialetos de filtro divergiriam no primeiro ajuste - e os
numeros do relatorio deixariam de corresponder ao que a tela lista. A diferenca
e so a obrigatoriedade do periodo:

| Rota | `de` / `ate` | Demais filtros |
| ---- | ------------ | -------------- |
| `GET /finance/entries` | opcionais (sem eles, lista tudo, como antes) | opcionais |
| `GET /finance/reports/*` | **obrigatorios**, no maximo 366 dias | opcionais |

O periodo e obrigatorio nos relatorios porque e ele que limita o custo da
consulta: sem recorte de data, um relatorio varreria a tabela inteira. O maximo
e 366 dias, e nao 365, para que "01/01 a 31/12" de um ano bissexto caiba.

`de`/`ate` filtram a coluna `data` - o dia do lancamento/vencimento. **Nao
existe data de pagamento no modelo**, e `data` fica congelada quando o
lancamento vira `PAGO`; portanto um periodo recorta por quando o lancamento
ocorre ou vence, nunca por quando foi pago. Um relatorio de caixa por data de
pagamento exigiria uma coluna que o modelo nao tem, e inventa-la aqui seria
inventar o dado.

As regras que dependem das DUAS datas ficam em `report-period.policy.ts`, funcao
pura como `entry-status.policy.ts`. Ela tambem valida se o dia existe no
calendario, de forma redundante com o `@IsISO8601({ strict: true })` do DTO - e
de proposito: a politica e a autoridade sobre o periodo e nao pode depender de
quem a chama ter passado por um DTO. `Date.parse` nao serve sozinho: recusa mes
fora de faixa (`2026-13-01` da `NaN`) mas **rola dia fora do mes em silencio**
(`2026-02-30` vira 02/03), o que produziria um relatorio de um periodo diferente
do pedido.

**O que o resumo devolve.** Totais do conjunto filtrado e tres agrupamentos
(por status, por tipo, por categoria), todos calculados no banco.

Nao existe um `valorTotal` generico. `valor` e sempre positivo e o sinal esta no
`tipo`, entao somar receitas com despesas daria um numero sem significado -
medido num MySQL real, 2.500,74 contra um saldo verdadeiro de 500,25. Quem
representa dinheiro liquido e o `saldo`.

| Campo | Inclui `CANCELADO`? |
| ----- | ------------------- |
| `totalRegistros` | **sim** - descreve o conjunto filtrado |
| `totalReceitas`, `totalDespesas`, `saldo` | **nao** - lancamento cancelado nao e dinheiro |
| `porStatus` | **sim**, em linha propria |
| `porTipo`, `porCategoria` | sim (soma bruta do grupo) |

O cancelado aparece contado e agrupado, mas fora do saldo: oculta-lo faria o
total de registros nao fechar com a listagem, e soma-lo faria o saldo mentir.

**Tudo agregado no banco.** O resumo custa **4 consultas** (`COUNT`+`SUM`
condicional numa, e um `GROUP BY` para cada agrupamento), independentemente do
volume. Medido contra MySQL 8.4 real: 6 consultas por requisicao de ponta a
ponta tanto para um recorte de 55 linhas quanto para um de 50.001 - 909x mais
dados, mesmo custo -, das quais 2 sao a autenticacao (o guard rele o usuario a
cada requisicao, como em qualquer rota autenticada) e 4 sao o relatorio. O Node
nunca percorre lancamentos para somar dinheiro.

Agregacao **nao passa pelo transformer da entidade**: `getRawOne`/`getRawMany`
devolvem o que o driver deu. Verificado em MySQL real: o TypeORM devolve
`COUNT` como a string `"5"` e `SUM(DECIMAL)` como `"1250.50"`, enquanto a
entidade hidratada traz `number`. Sem normalizar, o tipo do JSON da API mudaria
conforme o banco; `readCount`/`readMoney` uniformizam, e `SUM` de conjunto vazio
(`NULL`) vira zero.

**A exportacao** entrega as LINHAS do recorte, nao o resumo - quem recebe a
planilha quer poder conferir e filtrar lancamento por lancamento. Oito colunas:
ID, Tipo, Descricao, Valor, Data, Categoria, Status, Observacao.

`criado_por_id` **nao** vai na planilha: um UUID interno nao diz nada a quem le,
e resolver o nome exigiria uma consulta extra por lote, sem pedido de ninguem.

Escrita em modo streaming (`WorkbookWriter` do `exceljs`), em lotes de 500 lidos
por **cursor** `(data, id)` - e nao por `OFFSET`: a exportacao le varios lotes em
sequencia e, com offset, uma insercao no meio deslocaria as paginas seguintes,
repetindo ou pulando linhas no arquivo. Verificado com 20.000 linhas em MySQL
real: 20.000 linhas distintas, nenhuma repetida, nenhuma faltando, e ordem
decrescente de data preservada no arquivo inteiro (0,85 MB em ~1,7 s, resposta
`chunked`).

**Limite de 50.000 linhas**, acima disso **409**. O volume e conferido *antes* de
qualquer byte sair, o que e o ponto central do desenho: o service recebe o
destino como funcao (`open: () => Writable`) e so a invoca depois de o periodo e
a contagem passarem. Se o cabecalho de download fosse escrito antes da checagem,
o cliente receberia um `.xlsx` corrompido no lugar da mensagem de erro.
Verificado em MySQL real com 50.001 linhas: 409 em 26 ms, corpo JSON, nenhum
`Content-Disposition`, e nenhum registro de auditoria.

**Datas na planilha** sao gravadas como numero de serie do Excel calculado com
aritmetica inteira em UTC (`Date.UTC(...) - Date.UTC(1899, 11, 30)`), com formato
`dd/mm/yyyy`. Passar a string por `new Date()` arriscaria o mesmo deslocamento de
um dia que `utc: true` evita na coluna; gravar texto manteria o dia certo mas a
celula nao seria ordenavel nem filtravel como data. Verificado ponta a ponta:
todas as celulas voltam como meia-noite UTC exata do mesmo dia do banco.

**Texto do usuario nao vira formula.** Uma `descricao` como `=HYPERLINK(...)` ou
uma `observacao` como `-1+1` permanecem texto inerte: o `exceljs` grava celula de
string e o arquivo gerado nao contem nenhum elemento `<f>`. Confirmado no arquivo
produzido pela aplicacao real. Por isso **nao** ha prefixo defensivo na
exportacao - ele corromperia dado legitimo, como uma descricao que comece com
"-", para resolver um problema que o formato XLSX nao tem. (Um CSV teria.)

**Auditoria: consultar nao, exportar sim.** O resumo nao entra na trilha, pelo
mesmo criterio que mantem toda leitura fora dela. A exportacao entra
(`FINANCE_REPORT_EXPORTED`, modulo `FINANCE`), porque produz um arquivo que sai
do sistema - "quem extraiu a base, de que periodo e quantas linhas" e exatamente
o que a trilha deve responder.

Os metadados levam **somente** o recorte e o volume:
`{ de, ate, status, tipo, categoria, quantidade }`. Filtro ausente vai como
`null`, nunca omitido. Nenhum valor monetario, nenhuma descricao de lancamento,
nada do conteudo do arquivo - mesmo criterio do resto do financeiro. O nome do
arquivo (`vastaflow-financeiro-<de>-a-<ate>.xlsx`) tambem leva so o periodo: a
categoria filtrada nao entra nele.

O registro e gravado **depois** de o arquivo terminar de sair - a contagem de
linhas so existe no fim, e a resposta nao pode ficar aberta esperando a escrita
da trilha. Quem baixa recebe o arquivo um instante antes de o registro existir.
Isso e consistente com a auditoria best-effort do sistema: ela nunca desfaz nem
atrasa a operacao.

**Front-end.** `/finance/relatorios`, protegida por `finance:read`. O periodo
comeca no mes corrente e nada e consultado antes de o usuario pedir. Nenhum
numero e calculado na tela - ela exibe o que o backend mandou; o teste prova isso
alimentando totais deliberadamente incoerentes e exigindo que aparecam como
vieram.

O limite de 366 dias **nao** e repetido no frontend: duplicar a constante faria
as duas versoes divergirem, entao periodo longo demais recebe a mensagem do
backend. A tela valida apenas o que nao depende de regra de negocio - as duas
datas presentes e na ordem certa -, com `noValidate` no formulario para que haja
uma unica via de validacao (sem isso, o botao que submete mostraria a bolha do
navegador e o botao de exportar mostraria a mensagem da tela).

A planilha e baixada por `fetch` autenticado e entregue via `createObjectURL`,
porque a rota exige `Authorization` - um `<a href>` comum nao o envia. O
endereco temporario e revogado no ciclo seguinte; revogar na mesma volta do laco
de eventos chega a cancelar o download em alguns navegadores.

`Content-Disposition` e declarado em `exposedHeaders` no CORS: entre origens
diferentes, o JavaScript so le os cabecalhos de resposta liberados ali, e sem
isso o nome do arquivo definido pelo backend nao chegaria ao navegador. Expor um
cabecalho nao amplia quem pode chamar a API - a origem ja tem de estar na lista
de origens permitidas.

**Dependencia nova: `exceljs`.** A primeira do projeto desde a fundacao. Escrita
de XLSX nao e algo a implementar a mao: o formato e um pacote OOXML compactado
com varios XML inter-referenciados. O `exceljs` tem writer em streaming, que e o
que permite nao montar a planilha inteira em memoria. `npm audit` reporta 2
avisos moderados, ambos vindos do `uuid@8.3.2` transitivo
(GHSA-w5hq-g745-h8pq): o problema esta em `v3/v5/v6` quando se passa um buffer
explicito, e o `exceljs` importa **apenas `v4`**, num unico arquivo
(`cf-rule-ext-xform.js`) - o caminho vulneravel nao e alcancavel por este uso.
`npm audit fix --force` rebaixaria o `exceljs` para 3.4.0, uma mudanca
incompativel: pior do que o aviso.

**Sem migration.** O recurso nao adiciona coluna, tabela nem indice. O recorte
por periodo usa o `ix_fin_data` que ja existia - confirmado por `EXPLAIN` em
MySQL real (`key=ix_fin_data`). As 7 migrations existentes foram aplicadas num
MySQL 8.4 limpo e os dois endpoints funcionaram sobre esse schema, sem nenhuma
oitava migration.

**Collation.** `categoria` e texto livre e a igualdade segue a collation da
coluna. No MySQL (`utf8mb4_0900_ai_ci`), "Insumos" e "insumos" sao o MESMO grupo
- verificado em banco real. Num banco com collation sensivel a caixa seriam
dois. A diferenca e do banco e nao e corrigida em silencio na aplicacao.

**Oracle.** Nao validado em banco real - nao ha instancia Oracle disponivel.
O SQL emitido usa apenas construcoes comuns aos dois bancos (`COUNT`, `SUM`,
`CASE WHEN`, `GROUP BY`, comparacao de `DATE` por parametro e a comparacao de
cursor em duas partes, escrita assim justamente porque a sintaxe de construtor
de linha difere entre eles), e o `database-compatibility.spec.ts` continua
passando. Isso e analise estatica, nao validacao: **Oracle segue pendente de
verificacao em instancia real.**

## Configuracoes do sistema

Parametros internos administrados pela propria aplicacao, em `system_settings`.
E a base persistente que as integracoes futuras vao consultar - nesta etapa
apenas o nucleo administrativo existe.

**Nao guarda segredo.** Senha, token, API key, credencial de terceiro e
certificado NAO entram nesta tabela: nao ha coluna `secret`, nao ha cifragem e
quem tem `settings:read` le todos os valores em claro. Credenciais continuam
vindo de variavel de ambiente. O teste `setting-catalog.spec.ts` falha se
alguma chave com cara de credencial entrar no catalogo.

**Catalogo em codigo.** As chaves nascem em `setting-catalog.ts` e o `SeedService`
cria no banco as que faltarem, a cada boot, sem sobrescrever valor ja
administrado. Por isso nao existe `POST /settings` nem `DELETE /settings`:
acrescentar configuracao e mudar o catalogo, nao chamar a API.

| Permissao          | Rotas                                     |
| ------------------ | ----------------------------------------- |
| `settings:read`    | `GET /settings`, `GET /settings/:key`     |
| `settings:update`  | `PATCH /settings/:key`                    |

As duas sao **exclusivas do ADMIN** nesta etapa - `GESTOR` nao as recebe, mesmo
tendo outras permissoes administrativas. O ADMIN as obtem pelo mecanismo que ja
existia (`DEFAULT_ROLE_PERMISSIONS[ADMIN] = Object.values(PermissionCode)`, alem
de o `PermissionsGuard` liberar ADMIN incondicionalmente); nenhuma regra nova de
ADMIN foi criada.

**Tipagem.** O `valor` e sempre TEXTO no banco - o mesmo DDL nos dois bancos,
sem JSON nativo (que exigiria Oracle 21c+) - e a coluna `tipo` diz como
interpreta-lo:

| `tipo`    | Aceita no `PATCH`     | Devolve no `GET`  |
| --------- | --------------------- | ----------------- |
| `STRING`  | texto nao vazio       | `string`          |
| `NUMBER`  | numero finito na faixa | `number`          |
| `BOOLEAN` | `true` ou `false`     | `boolean`         |

Nao ha coercao: `"false"` numa chave BOOLEAN e recusado com 400, em vez de virar
`true` por uma conversao ingenua; `"20"` numa chave NUMBER tambem. Como o corpo
chega em JSON, o tipo ja vem do payload e pode ser exigido. A conversao fica em
`setting-value.ts`, funcao pura, e a leitura de uma linha corrompida por fora
(SQL manual) falha alto em vez de devolver valor adivinhado.

**Somente o valor muda.** `chave`, `tipo` e `descricao` vem do catalogo e o
responsavel vem do JWT. O DTO do `PATCH` so tem `valor`, e o `ValidationPipe`
global roda com `forbidNonWhitelisted` - enviar qualquer outro campo resulta em
400.

**Leitura pelos demais modulos.** `SystemSettingsService` (`get`, `getString`,
`getNumber`, `getBoolean`) e o unico caminho: ninguem le a tabela direto nem
repete a conversao. Pedir `getNumber` de uma chave STRING falha alto - e erro de
programacao, nao entrada do usuario.

**Sem cache, por decisao.** Cada leitura vai ao banco. A tabela tem poucas
linhas, nenhum modulo a consulta em caminho quente ainda, e um cache em memoria
traria um contrato de invalidacao sem beneficio atual - com mais de uma
instancia, cada uma teria a sua copia e um `PATCH` so atualizaria a que o
atendeu. Enquanto for consulta direta, `GET` e `PATCH` nunca divergem. Quando a
leitura for frequente o bastante, o cache entra em `SystemSettingsService` - e
so ali -, invalidado pelo `SettingsService.update`.

**Auditoria.** Toda alteracao efetiva grava `SYSTEM_SETTING_UPDATED` no modulo
`SETTINGS`, com a chave na descricao e em `metadados` - **nunca** o valor
anterior nem o novo. Hoje nenhuma configuracao guarda segredo, e a regra vale de
antemao para que nunca passe a guardar por descuido. Consulta nao audita, valor
recusado nao audita, e reenviar o mesmo valor responde 200 sem gravar nem
auditar (mesmo criterio do financeiro e de usuarios). A auditoria e
**best-effort**: falhar ao grava-la nao desfaz a alteracao.

**Estado desta etapa.** As chaves do catalogo sao armazenadas e administraveis,
mas **ainda nao sao lidas por nenhum modulo** - as listagens continuam com o seu
proprio `DEFAULT_PAGE_SIZE` e o nome do sistema continua fixo no frontend. Ligar
uma configuracao ao comportamento de um modulo muda o comportamento desse modulo
e e uma decisao a parte, feita junto com ele.

## Notificacoes internas

Avisos destinados a UM usuario, lidos por ele na tela `/notifications`.

**Internas de verdade.** Nao ha e-mail, push, WhatsApp, Telegram, WebSocket nem
SSE nesta etapa - a notificacao nasce dentro do sistema e e lida dentro do
sistema. Nenhuma integracao externa foi criada, e nenhum disparador de negocio
foi inventado para ocupar espaco.

| Rota                              | Acesso      | O que faz |
| --------------------------------- | ----------- | --------- |
| `GET /notifications`              | autenticado | Pagina das notificacoes do proprio usuario |
| `GET /notifications/unread-count` | autenticado | `COUNT` das nao lidas do proprio usuario |
| `GET /notifications/:id`          | autenticado | Uma notificacao do proprio usuario |
| `PATCH /notifications/:id/read`   | autenticado | Marca uma como lida (idempotente) |
| `PATCH /notifications/read-all`   | autenticado | Marca todas as nao lidas como lidas (idempotente) |

**Sem permissao granular nova.** Ver as proprias notificacoes nao e privilegio
administrativo: o recorte por dono ja limita o que cada um alcanca, como em
`GET /auth/me` e `GET /dashboard/summary`. Nenhuma permissao foi acrescentada ao
catalogo.

**Isolamento por usuario.** O destinatario vem SEMPRE do JWT (`@CurrentUser()`).
Nao existe `usuarioId` em corpo, query ou rota - os dois `PATCH` declaram corpo
vazio (`EmptyBodyDto`) justamente para que o `ValidationPipe` global recuse com
400 qualquer campo enviado, inclusive uma tentativa de informar o destinatario.
No repositorio, TODA consulta leva o `usuarioId` junto: nao ha metodo que leia
ou altere notificacao sem dizer de quem ela e.

Consultar notificacao alheia responde **404**, e nao 403: um 403 confirmaria que
aquele id existe. De fora, id inexistente e id de outra pessoa sao
indistinguiveis - inclusive no corpo do erro.

**Marcar como lida e um UPDATE direcionado**, sem find -> mutate -> save:
`SET lida = 1, read_at = ?, updated_at = ? WHERE id = ? AND usuario_id = ? AND
lida = 0`, seguido de uma releitura filtrada pelo dono. O `lida = 0` torna a
operacao idempotente de verdade: `read_at` guarda o horario da PRIMEIRA leitura,
e requisicoes simultaneas nao se sobrescrevem. `read-all` segue a mesma regra.
A resposta traz `readAt`; `updatedAt` continua na resposta por compatibilidade.

**Criacao.** Nao ha `POST` nem `DELETE`. Quem cria e outro modulo do sistema,
pelo `NotificationsService.createForUser({ usuarioId, titulo, mensagem, tipo })`.
Como essa chamada NAO passa pelo `ValidationPipe`, o conteudo e validado e
normalizado por `notification.policy.ts` (funcao pura, como
`entry-status.policy.ts` e `setting-value.ts`). Nenhum modulo a chama ainda.

**Ordenacao e paginacao.** `lida ASC, created_at DESC, id DESC`: nao lidas
primeiro, depois da mais recente para a mais antiga, com o id desempatando
(varias notificacoes podem cair no mesmo instante). Como `false` grava 0 e
`true` grava 1 nos tres drivers, "nao lidas primeiro" vale em qualquer banco. A
paginacao e a mesma de `/users`, `/audit-logs` e `/finance/entries` - com um
campo a mais, `totalPages`, calculado no backend.

**Desempenho.** Uma consulta por pagina (`findAndCount` traz linhas e total
juntos) e uma por contador (`COUNT`). `ix_notif_dest` (`usuario_id`, `lida`,
`created_at`) serve as duas: a listagem usa o indice inteiro e o contador usa o
prefixo. Marcar todas como lidas e UM `UPDATE`, nao uma gravacao por linha.

**Auditoria: este modulo NAO grava na trilha, de proposito.**

- consultas nunca sao auditadas neste projeto - mesmo criterio que tirou o
  `FINANCE_QUERIED` do financeiro;
- marcar como lida e estado de leitura do proprio dono, sem efeito sobre dado de
  negocio, dinheiro, acesso ou configuracao. Auditar isso geraria um evento por
  usuario e por notificacao, justamente o ruido que dificultaria achar o que
  importa na trilha;
- a criacao tambem nao e auditada aqui: quem cria uma notificacao e um modulo de
  negocio, que ja registra o SEU evento (o pagamento, a mudanca de perfil). Um
  segundo registro descreveria o aviso, nao o fato.

Nenhuma acao de auditoria nova foi criada. Se a politica da empresa exigir
rastrear a leitura, o ponto de mudanca e `markAsRead`/`markAllAsRead`, com o
`AuditService` que ja existe - sem mecanismo paralelo. Ha teste e2e travando a
decisao atual: se alguem acrescentar auditoria aqui, ele falha e a mudanca vira
deliberada.

**Frontend.** `/notifications` (apenas autenticacao) e um contador no menu,
alimentado por `GET /notifications/unread-count` atraves do
`NotificationsContext` - uma consulta so, compartilhada pelo menu e pela tela.
O contador e relido quando a sessao muda e depois de cada acao de marcar como
lida; **nao ha polling nem atualizacao automatica**. Falha ao le-lo deixa o
contador em zero sem derrubar a navegacao. Tipo e estado (lida/nao lida)
aparecem sempre escritos - a cor nunca e a unica pista.

## Perfil do proprio usuario

Os dados pessoais de quem esta autenticado, em `/profile`. Nao ha tabela nova:
o perfil E o registro em `users`.

| Rota             | Acesso      | O que faz |
| ---------------- | ----------- | --------- |
| `GET /profile`   | autenticado | Devolve o perfil de quem esta autenticado |
| `PATCH /profile` | autenticado | Altera os dados pessoais - hoje, so o nome |

**Sem permissao granular.** Nenhuma `profile:read` ou `profile:update` foi
criada: ver e editar os PROPRIOS dados nao e privilegio administrativo, e o
recorte "so o proprio" ja e absoluto. Mesmo criterio de `/auth/me`,
`/dashboard/summary` e `/notifications`.

**A identidade vem do JWT.** Nao existe parametro de usuario em lugar nenhum
deste caminho - nem na rota, nem na query, nem no corpo. O alvo e sempre o
`@CurrentUser()`, o mesmo mecanismo de `/auth/me`. Nao ha, portanto, "perfil de
outra pessoa" a que chegar: nao e uma checagem que pode falhar, e a ausencia de
um caminho.

| Campo | No perfil |
| ----- | --------- |
| `nome` | **editavel** |
| `email` | somente leitura - trocar exige um fluxo de confirmacao que nao existe |
| `role` | somente leitura - `PATCH /users/:id/role`, com regra de hierarquia |
| `ativo` | somente leitura - `PATCH /users/:id/status` |
| `id`, `createdAt`, `updatedAt` | somente leitura - ninguem os altera |
| senha | fora do escopo desta etapa: nao ha fluxo de troca |
| permissoes | nao aparecem: vem do perfil, e `/auth/me` ja as entrega |

O `UpdateProfileDto` tem UM campo e **nao herda** de `UpdateUserDto` (o
administrativo, que aceita `email`): herdar e remover campo depois e o tipo de
heranca que deixa um campo entrar de volta em silencio quando o DTO de origem
cresce. Como o `ValidationPipe` global roda com `forbidNonWhitelisted`, enviar
`role`, `ativo`, `id`, `userId`, `usuarioId`, `senha`, `email` ou `permissions`
resulta em **400** - RECUSADO pelo contrato, nunca ignorado em silencio.

**Gravacao direcionada, nao `save(entity)`.** O `PATCH` emite
`UPDATE users SET nome = ?, updated_at = ? WHERE id = ?` e nada mais. A
diferenca e de seguranca: o `save` de uma entity carregada compara-a com a
linha atual e reescreve TODA coluna que diferir, entao uma desativacao, um
rebaixamento de perfil ou uma troca de e-mail feitos entre a leitura e a
gravacao voltariam atras - o usuario se reativaria, ou recuperaria um perfil
recem-revogado. Com o UPDATE direcionado, `ativo`, `role_id`, `senha_hash` e
`email` nao aparecem no comando e uma alteracao administrativa concorrente
sobrevive. Ha testes de integracao que aplicam a alteracao administrativa
exatamente no instante da gravacao e conferem o resultado direto no banco.

O `PATCH` tambem nao faz leitura propria: o `JwtAuthGuard` ja releu o usuario
do banco nesta requisicao, e a existencia da conta e conferida pelo numero de
linhas que o UPDATE alcanca (zero -> 404).

> O mesmo padrao load-mutate-save continua em `UserManagementService.update`
> (`PATCH /users/:id`), que nao foi alterado nesta etapa. Ali o caminho exige
> `users:update` e a regra de hierarquia, mas a janela de reversao existe e
> merece tratamento proprio.

**Nao reusa `UserManagementService.update`**, por duas razoes concretas: aquele
metodo aplica a regra de hierarquia (`canManageUser`), que recusa alguem com o
MESMO perfil - ou seja, recusaria todo mundo editando a si mesmo -, e aceita
`email`. O `ProfileService` vive no `UsersModule` porque grava na tabela
`users`, e o projeto mantem as escritas dessa tabela dentro desse modulo (foi
por isso que o `UserDirectoryModule` nasceu como fronteira somente leitura).

**Contrato proprio, separado de `/auth/me`.** Em `/auth/me` o que importa e o
material de autorizacao, inclusive a lista de permissoes; em `/profile`, os
dados pessoais. `/auth/me` nao foi alterado.

**Auditoria.** A alteracao reusa `USER_UPDATED` no modulo `USERS` - nenhuma
acao nova foi criada, porque a existente ja significa exatamente "os dados de
um usuario mudaram". O que distingue a edicao do proprio perfil de uma edicao
administrativa e `usuarioId === metadados.alvoId`.

Os metadados guardam so os NOMES dos campos alterados (`{ alvoId, campos:
['nome'] }`), nunca os valores - mesmo criterio de `FINANCE_ENTRY_UPDATED`. A
descricao e `Perfil proprio atualizado`, **sem o e-mail**: quem executou ja esta
em `usuarioId`, e a tela de auditoria resolve o nome a partir dele. Isso difere
das descricoes dos demais modulos, que trazem o e-mail do ator; a diferenca e
deliberada, para nao duplicar dado pessoal na trilha.

`GET /profile` nao audita. Alteracao sem efeito (corpo vazio, ou o mesmo nome)
responde 200 sem gravar e sem auditar. A auditoria e **best-effort**: falhar ao
grava-la nao desfaz a alteracao.

**Frontend.** `/profile` e "Meu perfil" no menu, para todo usuario autenticado.
O formulario tem um unico campo - o nome; e-mail, perfil, situacao e data de
cadastro aparecem em bloco de leitura, sem campo de edicao. Depois de salvar, a
sessao e relida (`refreshUser`) para o nome acompanhar no resto da aplicacao,
sem recarregar a pagina.

## Integracoes externas: foundation

`backend/src/modules/integrations/` define COMO uma integracao externa entra no
sistema. A foundation em si nao faz chamada externa e nao instala SDK; a unica
integracao real construida sobre ela e o Telegram (secao "Canal Telegram").
WhatsApp, Plantae, NFS-e e e-mail nao tem provider. Sem entity, tabela,
migration, rota HTTP ou permissao nova.

Decisao da Etapa 5 (em aberto em `integrations/README.md`): o codigo das
integracoes vive em `backend/src/modules/integrations/` como modulo Nest, e nao
num npm workspace separado.

```
modulo de negocio  ->  interface de capacidade (ex.: "enviar mensagem")
                              |
                   IntegrationProvider (adapter)  ->  servico externo
                              |
                   IntegrationRegistry (identidade, estado, health)
```

- **Contrato** (`IntegrationProvider`): `metadata` (id, nome, categoria),
  `getStatus()` e `healthCheck()`. Pequeno de proposito: o que cada integracao
  FAZ fica numa interface propria dela, definida quando ela existir. Nao ha
  campo de credencial no contrato.
- **Estados** (`IntegrationStatus`): `DISABLED`, `NOT_CONFIGURED`, `READY`,
  `ERROR`. Decididos localmente, sem rede.
- **Health check**: reutiliza `HealthIndicatorResult` (`ok`/`degraded`/`down`)
  do `HealthModule` - nenhum vocabulario paralelo. So roda com a integracao em
  `READY`; nos demais estados o registro nem chama o provider.
- **Registro** (`IntegrationRegistry`): mesmo arranjo do `CommandCatalog`.
  Identificador unico (duplicidade derruba o boot), `find`, `all` ordenado por
  id, `status` e `healthCheck`. Registrar e listar nao executam nada do provider.
  Falha de um provider vira `ERROR`/`down` sem afetar os demais.
- **Configuracao**: `hasConfigValues(config, chaves)` diz se as chaves tem valor,
  lendo pelo `ConfigService`, e devolve so um booleano. Nenhuma variavel de
  integracao foi criada; o `.env.example` continua so reservando os prefixos.
- **Sem segredo na saida**: tudo o que o registro devolve e uma copia com campos
  escolhidos (id, nome, categoria, estado, `status`/`detail` do health). O
  `detail` do provider e descartado: o registro expoe uma mensagem fixa por
  estado (`disponivel`, `disponivel com restricoes`, `indisponivel`, ou
  `verificacao falhou` quando o health check lanca excecao). O log de
  falha registra so o NOME do erro - a mensagem de um cliente HTTP pode trazer a
  URL, e a URL pode trazer o token.

**Regra de dependencia.** O `IntegrationsModule` nao importa nenhum modulo, e um
teste de arquitetura falha se algum arquivo dele importar algo fora do Nest e do
tipo de health. Uma integracao futura e um modulo proprio que importa este e
registra o seu provider no `onModuleInit`; o registro nunca conhece o provider.
Nenhum modulo de negocio depende da foundation ainda.

**Fora do `/health` por enquanto.** Expor o estado das integracoes no endpoint
publico sera decidido quando o primeiro provider real existir; o ponto de
extensao (`HEALTH_INDICATORS`) ja esta la.

## Plantae: escopo pedido e pendencia externa

> **PENDENCIA EXTERNA: documentacao/metodo oficial de integracao do Plantae
> ainda nao fornecido.** Enquanto isso valer, nao existe provider, nao existe
> configuracao e nao existe nenhuma porta de dominio para o Plantae no codigo.

O Plantae esta **previsto** na arquitetura: ele entra pela foundation acima, como
qualquer integracao, sem nada de novo a inventar. Quando a documentacao e os
acessos chegarem, o caminho e o mesmo que o Telegram percorreu - um modulo
proprio com um `IntegrationProvider`, registrado no `onModuleInit`.

**Por que nenhum codigo foi escrito ainda.** Um provider de Plantae hoje seria
`getStatus()` devolvendo `NOT_CONFIGURED` fixo (nao se sabe quais chaves de
configuracao existem) e um `healthCheck()` inalcancavel (o registro so o chama
em `READY`). Portas de dominio exigiriam inventar os tipos de "fornecedor",
"extrato" e "lancamento" do Plantae - o modelo de dados de um sistema que ainda
nao vimos. Seria codigo que *parece* funcionar e e descartado no primeiro
contato real, o criterio que `integrations/README.md` ja fixou. Nada no sistema
consome o `IntegrationRegistry` fora dos testes, entao um provider parado
tambem nao seria visivel a ninguem.

**Capacidades pedidas pelo cliente.** Registradas aqui para nao se perderem; a
viabilidade de cada uma depende do que o Plantae oferecer.

| Capacidade | Natureza | Depende de |
| ---------- | -------- | ---------- |
| Consultar contas, pagamentos, fornecedores, clientes, lancamentos, extratos e movimentacoes | leitura | existir API de leitura e cobrir essas entidades |
| Gerar relatorios | leitura + agregacao no VastaFlow | os dados de leitura acima |
| Exportar para Excel | so VastaFlow | nada do Plantae: e formatacao local dos dados ja obtidos |
| Conferir Plantae x extratos bancarios | leitura dos dois lados | API do Plantae **e** origem do extrato bancario (OFX? CSV? API do banco?) - a segunda nao foi definida |
| Identificar diferencas e pendencias | regra no VastaFlow | a conferencia acima |
| Incluir/alterar informacoes no Plantae | escrita | existir API de escrita, e o cliente autorizar escrita automatica |

Observacoes que valem independente da API:

- **Exportacao para Excel e relatorios nao dependem do Plantae** para existirem.
  Podem ser construidos sobre o financeiro que ja esta no sistema, e depois
  passar a incluir dados do Plantae. Sao escopo proprio, nao desta pendencia.
- **A conferencia com extratos bancarios tem uma segunda pendencia**, separada
  do Plantae: de onde vem o extrato do banco. Sem isso definido, metade da
  comparacao nao tem fonte.
- **Escrita no Plantae e decisao de negocio, nao so tecnica.** Toda operacao que
  altere dados la passara pelo `AuditService` existente, com RBAC e usuario
  autenticado - sem mecanismo paralelo de autenticacao e sem credencial em log
  ou em resposta, como nas demais integracoes.

**O que falta saber para escrever a primeira linha de codigo.**

1. Existe API? Se sim, de que tipo - REST, SOAP, GraphQL? Se nao, qual o meio
   suportado (exportacao de arquivo, acesso ao banco, ETL)?
2. Autenticacao: API key, OAuth2, usuario e senha, certificado? Onde a
   credencial e emitida e com que validade?
3. Ambientes: existe homologacao separada de producao? Com quais dados?
4. Entidades e campos realmente disponiveis para leitura, entre os sete pedidos.
5. Existe API de escrita? Quais operacoes, e com que regras de idempotencia?
6. Limites: throttling, paginacao, volume maximo, janela de manutencao.
7. Versionamento e politica de mudanca de contrato.
8. Para a conferencia bancaria: origem e formato do extrato do banco.

Nenhum desses pontos pode ser suposto. Qualquer valor inventado aqui viraria
variavel de ambiente, tipo e teste - tres lugares para corrigir depois, com a
aparencia de integracao pronta no meio do caminho.

## Canal Telegram

Primeira integracao externa real: `backend/src/modules/integrations/telegram/`.
O Telegram e so um canal - o Command Engine recebe o `CommandContext` de sempre
e nao sabe de onde a mensagem veio (o canal e o rotulo `CommandChannel.Telegram`,
o unico acrescimo ao motor).

```
getUpdates -> TelegramAdapter -> IncomingMessage (neutra)
           -> ChannelLinkConfirmer: "/vincular <codigo>"? -> confirma posse e responde (fim)
           -> ChannelIdentityResolver -> usuario interno | null
           -> CommandContext -> CommandRouter -> CommandResult
           -> texto -> sendMessage
```

| Peca | Papel |
| ---- | ----- |
| `TelegramApiClient` | Unico ponto de rede. `getMe`, `getUpdates`, `sendMessage` da Bot API oficial, `fetch` nativo, timeout explicito, erros em categorias fixas |
| `toIncomingMessage` | Reduz o update a `IncomingMessage` (canal, conversa, remetente, texto, data). So texto, so remetente humano, so conversa 1:1 (regra abaixo) |
| `ChannelIdentityResolver` | Identidade externa -> usuario interno. Implementado por `DatabaseIdentityResolver` (secao "Vinculo de identidade externa") |
| `TelegramAdapter` | Oferece a mensagem ao `ChannelLinkConfirmer`; se nao for confirmacao, monta o `CommandContext`, chama o `CommandRouter` e responde com o `reply` do motor. So conhece contratos - nenhum banco |
| `TelegramPollingService` | Long polling opt-in, um por processo, backoff 1s-60s, shutdown limpo |
| `TelegramProvider` | `IntegrationProvider` da foundation: `NOT_CONFIGURED`/`READY` sem rede; health via `getMe` |

**Identidade externa, sem vinculo automatico.** O id do remetente no Telegram
e uma identidade EXTERNA e nunca vira usuario interno por convencao: so um
vinculo administrativo persistido faz essa passagem (secao "Vinculo de
identidade externa"). Sem vinculo, o adapter responde apenas que a conta nao
esta vinculada - nenhum comando e executado, nenhum perfil e presumido e o RBAC
nunca e avaliado para quem o sistema nao conhece. O resolvedor recebe so
`{ channel, externalId }`: texto e payload nao escolhem o usuario.

**Regra arquitetural temporaria: so conversa 1:1.** O mapper aceita apenas chat
privado cujo id e o do proprio remetente; grupo, supergrupo e canal ficam fora
do fluxo, sem resposta. Isto NAO e uma decisao de produto - essa decisao ainda
nao foi tomada. E uma limitacao tecnica do modelo atual:

1. o RBAC do Command Engine autoriza quem pede (`context.user`), mas num grupo a
   resposta chega a todos os membros, inclusive a quem nao tem a permissao
   exigida - nao existe autorizacao da audiencia;
2. o `CommandContext` tem um so `conversationId` (destino) e um so `user`, o que
   so e coerente quando os dois sao a mesma pessoa;
3. em grupo o Telegram costuma enviar `/ajuda@NomeDoBot`, que o parser atual
   classifica como malformado;
4. sem vinculo, o bot responderia "nao vinculado" a cada mensagem do grupo.

Suportar grupos exige decidir antes: quem pode usar o bot num grupo, se a
resposta vai ao grupo ou ao privado de quem pediu, e como tratar
`/comando@bot`. Ate la, a regra fica.

**Recebimento por long polling, sem webhook.** Webhook exigiria URL publica,
certificado e uma rota aberta na aplicacao. O polling roda em qualquer maquina
e nao abre rota nenhuma. E opt-in: so inicia com `TELEGRAM_POLLING_ENABLED=true`
e `TELEGRAM_BOT_TOKEN` preenchido - o Telegram recusa dois `getUpdates`
simultaneos, entao so UM ambiente por bot deve liga-lo. O boot nunca depende do
Telegram. O `offset` avanca antes de processar cada update (um update que quebre
nao volta sem fim); updates processados e ainda nao confirmados podem ser
reentregues depois de um reinicio.

**Configuracao.** `TELEGRAM_BOT_TOKEN` (opcional; sem ele a integracao fica
`NOT_CONFIGURED`) e `TELEGRAM_POLLING_ENABLED` (padrao `false`), validados em
`env.validation.ts`. Os e2e forcam os dois vazios/falsos em `setup-env.ts`.

**Token.** A URL da Bot API carrega o token (`/bot<token>/metodo`), entao a URL
e tratada como segredo: o cliente descarta o erro original do `fetch` (nem como
`cause`), nao repassa o `description` do Telegram e nao registra log. Os logs do
canal levam so desfecho e categoria de falha - nunca token, URL, texto da
mensagem, id do remetente ou a resposta.

**Resposta.** O texto e o `reply` do proprio motor para todo desfecho (sucesso,
desconhecido, sem permissao, nao-comando, falha do handler); o adapter so aplica
o limite de 4096 caracteres e envia sem `parse_mode`. Sem auditoria por mensagem
e sem comando novo.

## Vinculo de identidade externa

`backend/src/modules/external-identities/`. Liga uma conta EXTERNA (hoje, do
Telegram) a um usuario interno - mas so depois que a propria conta PROVA A POSSE.

**Solicitacao pendente x vinculo ativo.** Sao duas coisas diferentes:

| | Solicitacao (`identity_link_requests`) | Vinculo ativo (`external_identity_links`) |
| - | - | - |
| Criada por | API interna, por quem administra o usuario | Confirmacao enviada pela propria conta externa |
| Contem | usuario-alvo, canal, HASH do codigo, estado, validade | canal, id externo, usuario |
| Autentica alguem? | Nao | Sim - resolvido para o usuario a cada mensagem |
| Id externo | NAO tem: quem inicia nao escolhe a conta | Vem do REMETENTE da confirmacao |

**Fluxo.**

```
1. POST /users/:id/external-identities/link-requests  { "canal": "telegram" }
      -> solicitacao PENDENTE, codigo de uso unico (XXXX-XXXX-XXXX), valido 15 min
      -> o codigo so aparece nesta resposta; no banco fica o SHA-256
2. A pessoa envia ao bot, pela PROPRIA conta, em conversa privada: /vincular <codigo>
3. TelegramAdapter -> ChannelLinkConfirmer (antes da identidade e do motor)
      -> parseCommand (o parser do Command Engine) -> exatamente 1 argumento
      -> hash do codigo -> solicitacao PENDENTE, nao vencida, usuario ativo
      -> transacao: UPDATE ... WHERE status = 'PENDENTE' (so uma confirmacao "toma")
                    + INSERT do vinculo (canal, id do REMETENTE, usuario da solicitacao)
4. Proxima mensagem: externalId -> vinculo -> usuario atual -> CommandRouter
```

**O Telegram nunca escolhe o usuario interno.** O usuario vem da solicitacao; a
identidade externa vem do remetente. `/vincular 123 <userId>` (argumentos a
mais), `userId`/`role` no payload ou um id no lugar do codigo sao ignorados ou
recusados. A confirmacao roda antes do Command Engine porque quem confirma ainda
nao tem usuario - e o motor exige um; ela reusa o parser do motor e nao cria
comando novo no catalogo.

**Codigo.** 60 bits de `randomBytes` (alfabeto Crockford base32), gravado so
como SHA-256 (hash rapido basta: o codigo e aleatorio, nao ha dicionario).
Validade de 15 minutos, uso unico, nunca em log, auditoria nem mensagem de erro.
Codigo inexistente, expirado, ja usado, cancelado, mal formado ou de usuario
inativo recebem a MESMA resposta neutra. Nao ha limite de tentativas (rate
limiting ficou fora desta etapa): a protecao contra adivinhacao e a entropia
com a validade curta.

**Concorrencia - o banco decide.**

- `ux_link_req_codigo`: hash do codigo unico;
- `ux_link_req_pendente` sobre `pendente_chave` (`usuario_id:canal` enquanto
  pendente, nula depois): no maximo UMA pendente por usuario e canal - dois
  administradores ao mesmo tempo: um 201, um 409. Nulos nao colidem em indice
  unico no MySQL nem no Oracle; isso substitui o indice parcial, que nao e
  portavel;
- a confirmacao e uma transacao: o UPDATE condicionado ao estado PENDENTE deixa
  passar uma so; o INSERT colide em `ux_ext_ident_canal_id` se a conta ja tiver
  vinculo, e ai TUDO e desfeito - a solicitacao continua pendente e nada e
  reassociado. A resposta diz so que a conta ja esta vinculada, sem revelar a quem.

Nos testes (SQLite em memoria, uma conexao) duas transacoes simultaneas se
anulam: as duas confirmacoes falham e nada e gravado - seguro, mas nao mostra
"uma passa". A exclusividade e provada sequencialmente; a concorrencia real so
um MySQL/Oracle demonstra.

**Rotas.**

| Rota | Permissao | O que faz |
| ---- | --------- | --------- |
| `GET /users/:id/external-identities` | `users:read` | Vinculos ATIVOS |
| `DELETE /users/:id/external-identities/:linkId` | `users:update` | Remove um vinculo ativo (204) |
| `GET /users/:id/external-identities/link-requests` | `users:read` | Solicitacoes pendentes (sem codigo) |
| `POST /users/:id/external-identities/link-requests` | `users:update` | Inicia: `{ "canal": "telegram" }` -> codigo + instrucao |
| `DELETE /users/:id/external-identities/link-requests/:requestId` | `users:update` | Cancela a pendente (204); o codigo deixa de valer |

Mesma hierarquia da edicao de usuarios (`canManageUser`); o proprio usuario pode
iniciar a sua. Nenhuma permissao nova. Nao existe mais rota que aceite um id
externo: a unica forma de criar vinculo e a confirmacao pela propria conta.

**Interface.** A administracao fica no detalhe do usuario (`/users/:id`), na
secao "Vinculos externos": vinculos ativos e solicitacoes pendentes, com as
acoes de vincular, cancelar e remover. As acoes aparecem pela mesma capacidade
do botao Editar (`userCapabilities(...).edit`), que ja reflete `users:update`
mais a hierarquia - nenhuma permissao nova no frontend. O codigo e exibido uma
unica vez, em dialogo, e vive apenas em estado React: nao vai para
`localStorage`, `sessionStorage`, URL, historico nem log. Nao ha polling; o
vinculo confirmado aparece na proxima consulta.

**Vinculo ativo nao contem permissoes.** So `canal`, `id_externo`, `usuario_id`
e datas. Quem entra pelo canal age com o perfil ATUAL do usuario (relido a cada
mensagem pela mesma regra do `JwtAuthGuard`). **Usuario inativo perde o acesso**
na mensagem seguinte, sem precisar remover o vinculo; tambem nao recebe
solicitacao nova nem confirma uma pendente. Remover o vinculo vale na mensagem
seguinte (sem cache).

**Auditoria** (modulo `USERS`; codigo, hash e mensagens nunca entram):
`IDENTITY_LINK_REQUESTED` (`alvoId`, `solicitacaoId`, `canal`, `expiraEm`),
`IDENTITY_LINK_CANCELLED` (`alvoId`, `solicitacaoId`),
`EXTERNAL_IDENTITY_LINKED` (feito pelo proprio usuario, via conta externa:
`alvoId`, `solicitacaoId`, `vinculoId`, `canal`, `idExterno`) e
`EXTERNAL_IDENTITY_UNLINKED`. Tentativas recusadas nao sao auditadas. Toda acao
cabe na coluna `acao` (30 caracteres) - ha teste para isso.

**Grupos continuam fora** (regra 1:1 do canal Telegram), inclusive para `/vincular`.

## Hardening de producao

Ajustes feitos para que a aplicacao possa rodar exposta na internet. Nenhum
depende de infraestrutura: sao decisoes de codigo, validadas por teste.

### Cadastro publico fechado em producao

`POST /auth/register` cria conta sem autenticacao alguma. Num sistema interno,
isso significaria que qualquer pessoa na internet poderia criar um usuario - e o
caminho correto ja existe: um administrador cria a conta pelo modulo de
usuarios, com perfil e permissoes definidos.

Em producao a rota responde **404**, com a mesma mensagem que o Nest daria para
uma rota inexistente (`Cannot POST /auth/register`). Fora de producao nada muda.

Tres decisoes merecem registro:

- **404 e nao 403**, para seguir o criterio que o projeto ja usa em
  `commands/non-production.guard.ts`: rota indisponivel em producao se comporta
  como rota que nao existe. Os dois guards fazem a mesma coisa e poderiam ser um
  so; unifica-los exige mexer no Command Engine e ficou para depois.
- **Guard, e nao checagem no service**, porque guard roda antes do
  `ValidationPipe`: a recusa e identica para corpo valido ou invalido, entao a
  resposta nao revela o formato esperado.
- **Sem variavel de ambiente propria.** A decisao vem so do `NODE_ENV`. Uma
  variavel seria mais uma coisa a configurar errado, e errar aqui reabriria o
  cadastro na internet - sem variavel, nao ha como reabrir por engano.

### Swagger nunca em producao

`SWAGGER_ENABLED` tinha padrao `true`: esquecer a variavel expunha toda a
superficie da API, incluindo os schemas de entrada. Agora sao duas camadas:

1. **Padrao `false`** em qualquer ambiente - a documentacao e opt-in explicito.
   O `.env.example` traz `true`, entao o ambiente de desenvolvimento segue com
   `/docs` disponivel.
2. **`SWAGGER_ENABLED=true` em producao e recusado no boot**, pela mesma regra
   cruzada que ja proibia `DATABASE_SYNCHRONIZE=true`. A aplicacao nao sobe, em
   vez de subir com a documentacao aberta.

Alem disso, o `main.ts` nao monta a documentacao em producao em hipotese alguma.
Tres barreiras para um erro cujo custo e expor a API inteira.

### IP real atras do proxy reverso

A arquitetura de producao poe um proxy reverso na frente do Node. Sem
configuracao, `request.ip` devolveria o endereco do proxy, e toda a trilha de
auditoria registraria o mesmo IP.

O Express e configurado com `trust proxy = 1`: confia em **um** salto, que e a
topologia prevista. Deliberadamente um numero, e nao `true` - com `true` o
Express confiaria na cadeia inteira de `X-Forwarded-For`, e qualquer cliente
poderia inventar o proprio IP escrevendo o header, justamente num campo que vai
para a auditoria.

Com cadeia (`198.51.100.1, 203.0.113.9`), o valor usado e o **ultimo** - o que o
proxy confiavel acrescentou. Os anteriores vem do cliente e sao ignorados.

Isto pressupoe que o processo nunca recebe conexao direta da internet. Se um dia
for exposto sem proxy, o valor tem de voltar a zero, senao o IP auditado passa a
ser falsificavel.

### Limite de corpo da requisicao

Limite global de **100 kB**, igual ao padrao do Express, agora explicito: as
rotas atuais trocam JSON pequeno (o maior campo do sistema tem 500 caracteres).
Explicitar protege de uma mudanca de padrao do framework e deixa o limite
visivel para quem opera.

Corpo acima do limite responde **413**. Antes virava **500**: o erro do
`body-parser` nao e uma `HttpException`, entao o filtro global o tratava como
falha do servidor - o cliente nao distinguia "mandei corpo grande demais" de "o
servidor quebrou", e cada tentativa gerava um `incidentId` e um stack trace no
log, um incidente falso para o que e pedido invalido. O filtro agora reconhece
especificamente `entity.too.large`; qualquer outro erro desconhecido segue sendo
500.

Este **nao** e o limite de upload de documento. Quando a fundacao de arquivos
existir, ela tera regra propria, e este valor global nao deve ser aumentado para
acomoda-la.

### TLS na conexao com o MySQL

`DATABASE_SSL=true` liga TLS com verificacao do certificado do servidor.
`DATABASE_SSL_CA` recebe o **conteudo** do certificado em PEM, nao um caminho -
evita depender do filesystem (a aplicacao nao le arquivo em nenhum outro ponto)
e funciona direto com gerenciadores de segredo. Vazio, usa o pacote de CAs que o
proprio `mysql2` embarca para bancos gerenciados, o que dispensa certificado no
repositorio.

Em producao com MySQL, `DATABASE_SSL=true` e **obrigatorio**: a validacao de
ambiente recusa o boot sem ele.

Nao existe variavel para desligar a verificacao do certificado. Cifrar sem
verificar a identidade do servidor protege contra escuta passiva e nao contra um
intermediario ativo, que e o ataque que importa.

Nao se aplica ao Oracle, onde o TLS e configurado na string de conexao do proprio
driver. **A montagem da opcao e coberta por teste de unidade; nenhuma conexao
TLS real foi estabelecida** - nao ha servidor MySQL com TLS disponivel.

### Liveness e readiness

Duas perguntas diferentes, dois endpoints:

| Rota | Pergunta | Verifica | Resposta quando falha |
| ---- | -------- | -------- | --------------------- |
| `GET /health` | o processo esta vivo? | nada | sempre 200 enquanto o processo responde |
| `GET /health/readiness` | consegue trabalhar? | banco (`SELECT 1`, 2 s) | **503** |

Separados de proposito: liveness decide reiniciar, readiness decide mandar
trafego. Juntar as duas faria uma queda do banco derrubar tambem o liveness, e o
processo seria reiniciado sem motivo - reiniciar nao conserta banco fora do ar.

O readiness verifica **somente** o que impede a aplicacao de funcionar. Integracao
externa nao entra: uma indisponibilidade de fornecedor nao deve tirar o VastaFlow
do ar.

`SELECT 1` nao le tabela e nao depende de migration aplicada - responde
exatamente "a conexao serve?". O detalhe da resposta e uma de duas frases fixas;
a mensagem do erro original nunca e repassada, porque erros de driver costumam
trazer host, usuario e as vezes a string de conexao inteira.

O 503 e escrito direto na resposta em vez de lancar excecao: o filtro global
trata 5xx como falha do servidor e substituiria o corpo por "Erro interno do
servidor" com `incidentId`, registrando stack trace a cada consulta da sonda.
Readiness negativo e resposta esperada, nao incidente.

### Rate limiting: responsabilidade do proxy, nao da aplicacao

`POST /auth/login` nao tem limite de tentativas, e **isso nao foi resolvido no
codigo**. A decisao foi deliberada:

- o proxy reverso previsto para producao faz limite por IP com uma diretiva de
  configuracao, sem dependencia nova e sem estado na aplicacao;
- implementar tambem na aplicacao criaria duas camadas com limites proprios, e
  um `429` viria de um lugar diferente conforme o caso;
- a alternativa que o proxy **nao** cobre - bloqueio por conta apos N tentativas
  - exige estado persistente. Em memoria nao sobrevive a restart nem a uma
  segunda instancia; em banco exige migration. E um bloqueio por conta tambem
  cria um jeito de trancar a conta de um usuario legitimo de proposito.

O que ja existe hoje e **deteccao, nao prevencao**: toda tentativa recusada gera
`LOGIN_FAILED` na trilha de auditoria, com IP - e o IP so e confiavel por causa
do `trust proxy` descrito acima.

**Requisito obrigatorio da configuracao do proxy reverso:** limite de taxa em
`POST /auth/login`. Enquanto nao existir, nao ha protecao contra forca bruta.

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
