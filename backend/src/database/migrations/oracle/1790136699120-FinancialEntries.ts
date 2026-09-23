import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lancamentos financeiros - ORACLE.
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
 * Diferencas em relacao ao MySQL, resolvidas pelo proprio driver:
 * `decimal(15,2)` vira `number(15,2)` e `datetime(6)` vira `timestamp`. O tipo
 * `date` existe nos dois e o TypeORM entrega a data como `YYYY-MM-DD` em ambos.
 */
export class FinancialEntries1790136699120 implements MigrationInterface {
  name = 'FinancialEntries1790136699120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "financial_entries" ("id" varchar2(36), "tipo" varchar2(10) NOT NULL, "descricao" varchar2(200) NOT NULL, "valor" number(15,2) NOT NULL, "data" date NOT NULL, "categoria" varchar2(60) NOT NULL, "status" varchar2(10) NOT NULL, "observacao" varchar2(500), "criado_por_id" varchar2(36) NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_61883ae069a9a2c228e3ecb0b6d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "ix_fin_data" ON "financial_entries" ("data")`);
    await queryRunner.query(`CREATE INDEX "ix_fin_status" ON "financial_entries" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_fin_status"`);
    await queryRunner.query(`DROP INDEX "ix_fin_data"`);
    await queryRunner.query(`DROP TABLE "financial_entries"`);
  }
}
