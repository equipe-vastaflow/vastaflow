import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eventos de mensagem do WhatsApp recebidos pelo backend (idempotencia) - MYSQL.
 *
 * `ux_wa_evt_msg` (UNIQUE em `phone_number_id`, `message_id`) garante que um `wamid` executa um
 * comando UMA vez, mesmo com a Meta reentregando o webhook. `message_id` e texto (o `wamid` nao e
 * numerico). Sem texto de mensagem, sem telefone, sem chave estrangeira.
 */
export class WhatsappInboundEvents1791600000000 implements MigrationInterface {
  name = 'WhatsappInboundEvents1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`whatsapp_inbound_events\` (\`id\` varchar(36) NOT NULL, \`phone_number_id\` varchar(20) NOT NULL, \`message_id\` varchar(200) NOT NULL, \`status\` varchar(20) NOT NULL, \`resultado\` varchar(30) NULL, \`usuario_id\` varchar(36) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`ix_wa_evt_created\` (\`created_at\`), UNIQUE INDEX \`ux_wa_evt_msg\` (\`phone_number_id\`, \`message_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ux_wa_evt_msg\` ON \`whatsapp_inbound_events\``);
    await queryRunner.query(`DROP INDEX \`ix_wa_evt_created\` ON \`whatsapp_inbound_events\``);
    await queryRunner.query(`DROP TABLE \`whatsapp_inbound_events\``);
  }
}
