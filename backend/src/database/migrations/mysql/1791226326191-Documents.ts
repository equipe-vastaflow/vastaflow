import { MigrationInterface, QueryRunner } from "typeorm";

export class Documents1791226326191 implements MigrationInterface {
    name = 'Documents1791226326191'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`documents\` (\`id\` varchar(36) NOT NULL, \`nome\` varchar(255) NOT NULL, \`nome_original\` varchar(255) NOT NULL, \`mime_type\` varchar(100) NOT NULL, \`tamanho\` bigint NOT NULL, \`storage_key\` varchar(120) NOT NULL, \`criado_por_id\` varchar(36) NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`ux_doc_storage_key\` (\`storage_key\`), INDEX \`ix_doc_created\` (\`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`ix_doc_created\` ON \`documents\``);
        await queryRunner.query(`DROP INDEX \`ux_doc_storage_key\` ON \`documents\``);
        await queryRunner.query(`DROP TABLE \`documents\``);
    }

}
