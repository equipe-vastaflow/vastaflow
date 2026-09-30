import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Solicitacoes de vinculo de identidade externa - MYSQL.
 *
 * Gerada pelo mesmo caminho interno do `migration:generate` (`QueryRunner` em
 * modo SQL-em-memoria, a partir da entity), porque nao ha MySQL disponivel
 * nesta maquina agora.
 *
 * ATENCAO: ainda NAO executada em MySQL real. Valide com `migration:run`,
 * `migration:revert` e `schema:log` antes de publicar (ver database/README.md).
 *
 * - `ux_link_req_codigo`: o hash do codigo e unico (busca da confirmacao);
 * - `ux_link_req_pendente`: no maximo UMA solicitacao pendente por usuario e
 *   canal. `pendente_chave` e nula fora do estado pendente, e o MySQL aceita
 *   varios nulos num indice unico;
 * - `ix_link_req_usuario`: listagem por usuario.
 *
 * O codigo em si nunca e gravado. Sem chave estrangeira, como as demais
 * referencias a usuario.
 */
export class IdentityLinkRequests1790799667076 implements MigrationInterface {
  name = 'IdentityLinkRequests1790799667076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`identity_link_requests\` (\`id\` varchar(36) NOT NULL, \`canal\` varchar(20) NOT NULL, \`usuario_id\` varchar(36) NOT NULL, \`codigo_hash\` varchar(64) NOT NULL, \`status\` varchar(12) NOT NULL, \`pendente_chave\` varchar(60) NULL, \`expira_em\` datetime(6) NOT NULL, \`criado_por_id\` varchar(36) NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`ix_link_req_usuario\` (\`usuario_id\`), UNIQUE INDEX \`ux_link_req_codigo\` (\`codigo_hash\`), UNIQUE INDEX \`ux_link_req_pendente\` (\`pendente_chave\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ux_link_req_pendente\` ON \`identity_link_requests\``);
    await queryRunner.query(`DROP INDEX \`ux_link_req_codigo\` ON \`identity_link_requests\``);
    await queryRunner.query(`DROP INDEX \`ix_link_req_usuario\` ON \`identity_link_requests\``);
    await queryRunner.query(`DROP TABLE \`identity_link_requests\``);
  }
}
