import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Momento da leitura das notificacoes (`read_at`) - MYSQL.
 *
 * Gerada pelo mesmo caminho interno do `migration:generate` (`QueryRunner` em
 * modo SQL-em-memoria, a partir da entity), porque nao ha MySQL disponivel
 * nesta maquina agora.
 *
 * ATENCAO: ainda NAO executada em MySQL real. Valide com `migration:run`,
 * `migration:revert` e `schema:log` antes de publicar (ver database/README.md).
 *
 * `read_at` e nulo enquanto a notificacao nao foi lida, e gravado uma unica
 * vez pelo UPDATE direcionado que a marca como lida.
 *
 * Preenchimento das ja lidas: ate aqui a UNICA escrita possivel numa
 * notificacao era marca-la como lida (ela e imutavel depois de criada), entao
 * `updated_at` e exatamente o momento da leitura. Sem isso, uma notificacao
 * lida ficaria com `read_at` nulo.
 *
 * Nenhum indice novo: nenhuma consulta filtra ou ordena por `read_at`.
 */
export class NotificationsReadAt1790706805546 implements MigrationInterface {
  name = 'NotificationsReadAt1790706805546';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`notifications\` ADD \`read_at\` datetime(6) NULL`);
    // `updated_at = updated_at` explicito: sem ele, o `ON UPDATE CURRENT_TIMESTAMP(6)`
    // da coluna trocaria `updated_at` pelo horario desta migration.
    await queryRunner.query(
      `UPDATE \`notifications\` SET \`read_at\` = \`updated_at\`, \`updated_at\` = \`updated_at\` WHERE \`lida\` = 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`notifications\` DROP COLUMN \`read_at\``);
  }
}
