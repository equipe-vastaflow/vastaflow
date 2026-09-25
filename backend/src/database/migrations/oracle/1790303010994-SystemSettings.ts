import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Configuracoes do sistema - ORACLE.
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
 * vira `varchar2` e `datetime(6)` vira `timestamp`. Nao ha JSON nativo em jogo:
 * `valor` e texto nos dois bancos, e o `tipo` diz como interpreta-lo.
 */
export class SystemSettings1790303010994 implements MigrationInterface {
  name = 'SystemSettings1790303010994';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "system_settings" ("id" varchar2(36), "chave" varchar2(60) NOT NULL, "valor" varchar2(500) NOT NULL, "descricao" varchar2(255) NOT NULL, "tipo" varchar2(10) NOT NULL, "atualizado_por_id" varchar2(36), "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_82521f08790d248b2a80cc85d40" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_settings_chave" ON "system_settings" ("chave")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ux_settings_chave"`);
    await queryRunner.query(`DROP TABLE "system_settings"`);
  }
}
