import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eventos de mensagem do WhatsApp recebidos pelo backend (idempotencia) - ORACLE.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa instancia de homologacao
 * antes de qualquer uso (ver database/README.md). Mesmo desenho da versao MySQL: UNIQUE em
 * (`phone_number_id`, `message_id`); o Oracle sinaliza `ORA-00001`, tratado como entrega duplicada.
 */
export class WhatsappInboundEvents1791600000000 implements MigrationInterface {
  name = 'WhatsappInboundEvents1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "whatsapp_inbound_events" ("id" varchar2(36), "phone_number_id" varchar2(20) NOT NULL, "message_id" varchar2(200) NOT NULL, "status" varchar2(20) NOT NULL, "resultado" varchar2(30), "usuario_id" varchar2(36), "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_wa_inbound_events_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_wa_evt_created" ON "whatsapp_inbound_events" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_wa_evt_msg" ON "whatsapp_inbound_events" ("phone_number_id", "message_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ux_wa_evt_msg"`);
    await queryRunner.query(`DROP INDEX "ix_wa_evt_created"`);
    await queryRunner.query(`DROP TABLE "whatsapp_inbound_events"`);
  }
}
