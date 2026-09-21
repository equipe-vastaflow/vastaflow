# Banco de dados

O VastaFlow opera com **MySQL ou Oracle** - um ou outro por ambiente, nunca os
dois simultaneamente. A escolha e feita pela variavel `DATABASE_TYPE`.

A decisao de ORM e as limitacoes de portabilidade entre os dois bancos estao em
[docs/adr/0001](../docs/adr/0001-escolha-do-orm-e-estrategia-de-banco.md).
**Leia antes de criar qualquer entity ou migration.**

## Estado atual

Conexao TypeORM e entities de usuarios, perfis, permissoes e auditoria ja
existem (`backend/src/database/` e `backend/src/modules/*/entities/`).

**Ainda nao ha migrations.** Em desenvolvimento o schema e criado por
`DATABASE_SYNCHRONIZE=true`, que a validacao de ambiente proibe em producao.
Antes de ir para producao e preciso gerar as migrations de cada banco, em
`backend/src/database/migrations/{mysql,oracle}/` (ver ADR 0001).

As entities foram exercitadas apenas em testes com SQLite em memoria;
**a conexao e o schema nao foram validados contra um MySQL real**. O caminho
Oracle permanece preparado, porem nao verificado.

## Conteudo desta pasta

| Pasta         | Uso                                                            |
| ------------- | -------------------------------------------------------------- |
| `mysql/init/` | Scripts executados na criacao do container MySQL de desenvolvimento |
| `oracle/`     | Notas e scripts de Oracle (ver pendencias abaixo)                |

As **migrations** nao ficam aqui: elas pertencem ao backend, em
`backend/src/database/migrations/{mysql,oracle}/`, porque sao geradas e
aplicadas pelo CLI do TypeORM.

## Regra: nunca versionar dados reais

Nao commitar dump, export, planilha ou script contendo dados reais da Vasta,
credenciais ou senhas. Scripts de seed devem usar apenas dados ficticios.

## Docker

O `docker-compose.yml` na raiz sobe **apenas MySQL**.

**Oracle nao foi containerizado.** As imagens oficiais exigem autenticacao no
`container-registry.oracle.com` e aceite de licenca; imagens comunitarias
precisam de validacao juridica antes de entrar no projeto. A decisao fica
pendente ate existir uma instancia Oracle real para o projeto.

## Pendencias

- Versao do Oracle do cliente (19c, 21c ou 23ai) - define se `BOOLEAN` nativo
  pode ser usado e o limite de tamanho dos identificadores.
- Forma de conexao exposta pelo DBA: `SID` ou `SERVICE_NAME`.
- Instancia de homologacao para validar a camada Oracle. Enquanto nao houver,
  o suporte a Oracle permanece **preparado, porem nao verificado**.
