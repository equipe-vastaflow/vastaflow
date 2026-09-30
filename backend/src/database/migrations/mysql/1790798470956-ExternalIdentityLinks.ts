import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vinculos de identidade externa (Telegram -> usuario interno) - MYSQL.
 *
 * Gerada pelo mesmo caminho interno do `migration:generate` (`QueryRunner` em
 * modo SQL-em-memoria, a partir da entity), porque nao ha MySQL disponivel
 * nesta maquina agora.
 *
 * ATENCAO: ainda NAO executada em MySQL real. Valide com `migration:run`,
 * `migration:revert` e `schema:log` antes de publicar (ver database/README.md).
 *
 * `ux_ext_ident_canal_id` (UNIQUE em `canal`, `id_externo`) e a garantia de que
 * uma conta externa pertence a um so usuario - inclusive sob corrida, que a
 * checagem previa da aplicacao nao cobre. `ix_ext_ident_usuario` atende a
 * listagem dos vinculos de um usuario.
 *
 * `usuario_id` sem chave estrangeira, pelo mesmo motivo de `audit_logs`,
 * `financial_entries`, `system_settings` e `notifications`.
 */
export class ExternalIdentityLinks1790798470956 implements MigrationInterface {
  name = 'ExternalIdentityLinks1790798470956';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`external_identity_links\` (\`id\` varchar(36) NOT NULL, \`canal\` varchar(20) NOT NULL, \`id_externo\` varchar(64) NOT NULL, \`usuario_id\` varchar(36) NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`ix_ext_ident_usuario\` (\`usuario_id\`), UNIQUE INDEX \`ux_ext_ident_canal_id\` (\`canal\`, \`id_externo\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ux_ext_ident_canal_id\` ON \`external_identity_links\``);
    await queryRunner.query(`DROP INDEX \`ix_ext_ident_usuario\` ON \`external_identity_links\``);
    await queryRunner.query(`DROP TABLE \`external_identity_links\``);
  }
}
