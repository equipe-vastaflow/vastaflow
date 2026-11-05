import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estado de autenticacao da sessao do WhatsApp (gateway Baileys) - ORACLE.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real, e o gateway so implementa o acesso a MySQL. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md). Mesmo desenho e mesmos cuidados da versao
 * MySQL: `payload` so tem texto cifrado pelo gateway, o backend nao le estas tabelas e elas ficam fora do backup.
 */
export class WhatsappAuthState1791800000000 implements MigrationInterface {
  name = 'WhatsappAuthState1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "whatsapp_auth_state" ("session_id" varchar2(64) NOT NULL, "item_type" varchar2(64) NOT NULL, "item_id" varchar2(255) NOT NULL, "payload" blob NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_wa_auth_state" PRIMARY KEY ("session_id", "item_type", "item_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "whatsapp_auth_lock" ("session_id" varchar2(64) NOT NULL, "owner" varchar2(64) NOT NULL, "lease_until" timestamp NOT NULL, "generation" number(10) DEFAULT 0 NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_wa_auth_lock" PRIMARY KEY ("session_id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "whatsapp_auth_lock"`);
    await queryRunner.query(`DROP TABLE "whatsapp_auth_state"`);
  }
}
