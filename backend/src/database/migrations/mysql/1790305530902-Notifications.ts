import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notificacoes internas - MYSQL.
 *
 * Gerada por `migration:generate` contra um MySQL 8.4 real e validada nele:
 * `migration:run`, `migration:revert` e novo `migration:run`, com `schema:log`
 * sem divergencias em relacao as entities.
 *
 * `lida` e `tinyint` (o tipo que o MySQL usa para booleano) com padrao 0: toda
 * notificacao nasce por ler.
 *
 * `ix_notif_dest` e o unico indice alem da chave primaria, e cobre as duas
 * consultas da tela: a pagina do usuario (`usuario_id`, `lida`, `created_at`)
 * e o `COUNT` de nao lidas, que usa so o prefixo. A busca individual ja e
 * servida pela PK - nenhum indice especulativo foi criado.
 *
 * `usuario_id` nao tem chave estrangeira, pelo mesmo motivo de
 * `audit_logs.usuario_id`, `financial_entries.criado_por_id` e
 * `system_settings.atualizado_por_id`.
 */
export class Notifications1790305530902 implements MigrationInterface {
  name = 'Notifications1790305530902';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`notifications\` (\`id\` varchar(36) NOT NULL, \`usuario_id\` varchar(36) NOT NULL, \`titulo\` varchar(120) NOT NULL, \`mensagem\` varchar(500) NOT NULL, \`tipo\` varchar(10) NOT NULL, \`lida\` tinyint NOT NULL DEFAULT 0, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`ix_notif_dest\` (\`usuario_id\`, \`lida\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ix_notif_dest\` ON \`notifications\``);
    await queryRunner.query(`DROP TABLE \`notifications\``);
  }
}
