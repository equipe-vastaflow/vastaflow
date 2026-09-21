# ADR 0001 - Escolha do ORM e estrategia MySQL/Oracle

- **Status:** aceito
- **Data:** 2026-09-21
- **Decisores:** equipe VastaFlow

## Contexto

O VastaFlow precisa operar com **MySQL ou Oracle Database**, dependendo do
ambiente/projeto - nunca com os dois ao mesmo tempo. O briefing inicial sugeria
Prisma ORM, *desde que tecnicamente compativel* com essa estrategia.

## Alternativas avaliadas

### Prisma ORM - descartado

A documentacao oficial de bancos suportados, consultada em 21/09/2026, lista
para o Prisma ORM 8:

| Banco       | Status            |
| ----------- | ----------------- |
| PostgreSQL  | Release candidate |
| MongoDB     | Early access      |
| SQLite      | Experimental      |

MySQL aparece como "planned next"; MariaDB, SQL Server e CockroachDB como
"coming soon". **Oracle nao consta** - o Prisma nunca ofereceu conector Oracle.

O Prisma falha, portanto, nos dois bancos exigidos pelo projeto. A condicao
"caso seja tecnicamente compativel" nao se cumpre.

### TypeORM - escolhido

| Pacote             | Versao |
| ------------------ | ------ |
| `typeorm`          | 1.1.1  |
| `@nestjs/typeorm`  | 12.0.1 |
| `oracledb`         | 7.0.1  |
| `mysql2`           | 3.24.4 |

Motivos:

- Driver Oracle **oficial e documentado**, sobre o pacote `oracledb`.
- O `oracledb` opera em **thin mode por padrao**, ou seja, **nao exige instalar
  o Oracle Instant Client** na maquina do desenvolvedor. Decisivo no Windows.
- Aceita `sid` e `serviceName` na conexao - as duas formas pelas quais
  ambientes Oracle corporativos costumam ser expostos.
- MySQL pelo `mysql2`, maduro e amplamente usado.
- Integracao de primeira classe com NestJS, framework ja definido para o projeto.
- Projeto ativo (releases nightly diarias em setembro/2026).

### MikroORM - alternativa viavel, nao adotada

O MikroORM 7.2.1 tambem oferece driver Oracle (`@mikro-orm/oracledb`) e MySQL,
com um modelo de Unit of Work mais limpo. Nao foi adotado porque o suporte a
Oracle e mais recente e a integracao com NestJS tem menos rodagem em producao.
Continua sendo uma troca defensavel caso o TypeORM se mostre limitante.

## Decisao

Adotar **TypeORM**, com **MySQL como banco alvo do desenvolvimento inicial**, e
manter a arquitetura preparada para Oracle desde o comeco.

## Consequencias

### Nenhum ORM torna a troca de banco automatica

Trocar `type: 'mysql'` por `type: 'oracle'` **nao** basta. Diferencas reais:

| Aspecto            | MySQL                  | Oracle                                       |
| ------------------ | ---------------------- | -------------------------------------------- |
| Chave incremental  | `AUTO_INCREMENT`       | `IDENTITY` (12c+) ou sequence                 |
| Booleano           | `TINYINT(1)`/`BOOLEAN` | Nativo so no 23ai; antes disso `NUMBER(1)`    |
| String vazia       | `''` diferente de NULL | `''` **e igual a** `NULL`                     |
| Identificadores    | case-sensitive, 64 car.| uppercase, 128 car. (30 antes do 12.2)        |
| DDL das migrations | -                      | Incompativel com o do MySQL                   |

### Regras que passam a valer no codigo

1. **Migrations nao sao portaveis.** Manter pastas separadas:
   `src/database/migrations/mysql/` e `src/database/migrations/oracle/`.
2. **Zero SQL cru nos services.** Consulta especifica de banco fica no
   repositorio correspondente, nunca na regra de negocio.
3. **Tipos de coluna conservadores** nas entities, para reduzir divergencia.
4. **Nomes de tabela, coluna e indice curtos** (limite de 30 caracteres, o pior
   caso do Oracle), em minusculas e `snake_case`.
5. **Nunca depender de string vazia** para distinguir de `NULL`.
6. Fluxo obrigatorio: `Controller -> Service -> Repository -> Database`.

### Docker

O `docker-compose.yml` sobe **apenas MySQL**. Oracle **nao** foi containerizado:
as imagens oficiais exigem autenticacao no `container-registry.oracle.com` e
aceite de licenca, e as imagens comunitarias precisam de validacao juridica
antes de entrar no projeto. Decisao adiada ate haver instancia Oracle real.

## Pendencias

- Versao do Oracle usada pelo cliente (19c, 21c ou 23ai). Define se `BOOLEAN`
  nativo pode ser usado e qual o limite de identificadores.
- Acesso a uma instancia Oracle para validar a camada de persistencia. Ate la,
  o suporte a Oracle permanece **preparado, porem nao verificado**.
