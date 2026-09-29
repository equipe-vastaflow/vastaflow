import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Momento da leitura das notificacoes (`read_at`) - ORACLE.
 *
 * Gerada pelo mesmo caminho interno do `migration:generate` (`QueryRunner` em
 * modo SQL-em-memoria, a partir da entity), porque nao ha instancia Oracle.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md).
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
    await queryRunner.query(`ALTER TABLE "notifications" ADD "read_at" timestamp(6)`);
    await queryRunner.query(`UPDATE "notifications" SET "read_at" = "updated_at" WHERE "lida" = 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "read_at"`);
  }
}
