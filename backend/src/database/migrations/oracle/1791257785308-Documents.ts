import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documentos - ORACLE.
 *
 * Traduzida da migration MySQL de mesmo timestamp, com os tipos conferidos
 * contra o PROPRIO driver Oracle do TypeORM (`normalizeType` /
 * `supportedDataTypes` sobre a entity), porque nao ha instancia Oracle
 * disponivel.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md).
 *
 * Diferencas em relacao ao MySQL, todas resolvidas pelo mapeamento do driver:
 * `varchar` vira `varchar2`, `decimal(20,0)` vira `number(20,0)` e
 * `datetime(6)` vira `timestamp`.
 *
 * Cuidado registrado: `varchar2(n)` conta BYTES por padrao, enquanto
 * `varchar(n)` do MySQL conta CARACTERES. E por isso que o nome do arquivo e
 * validado por BYTES na aplicacao (`NAME_MAX_BYTES`, mesmo criterio de
 * `PASSWORD_MAX_BYTES`): sem isso, um nome de 255 caracteres acentuados caberia
 * no MySQL e estouraria aqui.
 *
 * Nomes de tabela e indice dentro do limite de 30 caracteres do Oracle:
 * `documents` (9), `ux_doc_storage_key` (18), `ix_doc_created` (14).
 */
export class Documents1791257785308 implements MigrationInterface {
  name = 'Documents1791257785308';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "documents" ("id" varchar2(36), "nome" varchar2(255) NOT NULL, "nome_original" varchar2(255) NOT NULL, "mime_type" varchar2(100) NOT NULL, "tamanho" number(20,0) NOT NULL, "storage_key" varchar2(120) NOT NULL, "criado_por_id" varchar2(36) NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "UQ_doc_storage_key" UNIQUE ("storage_key"), CONSTRAINT "PK_documents_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "ix_doc_created" ON "documents" ("created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_doc_created"`);
    await queryRunner.query(`DROP TABLE "documents"`);
  }
}
