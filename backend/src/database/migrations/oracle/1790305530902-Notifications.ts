import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notificacoes internas - ORACLE.
 *
 * Gerada a partir da entity pelo proprio TypeORM (`Table.create` +
 * `QueryRunner` em modo SQL-em-memoria, o mesmo caminho interno do
 * `migration:generate`), porque nao ha instancia Oracle disponivel. A mesma
 * tecnica, aplicada ao MySQL, reproduziu comando a comando a migration gerada
 * contra um MySQL real.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md).
 *
 * Diferencas em relacao ao MySQL, resolvidas pelo proprio driver: `varchar`
 * vira `varchar2`, `datetime(6)` vira `timestamp` e o booleano `lida` vira
 * `number` com 1/0 (o Oracle so tem BOOLEAN a partir do 23ai). Como `false`
 * grava 0 nos dois bancos, ordenar por `lida` ascendente coloca as nao lidas
 * primeiro em qualquer um deles.
 */
export class Notifications1790305530902 implements MigrationInterface {
  name = 'Notifications1790305530902';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" varchar2(36), "usuario_id" varchar2(36) NOT NULL, "titulo" varchar2(120) NOT NULL, "mensagem" varchar2(500) NOT NULL, "tipo" varchar2(10) NOT NULL, "lida" number DEFAULT 0 NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_notif_dest" ON "notifications" ("usuario_id", "lida", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_notif_dest"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
