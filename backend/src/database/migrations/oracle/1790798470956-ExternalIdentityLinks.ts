import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vinculos de identidade externa (Telegram -> usuario interno) - ORACLE.
 *
 * Gerada pelo mesmo caminho interno do `migration:generate` (`QueryRunner` em
 * modo SQL-em-memoria, a partir da entity), porque nao ha instancia Oracle.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md).
 *
 * Mesmo desenho da versao MySQL: UNIQUE em (`canal`, `id_externo`) garante uma
 * conta externa por usuario, inclusive sob corrida (o Oracle sinaliza
 * `ORA-00001`, traduzido pela aplicacao em 409); indice em `usuario_id` para a
 * listagem. Sem chave estrangeira.
 */
export class ExternalIdentityLinks1790798470956 implements MigrationInterface {
  name = 'ExternalIdentityLinks1790798470956';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "external_identity_links" ("id" varchar2(36), "canal" varchar2(20) NOT NULL, "id_externo" varchar2(64) NOT NULL, "usuario_id" varchar2(36) NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_0f90cd994f3344005a0050f1b55" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_ext_ident_usuario" ON "external_identity_links" ("usuario_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_ext_ident_canal_id" ON "external_identity_links" ("canal", "id_externo")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ux_ext_ident_canal_id"`);
    await queryRunner.query(`DROP INDEX "ix_ext_ident_usuario"`);
    await queryRunner.query(`DROP TABLE "external_identity_links"`);
  }
}
