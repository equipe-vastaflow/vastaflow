# Banco de dados

O VastaFlow opera com **MySQL ou Oracle** - um ou outro por ambiente, nunca os
dois simultaneamente. A escolha e feita pela variavel `DATABASE_TYPE`.

A decisao de ORM e as limitacoes de portabilidade entre os dois bancos estao em
[docs/adr/0001](../docs/adr/0001-escolha-do-orm-e-estrategia-de-banco.md).
**Leia antes de criar qualquer entity ou migration.**

## Estado atual

| Item | MySQL | Oracle |
| ---- | ----- | ------ |
| Metadata das entities | Verificada por teste automatizado | Verificada por teste automatizado |
| Migration inicial | Gerada **contra MySQL 8.4 real** | Gerada pelo TypeORM **sem banco** (ver abaixo) |
| Migration executada em banco real | **Sim**: run, revert, run | **Nao** |
| Aplicacao rodando contra o banco | **Sim**: seed, login, RBAC, auditoria | **Nao** |
| `docker-compose.yml` (desenvolvimento) | **Nunca executado**. O `docker-compose.production.yml` foi validado em 2026-10-08 (ver `docs/containerizacao.md`) | Nao ha container Oracle |

### Como o MySQL foi validado

A maquina de desenvolvimento nao tem Docker. A validacao usou um **MySQL 8.4
real, temporario**, baixado e iniciado pelo pacote `mysql-memory-server` fora do
projeto (nao e dependencia do VastaFlow). Contra ele:

1. `migration:generate` produziu a migration inicial a partir das entities;
2. `migration:run` -> `schema:log` sem divergencias;
3. `migration:revert` (so restou a tabela `migrations`) -> `migration:run` de novo;
4. a aplicacao subiu com `DATABASE_SYNCHRONIZE=false`: seed criou perfis e o
   administrador, login funcionou, `ativo` voltou como booleano, usuario inativo
   foi bloqueado, `metadados` gravados e lidos como JSON;
5. contra um banco sem migrations, a aplicacao recusou iniciar com mensagem
   clara, sem criar nenhuma tabela.

O `docker-compose.yml` usa a mesma versao (`mysql:8.4`), mas **ele proprio nao
foi executado**. Ao rodar pela primeira vez, confira que o container fica
`healthy` e repita os passos 2 a 4.

### Como a migration Oracle foi produzida

Sem instancia Oracle, `migration:generate` e impossivel (ele compara as entities
com um banco conectado). A migration Oracle foi gerada pelo **mesmo codigo
interno** que o `migration:generate` usa (`Table.create` + `QueryRunner` em modo
SQL-em-memoria, com o driver Oracle do TypeORM). Aplicada ao MySQL, a mesma
tecnica reproduziu **comando a comando** a migration gerada contra o banco real
- o que da confianca de que o DDL Oracle e o que o TypeORM geraria. **Nao prova
que o Oracle o aceita.** Isso so uma instancia real prova.

## Fluxo de migrations

Todos os comandos rodam em `backend/` e leem o `backend/.env`.

```bash
npm run migration:show     # o que ja rodou e o que falta
npm run migration:run      # executa as pendentes
npm run migration:revert   # desfaz a ultima
npm run schema:log         # SQL que faltaria para o banco bater com as entities
```

- A aplicacao **nao** executa migrations ao subir. Se houver alguma pendente, ela
  **recusa iniciar** e informa o comando. A checagem so le o banco: nao cria a
  tabela `migrations` nem nada mais (o usuario de producao pode nao ter DDL).
- As migrations ficam em `backend/src/database/migrations/{mysql,oracle}/` e sao
  registradas em `migrations/index.ts`. Lista explicita, nao glob.
- `DATABASE_SYNCHRONIZE=true` ignora as migrations e cria as tabelas direto das
  entities. So para prototipo descartavel; proibido em producao. **Nao misture**:
  num banco criado por synchronize, a migration inicial falha (tabelas ja existem).

## Mudando o schema (procedimento)

1. Altere a entity. Entity nova tambem entra em `backend/src/database/entities.ts`.
2. **MySQL**: com o banco em dia, gere e revise:
   ```bash
   npm run migration:generate -- src/database/migrations/mysql/<NomeDaMudanca>
   ```
