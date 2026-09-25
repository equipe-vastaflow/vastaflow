import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Configuracoes do sistema - MYSQL.
 *
 * Gerada por `migration:generate` contra um MySQL 8.4 real e validada nele:
 * `migration:run`, `migration:revert` e novo `migration:run`, com `schema:log`
 * sem divergencias em relacao as entities.
 *
 * `valor` e `varchar(500)`, nunca JSON nativo: o tipo do conteudo vem da coluna
 * `tipo`, e o DDL fica igual nos dois bancos. Nao ha coluna de segredo - esta
 * tabela nao guarda senha, token nem credencial.
 *
 * `chave` tem indice UNICO (`ux_settings_chave`): e o identificador publico da
 * configuracao, usado na URL.
 *
 * `atualizado_por_id` nao tem chave estrangeira, pelo mesmo motivo de
 * `audit_logs.usuario_id` e `financial_entries.criado_por_id`: a configuracao
 * nao depende do cadastro de usuarios para continuar valida.
 */
export class SystemSettings1790303010994 implements MigrationInterface {
  name = 'SystemSettings1790303010994';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`system_settings\` (\`id\` varchar(36) NOT NULL, \`chave\` varchar(60) NOT NULL, \`valor\` varchar(500) NOT NULL, \`descricao\` varchar(255) NOT NULL, \`tipo\` varchar(10) NOT NULL, \`atualizado_por_id\` varchar(36) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`ux_settings_chave\` (\`chave\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ux_settings_chave\` ON \`system_settings\``);
    await queryRunner.query(`DROP TABLE \`system_settings\``);
  }
}
