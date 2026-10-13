import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eventos de mensagem do Telegram recebidos pelo backend (idempotencia) - ORACLE.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md).
 *
 * Mesmo desenho da versao MySQL: UNIQUE em (`canal`, `bot_id`, `update_id`)
 * garante uma execucao por mensagem, inclusive sob corrida (o Oracle sinaliza
 * `ORA-00001`, que a aplicacao trata como entrega duplicada). `update_id` em
 * `number(20,0)`; sem chave estrangeira e sem conteudo de mensagem.
 */
export class TelegramInboundEvents1791500000000 implements MigrationInterface {
  name = 'TelegramInboundEvents1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "telegram_inbound_events" ("id" varchar2(36), "canal" varchar2(20) NOT NULL, "bot_id" varchar2(20) NOT NULL, "update_id" number(20,0) NOT NULL, "status" varchar2(20) NOT NULL, "resultado" varchar2(30), "usuario_id" varchar2(36), "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_tg_inbound_events_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_tg_evt_created" ON "telegram_inbound_events" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_tg_evt_bot_update" ON "telegram_inbound_events" ("canal", "bot_id", "update_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ux_tg_evt_bot_update"`);
    await queryRunner.query(`DROP INDEX "ix_tg_evt_created"`);
    await queryRunner.query(`DROP TABLE "telegram_inbound_events"`);
  }
}