3. **Oracle**: crie a migration equivalente, com o **mesmo nome e timestamp**,
   em `migrations/oracle/`. Hoje ela so pode ser escrita/gerada contra uma
   instancia Oracle - ver "Decisao pendente" abaixo.
4. Registre as duas em `migrations/index.ts`.
5. `npm test`. O teste `database-compatibility.spec.ts` falha se:
   - uma entity usar tipo nao suportado por um dos bancos (foi assim que o
     `boolean` do Oracle passou despercebido antes);
   - algum identificador passar de 30 caracteres (limite do Oracle < 12.2);
   - uma migration usar sintaxe do outro banco, ou o `down` nao desfizer o `up`;
   - MySQL e Oracle tiverem listas de migrations diferentes;
   - um arquivo de migration ou uma entity ficar fora dos indices.
6. Rode `npm run migration:run` e `npm run schema:log` (deve sair vazio).

Esses testes **nao** detectam uma migration que esqueceu uma coluna. Isso so o
`schema:log` contra um banco real detecta.

## Decisao pendente: gerar migrations Oracle incrementais

A migration inicial Oracle cria tudo do zero, entao pode ser derivada das
entities. As proximas (`ALTER TABLE ...`) precisam comparar com um schema Oracle
existente. Opcoes:

1. **Oracle Database Free em container** (gratuito para desenvolvimento, imagem
   oficial em `container-registry.oracle.com`, exige aceite de licenca). Permite
   `migration:generate` e testar de verdade. Exige Docker.
2. **Instancia de homologacao do cliente**, acessada pelo time.
3. Escrever o DDL Oracle a mao, espelhando o MySQL - o mais arriscado.

Enquanto nao houver decisao, **evite mudar o schema** ou aceite que a migration
Oracle fique sem validacao.

## Conteudo desta pasta

| Pasta         | Uso                                                            |
| ------------- | -------------------------------------------------------------- |
| `mysql/init/` | Scripts executados na criacao do container MySQL de desenvolvimento |
| `oracle/`     | Notas e scripts de Oracle (ver pendencias abaixo)                |

As **migrations** nao ficam aqui: elas pertencem ao backend, porque sao geradas
e aplicadas pelo CLI do TypeORM.

## Particularidades do Oracle nesta base

- `User.ativo` e `NUMBER` com 1/0 (o TypeORM converte para `true`/`false`).
  BOOLEAN nativo so existe a partir do 23ai.
- `AuditLog.metadados` e `CLOB` (JSON serializado pelo TypeORM). O tipo `json`
  nativo exigiria 21c+.
- Identificadores sao criados **entre aspas e em minusculas**. Em SQL manual use
  `SELECT * FROM "users"`, nao `USERS`.
- O Oracle nao tem `ON UPDATE CASCADE`; o TypeORM omite a clausula. Sem impacto:
  ids nunca sao alterados.
- `updated_at` nao tem `ON UPDATE` no Oracle; o TypeORM preenche o valor ao salvar.

## Regra: nunca versionar dados reais

Nao commitar dump, export, planilha ou script contendo dados reais da Vasta,
credenciais ou senhas. Scripts de seed devem usar apenas dados ficticios.

## Docker

O `docker-compose.yml` na raiz sobe **apenas MySQL** (desenvolvimento) e nunca foi
executado. O `docker-compose.production.yml` (nucleo web com MySQL em TLS) foi
executado e validado em Docker Desktop - ver `docs/containerizacao.md`.

**Oracle nao foi containerizado.** As imagens oficiais exigem autenticacao no
`container-registry.oracle.com` e aceite de licenca; imagens comunitarias
precisam de validacao juridica antes de entrar no projeto.

## Pendencias

- Versao do Oracle do cliente (19c, 21c ou 23ai) e forma de conexao (`SID` ou
  `SERVICE_NAME`).
- Instancia Oracle para executar a migration inicial pela primeira vez. Checklist:
  `migration:run` -> `schema:log` vazio -> `migration:revert` -> `migration:run`
  -> subir a aplicacao e fazer login.
- Executar o `docker-compose.yml` numa maquina com Docker.
