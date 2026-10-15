import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emissoes de NFS-e (maquina de estados + idempotencia) - MYSQL.
 *
 * Aditiva: so cria a tabela. Os indices UNICOS sao a defesa contra duplicidade: `ux_nfse_dps_id` e
 * `ux_nfse_numero` impedem duas DPS com o mesmo identificador/numero (por ambiente: o `Id` da DPS
 * nao traz o ambiente), `ux_nfse_confirm` faz o
 * codigo de confirmacao ser de uso unico e `ux_nfse_chave` impede a mesma NFS-e em dois pedidos.
 * Sem chave estrangeira (mesmo criterio das tabelas de eventos dos canais).
 */
export class NfseEmissions1791700000000 implements MigrationInterface {
  name = 'NfseEmissions1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`nfse_emissions\` (\`id\` varchar(36) NOT NULL, \`usuario_id\` varchar(36) NOT NULL, \`canal\` varchar(20) NOT NULL, \`status\` varchar(30) NOT NULL, \`ambiente\` int NOT NULL, \`serie\` varchar(5) NOT NULL, \`numero_dps\` int NOT NULL, \`dps_id\` varchar(45) NOT NULL, \`dados\` text NOT NULL, \`resumo_hash\` varchar(64) NOT NULL, \`confirm_hash\` varchar(64) NULL, \`confirm_expires_at\` datetime(6) NULL, \`confirmado_em\` datetime(6) NULL, \`tentativas\` int NOT NULL DEFAULT 0, \`ultima_tentativa_em\` datetime(6) NULL, \`chave_acesso\` varchar(50) NULL, \`nfse_xml\` text NULL, \`erro_codigo\` varchar(40) NULL, \`erro_mensagem\` varchar(300) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`ux_nfse_dps_id\` (\`ambiente\`, \`dps_id\`), UNIQUE INDEX \`ux_nfse_numero\` (\`ambiente\`, \`serie\`, \`numero_dps\`), UNIQUE INDEX \`ux_nfse_confirm\` (\`confirm_hash\`), UNIQUE INDEX \`ux_nfse_chave\` (\`chave_acesso\`), INDEX \`ix_nfse_usuario\` (\`usuario_id\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ix_nfse_usuario\` ON \`nfse_emissions\``);
    await queryRunner.query(`DROP INDEX \`ux_nfse_chave\` ON \`nfse_emissions\``);
    await queryRunner.query(`DROP INDEX \`ux_nfse_confirm\` ON \`nfse_emissions\``);
    await queryRunner.query(`DROP INDEX \`ux_nfse_numero\` ON \`nfse_emissions\``);
    await queryRunner.query(`DROP INDEX \`ux_nfse_dps_id\` ON \`nfse_emissions\``);
    await queryRunner.query(`DROP TABLE \`nfse_emissions\``);
  }
}
