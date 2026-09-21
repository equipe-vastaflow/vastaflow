import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema inicial - ORACLE.
 *
 * Gerado a partir das entities pelo proprio TypeORM (`Table.create` +
 * `QueryRunner` em modo SQL-em-memoria, o mesmo caminho interno do
 * `migration:generate`), porque nao havia instancia Oracle disponivel para
 * rodar o `migration:generate` de verdade. A mesma tecnica, aplicada ao MySQL,
 * reproduziu comando a comando a migration gerada contra um MySQL 8.4 real.
 *
 * O `down` desfaz o `up` em ordem inversa: FKs, depois indices, depois tabelas.
 *
 * ATENCAO: este DDL NUNCA foi executado em um Oracle real. Valide-o numa
 * instancia de homologacao antes de qualquer uso (ver database/README.md).
 *
 * Identificadores ficam entre aspas e em minusculas: em ferramentas SQL use
 * "users", nao USERS.
 */
export class InitialSchema1790020288252 implements MigrationInterface {
  name = 'InitialSchema1790020288252';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" varchar2(36), "usuario_id" varchar2(36), "acao" varchar2(30) NOT NULL, "modulo" varchar2(30) NOT NULL, "descricao" varchar2(500) NOT NULL, "ip" varchar2(45), "metadados" clob, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "ix_audit_usuario" ON "audit_logs" ("usuario_id")`);
    await queryRunner.query(`CREATE INDEX "ix_audit_created" ON "audit_logs" ("created_at")`);
    await queryRunner.query(
      `CREATE TABLE "permissions" ("id" varchar2(36), "code" varchar2(64) NOT NULL, "descricao" varchar2(255) NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "UQ_8dad765629e83229da6feda1c1d" UNIQUE ("code"), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "role_permissions" ("role_id" varchar2(36) NOT NULL, "permission_id" varchar2(36) NOT NULL, CONSTRAINT "PK_25d24010f53bb80b78e412c9656" PRIMARY KEY ("role_id", "permission_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_178199805b901ccd220ab7740e" ON "role_permissions" ("role_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_17022daf3f885f7d35423e9971" ON "role_permissions" ("permission_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "roles" ("id" varchar2(36), "nome" varchar2(30) NOT NULL, "descricao" varchar2(255) NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, CONSTRAINT "UQ_894f1ce8f4cb35f97cb2b5e0f55" UNIQUE ("nome"), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" varchar2(36), "nome" varchar2(120) NOT NULL, "email" varchar2(254) NOT NULL, "senha_hash" varchar2(100) NOT NULL, "ativo" number DEFAULT 1 NOT NULL, "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, "role_id" varchar2(36) NOT NULL, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1" FOREIGN KEY ("role_id") REFERENCES "roles" ("id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1"`);
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_17022daf3f885f7d35423e9971e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_178199805b901ccd220ab7740ec"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP INDEX "IDX_17022daf3f885f7d35423e9971"`);
    await queryRunner.query(`DROP INDEX "IDX_178199805b901ccd220ab7740e"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP INDEX "ix_audit_created"`);
    await queryRunner.query(`DROP INDEX "ix_audit_usuario"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
