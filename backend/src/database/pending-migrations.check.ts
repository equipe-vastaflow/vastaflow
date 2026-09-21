import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Nomes das migrations registradas que ainda nao constam como executadas.
 *
 * SOMENTE LEITURA, de proposito. O `DataSource.showMigrations()` do TypeORM
 * cria a tabela `migrations` quando ela nao existe - DDL que o usuario da
 * aplicacao em producao pode (e deveria) nao ter permissao de executar.
 */
export async function findPendingMigrations(dataSource: DataSource): Promise<string[]> {
  const registered = dataSource.migrations.map((migration) => migration.name ?? '');
  const table = dataSource.options.migrationsTableName ?? 'migrations';

  const queryRunner = dataSource.createQueryRunner();
  try {
    if (!(await queryRunner.hasTable(table))) {
      return registered;
    }
    const executed = await dataSource
      .createQueryBuilder(queryRunner)
      .select('m.name', 'name')
      .from(table, 'm')
      .getRawMany<{ name: string }>();
    const executedNames = new Set(executed.map((row) => row.name));
    return registered.filter((name) => !executedNames.has(name));
  } finally {
    await queryRunner.release();
  }
}

/**
 * Impede a aplicacao de subir contra um schema desatualizado.
 *
 * Sem esta checagem, esquecer o `npm run migration:run` resulta num erro
 * obscuro no primeiro acesso ao banco (ex.: "Table 'x.permissions' doesn't
 * exist", vindo do seed). Roda em `onModuleInit`, antes de qualquer
 * `onApplicationBootstrap` (seed incluso).
 *
 * Com `DATABASE_SYNCHRONIZE=true` (somente desenvolvimento) o schema vem das
 * entities e a checagem e dispensada.
 */
@Injectable()
export class PendingMigrationsCheck implements OnModuleInit {
  private readonly logger = new Logger(PendingMigrationsCheck.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.synchronize) {
      this.logger.warn(
        'DATABASE_SYNCHRONIZE=true: schema criado a partir das entities, migrations ignoradas. ' +
          'Use apenas em desenvolvimento.',
      );
      return;
    }

    const pending = await findPendingMigrations(this.dataSource);
    if (pending.length > 0) {
      throw new Error(
        `Banco de dados desatualizado: ${pending.length} migration(s) pendente(s) ` +
          `(${pending.join(', ')}). Execute 'npm run migration:run' no diretorio backend/ ` +
          'antes de iniciar a aplicacao.',
      );
    }
  }
}
