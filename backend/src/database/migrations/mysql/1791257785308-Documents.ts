import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documentos - MYSQL.
 *
 * Gerada por `migration:generate` contra um MySQL 8.4 real e validada nele:
 * `migration:run`, `migration:revert` e novo `migration:run`, com `schema:log`
 * sem divergencias em relacao as entities.
 *
 * O CONTEUDO dos arquivos nao esta aqui: os bytes vivem no storage, atras da
 * `StoragePort`. Esta tabela guarda somente metadados.
 *
 * `tamanho` e `decimal(20,0)` e nao `bigint`: o driver Oracle do TypeORM recusa
 * `bigint`, e `decimal` existe nos dois bancos. Inteiro exato, nunca ponto
 * flutuante - escala zero, porque byte nao tem fracao.
 *
 * `storage_key` e UNIQUE para que duas linhas nunca apontem para o mesmo objeto
 * fisico; sem isso, uma remocao futura apagaria o conteudo de outro documento.
 *
 * `ix_doc_created` existe porque a listagem ordena por `created_at`. NAO ha
 * indice em `criado_por_id`: nenhuma consulta desta fase filtra por autor, e
 * indice sem consulta e custo de escrita sem retorno.
 *
 * `criado_por_id` nao tem chave estrangeira, pelo mesmo motivo de
 * `financial_entries.criado_por_id` e `audit_logs.usuario_id`: o documento nao
 * depende do cadastro de usuarios para continuar valido.
 */
export class Documents1791257785308 implements MigrationInterface {
  name = 'Documents1791257785308';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`documents\` (\`id\` varchar(36) NOT NULL, \`nome\` varchar(255) NOT NULL, \`nome_original\` varchar(255) NOT NULL, \`mime_type\` varchar(100) NOT NULL, \`tamanho\` decimal(20,0) NOT NULL, \`storage_key\` varchar(120) NOT NULL, \`criado_por_id\` varchar(36) NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`ux_doc_storage_key\` (\`storage_key\`), INDEX \`ix_doc_created\` (\`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`ix_doc_created\` ON \`documents\``);
    await queryRunner.query(`DROP INDEX \`ux_doc_storage_key\` ON \`documents\``);
    await queryRunner.query(`DROP TABLE \`documents\``);
  }
}
