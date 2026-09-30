import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Solicitacoes de vinculo de identidade externa - ORACLE.
 *
 * Gerada pelo mesmo caminho interno do `migration:generate` (`QueryRunner` em
 * modo SQL-em-memoria, a partir da entity), porque nao ha instancia Oracle.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md).
 *
 * Mesmo desenho da versao MySQL. `ux_link_req_pendente` depende de o Oracle nao
 * indexar linhas cuja chave e toda nula: varias solicitacoes encerradas
 * (`pendente_chave` nula) nao colidem, e so uma pendente por usuario e canal
 * passa.
 */
export class IdentityLinkRequests1790799667076 implements MigrationInterface {
  name = 'IdentityLinkRequests1790799667076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "identity_link_requests" ("id" varchar2(36), "canal" varchar2(20) NOT NULL, "usuario_id" varchar2(36) NOT NULL, "codigo_hash" varchar2(64) NOT NULL, "status" varchar2(12) NOT NULL, "pendente_chave" varchar2(60), "expira_em" timestamp(6) NOT NULL, "criado_por_id" varchar2(36) NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_7457409ea96c4592c73368404ca" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_link_req_usuario" ON "identity_link_requests" ("usuario_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_link_req_codigo" ON "identity_link_requests" ("codigo_hash")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_link_req_pendente" ON "identity_link_requests" ("pendente_chave")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ux_link_req_pendente"`);
    await queryRunner.query(`DROP INDEX "ux_link_req_codigo"`);
    await queryRunner.query(`DROP INDEX "ix_link_req_usuario"`);
    await queryRunner.query(`DROP TABLE "identity_link_requests"`);
  }
}
