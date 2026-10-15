import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emissoes de NFS-e (maquina de estados + idempotencia) - ORACLE.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa instancia de homologacao
 * antes de qualquer uso (ver database/README.md). Mesmo desenho da versao MySQL; os indices UNICOS
 * sao a defesa contra duplicidade (`ORA-00001`). `text` do MySQL = `clob`.
 */
export class NfseEmissions1791700000000 implements MigrationInterface {
  name = 'NfseEmissions1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "nfse_emissions" ("id" varchar2(36), "usuario_id" varchar2(36) NOT NULL, "canal" varchar2(20) NOT NULL, "status" varchar2(30) NOT NULL, "ambiente" number(10) NOT NULL, "serie" varchar2(5) NOT NULL, "numero_dps" number(10) NOT NULL, "dps_id" varchar2(45) NOT NULL, "dados" clob NOT NULL, "resumo_hash" varchar2(64) NOT NULL, "confirm_hash" varchar2(64), "confirm_expires_at" timestamp(6), "confirmado_em" timestamp(6), "tentativas" number(10) DEFAULT 0 NOT NULL, "ultima_tentativa_em" timestamp(6), "chave_acesso" varchar2(50), "nfse_xml" clob, "erro_codigo" varchar2(40), "erro_mensagem" varchar2(300), "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_nfse_emissions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_nfse_dps_id" ON "nfse_emissions" ("ambiente", "dps_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_nfse_numero" ON "nfse_emissions" ("ambiente", "serie", "numero_dps")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_nfse_confirm" ON "nfse_emissions" ("confirm_hash")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_nfse_chave" ON "nfse_emissions" ("chave_acesso")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_nfse_usuario" ON "nfse_emissions" ("usuario_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_nfse_usuario"`);
    await queryRunner.query(`DROP INDEX "ux_nfse_chave"`);
    await queryRunner.query(`DROP INDEX "ux_nfse_confirm"`);
    await queryRunner.query(`DROP INDEX "ux_nfse_numero"`);
    await queryRunner.query(`DROP INDEX "ux_nfse_dps_id"`);
    await queryRunner.query(`DROP TABLE "nfse_emissions"`);
  }
}
