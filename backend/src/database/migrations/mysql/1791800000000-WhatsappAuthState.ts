import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estado de autenticacao da sessao do WhatsApp (gateway Baileys) - MYSQL.
 *
 * ATENCAO - DADO SENSIVEL: quem le estas tabelas COM a chave de cifra controla a conta do WhatsApp (ler e enviar
 * mensagens). Por isso:
 * - `payload` guarda SO texto cifrado (AES-256-GCM, feito pelo gateway; a chave nunca fica no banco). Credenciais e chaves
 *   Signal nunca sao gravadas em claro;
 * - o BACKEND nao tem entity nem codigo que leia estas tabelas: so este DDL. Quem as usa e o `whatsapp-gateway`, com um
 *   usuario de banco restrito a elas (ver docs/whatsapp-gateway.md);
 * - estas tabelas ficam FORA do `mysqldump` de `scripts/backup.sh`: perder a sessao custa um novo pareamento por QR,
 *   enquanto um backup com a sessao ampliaria a superficie de ataque.
 *
 * `whatsapp_auth_state`: uma linha por item (`creds` ou um tipo de chave Signal + id), com chave primaria composta
 * (sessao, tipo, id). `whatsapp_auth_lock`: UMA linha por sessao com a "trava de instancia unica" (dono + validade,
 * relogio do proprio banco). Sem chave estrangeira entre elas.
 */
export class WhatsappAuthState1791800000000 implements MigrationInterface {
  name = 'WhatsappAuthState1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`whatsapp_auth_state\` (\`session_id\` varchar(64) NOT NULL, \`item_type\` varchar(64) NOT NULL, \`item_id\` varchar(255) NOT NULL, \`payload\` mediumblob NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`session_id\`, \`item_type\`, \`item_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`whatsapp_auth_lock\` (\`session_id\` varchar(64) NOT NULL, \`owner\` varchar(64) NOT NULL, \`lease_until\` datetime(6) NOT NULL, \`generation\` int NOT NULL DEFAULT 0, \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`session_id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`whatsapp_auth_lock\``);
    await queryRunner.query(`DROP TABLE \`whatsapp_auth_state\``);
  }
}
