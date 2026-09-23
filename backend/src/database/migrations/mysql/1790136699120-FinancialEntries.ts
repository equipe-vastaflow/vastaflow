import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lancamentos financeiros - MYSQL.
 *
 * Gerada por `migration:generate` contra um MySQL 8.4 real e validada nele:
 * `migration:run`, `migration:revert` e novo `migration:run`, com `schema:log`
 * sem divergencias em relacao as entities.
 *
 * `valor` e `decimal(15,2)`: dinheiro nunca em ponto flutuante. `data` e `date`
 * (sem hora) - o dia do evento financeiro, distinto de `created_at`.
 *
 * `criado_por_id` nao tem chave estrangeira, pelo mesmo motivo de
 * `audit_logs.usuario_id`: o registro financeiro nao depende do cadastro de
 * usuarios para continuar valido.
 */
export class FinancialEntries1790136699120 implements MigrationInterface {
  name = 'FinancialEntries1790136699120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`financial_entries\` (\`id\` varchar(36) NOT NULL, \`tipo\` varchar(10) NOT NULL, \`descricao\` varchar(200) NOT NULL, \`valor\` decimal(15,2) NOT NULL, \`data\` date NOT NULL, \`categoria\` varchar(60) NOT NULL, \`status\` varchar(10) NOT NULL, \`observacao\` varchar(500) NULL, \`criado_por_id\` varchar(36) NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`ix_fin_data\` (\`data\`), INDEX \`ix_fin_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ix_fin_status\` ON \`financial_entries\``);
    await queryRunner.query(`DROP INDEX \`ix_fin_data\` ON \`financial_entries\``);
    await queryRunner.query(`DROP TABLE \`financial_entries\``);
  }
}
