import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eventos de mensagem do Telegram recebidos pelo backend (idempotencia) - MYSQL.
 *
 * Escrita a partir da entity `TelegramInboundEvent`, no mesmo formato das demais
 * migrations MySQL do projeto.
 *
 * `ux_tg_evt_bot_update` (UNIQUE em `canal`, `bot_id`, `update_id`) e a garantia
 * de que uma mensagem executa um comando UMA vez, inclusive sob corrida entre
 * duas entregas. `ix_tg_evt_created` serve a retencao futura (apagar o antigo).
 *
 * `update_id` e `decimal(20,0)` e nao `bigint`, pelo mesmo motivo de
 * `documents.tamanho`: o driver Oracle recusa `bigint`, e `decimal` existe nos
 * dois bancos. Sem texto de mensagem, sem resposta e sem chave estrangeira.
 */
export class TelegramInboundEvents1791500000000 implements MigrationInterface {
  name = 'TelegramInboundEvents1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`telegram_inbound_events\` (\`id\` varchar(36) NOT NULL, \`canal\` varchar(20) NOT NULL, \`bot_id\` varchar(20) NOT NULL, \`update_id\` decimal(20,0) NOT NULL, \`status\` varchar(20) NOT NULL, \`resultado\` varchar(30) NULL, \`usuario_id\` varchar(36) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`ix_tg_evt_created\` (\`created_at\`), UNIQUE INDEX \`ux_tg_evt_bot_update\` (\`canal\`, \`bot_id\`, \`update_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ux_tg_evt_bot_update\` ON \`telegram_inbound_events\``);
    await queryRunner.query(`DROP INDEX \`ix_tg_evt_created\` ON \`telegram_inbound_events\``);
    await queryRunner.query(`DROP TABLE \`telegram_inbound_events\``);
  }
}
