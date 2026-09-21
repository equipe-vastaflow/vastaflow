import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'reflect-metadata';
import { DataSource, type DataSourceOptions, type QueryRunner } from 'typeorm';
import { DatabaseType } from '../config/env.validation';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

/**
 * Compatibilidade do schema com MySQL e Oracle, verificada SEM banco.
 *
 * Estes testes nao substituem a execucao contra um banco real (ver
 * database/README.md); eles impedem que regressoes conhecidas voltem, como o
 * `DataTypeNotSupportedError` do tipo `boolean` no Oracle.
 */

/** Pior caso de identificador no Oracle (versoes anteriores ao 12.2). */
const ORACLE_MAX_IDENTIFIER = 30;

const CONNECTION: Record<DatabaseType, DataSourceOptions> = {
  // Nenhuma conexao e aberta: so a metadata e montada.
  mysql: { type: 'mysql', host: 'unused', database: 'unused', entities: ENTITIES },
  oracle: { type: 'oracle', host: 'unused', serviceName: 'unused', entities: ENTITIES },
};

async function buildDataSource(type: DatabaseType): Promise<DataSource> {
  const dataSource = new DataSource(CONNECTION[type]);
  // `buildMetadatas` e o passo do `initialize()` que valida tipos e relacoes;
  // e protegido no TypeORM, mas e exatamente o que queremos exercitar.
  await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  return dataSource;
}

/** Executa `up`/`down` com um QueryRunner falso que apenas registra o SQL. */
async function captureSql(type: DatabaseType, direction: 'up' | 'down'): Promise<string[]> {
  const statements: string[] = [];
  const queryRunner = {
    query: (sql: string): Promise<void> => {
      statements.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  const migrations = MIGRATIONS[type].map((Migration) => new Migration());
  const ordered = direction === 'up' ? migrations : [...migrations].reverse();
  for (const migration of ordered) {
    await migration[direction](queryRunner);
  }
  return statements;
}

describe.each(Object.values(DatabaseType))('metadata das entities - %s', (type) => {
  it('e construida sem erro (tipos e relacoes suportados pelo driver)', async () => {
    await expect(buildDataSource(type)).resolves.toBeInstanceOf(DataSource);
  });

  it('usa apenas tipos de coluna suportados pelo driver', async () => {
    const dataSource = await buildDataSource(type);
    const unsupported = dataSource.entityMetadatas.flatMap((metadata) =>
      metadata.columns
        .map((column) => ({
          column: `${metadata.tableName}.${column.databaseName}`,
          type: dataSource.driver.normalizeType(column),
        }))
        .filter(
          ({ type: columnType }) =>
            !dataSource.driver.supportedDataTypes.includes(columnType as never),
        ),
    );

    expect(unsupported).toEqual([]);
  });

  it('User.ativo e booleano de verdade: grava 1/0 e le true/false', async () => {
    const dataSource = await buildDataSource(type);
    const ativo = dataSource.getMetadata('User').findColumnWithPropertyName('ativo');
    if (!ativo) {
      throw new Error('coluna User.ativo nao encontrada');
    }

    // O construtor `Boolean` (e nao a string 'boolean') e o que liga a
    // conversao de valores nos drivers.
    expect(ativo.type).toBe(Boolean);
    expect(dataSource.driver.preparePersistentValue(true, ativo)).toBe(1);
    expect(dataSource.driver.preparePersistentValue(false, ativo)).toBe(0);
    expect(dataSource.driver.prepareHydratedValue(1, ativo)).toBe(true);
    expect(dataSource.driver.prepareHydratedValue(0, ativo)).toBe(false);
  });

  it('AuditLog.metadados faz ida e volta como JSON', async () => {
    const dataSource = await buildDataSource(type);
    const metadados = dataSource.getMetadata('AuditLog').findColumnWithPropertyName('metadados');
    if (!metadados) {
      throw new Error('coluna AuditLog.metadados nao encontrada');
    }

    const value = { motivo: 'TESTE', detalhes: { tentativas: 3, ok: false } };
    const stored = dataSource.driver.preparePersistentValue(value, metadados) as unknown;

    expect(typeof stored).toBe('string');
    expect(dataSource.driver.prepareHydratedValue(stored, metadados)).toEqual(value);
    expect(metadados.isNullable).toBe(true);
  });
});

describe('limites do Oracle', () => {
  it(`todos os identificadores tem no maximo ${ORACLE_MAX_IDENTIFIER} caracteres`, async () => {
    const dataSource = await buildDataSource(DatabaseType.Oracle);
    const names = dataSource.entityMetadatas.flatMap((metadata) => [
      metadata.tableName,
      ...metadata.columns.map((column) => column.databaseName),
      ...metadata.indices.map((index) => index.name),
      ...metadata.foreignKeys.map((foreignKey) => foreignKey.name),
      ...metadata.uniques.map((unique) => unique.name),
    ]);

    expect(names.filter((name) => name.length > ORACLE_MAX_IDENTIFIER)).toEqual([]);
  });

  it(`nomes entre aspas nas migrations Oracle tem no maximo ${ORACLE_MAX_IDENTIFIER} caracteres`, async () => {
    const sql = [
      ...(await captureSql(DatabaseType.Oracle, 'up')),
      ...(await captureSql(DatabaseType.Oracle, 'down')),
    ];
    const identifiers = sql.flatMap((statement) =>
      [...statement.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    );

    expect(identifiers.filter((name) => name.length > ORACLE_MAX_IDENTIFIER)).toEqual([]);
  });
});

describe('migrations', () => {
  const FOREIGN_SYNTAX: Record<DatabaseType, RegExp> = {
    // Sintaxe de Oracle que nao pode aparecer numa migration MySQL...
    mysql: /\bvarchar2\b|\bclob\b|\bnumber\b|"/i,
    // ...e de MySQL que nao pode aparecer numa migration Oracle.
    oracle: /`|\bENGINE=|\btinyint\b|\bdatetime\b|\bAUTO_INCREMENT\b|\btext\b|\bboolean\b/i,
  };

  it.each(Object.values(DatabaseType))('%s: nao contem sintaxe do outro banco', async (type) => {
    const sql = [...(await captureSql(type, 'up')), ...(await captureSql(type, 'down'))];

    expect(sql.filter((statement) => FOREIGN_SYNTAX[type].test(statement))).toEqual([]);
  });

  it.each(Object.values(DatabaseType))(
    '%s: o down desfaz tudo que o up cria, removendo FKs antes das tabelas',
    async (type) => {
      const up = await captureSql(type, 'up');
      const down = (await captureSql(type, 'down')).join('\n');
      const name = String.raw`[\x60"]([^\x60"]+)[\x60"]`;

      const created = up.flatMap((statement) => [
        ...[...statement.matchAll(new RegExp(String.raw`^CREATE TABLE ${name}`, 'g'))].map((m) => ({
          kind: 'TABLE',
          name: m[1],
        })),
        ...[
          ...statement.matchAll(new RegExp(String.raw`^CREATE (?:UNIQUE )?INDEX ${name}`, 'g')),
        ].map((m) => ({ kind: 'INDEX', name: m[1] })),
        ...[...statement.matchAll(new RegExp(String.raw`ADD CONSTRAINT ${name}`, 'g'))].map(
          (m) => ({ kind: 'CONSTRAINT', name: m[1] }),
        ),
      ]);

      const notDropped = created.filter(({ kind, name: object }) => {
        const drop =
          kind === 'CONSTRAINT' ? String.raw`DROP (?:CONSTRAINT|FOREIGN KEY)` : `DROP ${kind}`;
        return !new RegExp(String.raw`${drop} [\x60"]${object}[\x60"]`).test(down);
      });

      expect(created.length).toBeGreaterThan(0);
      expect(notDropped).toEqual([]);

      const lastConstraintDrop = Math.max(
        down.lastIndexOf('DROP CONSTRAINT'),
        down.lastIndexOf('DROP FOREIGN KEY'),
      );
      expect(lastConstraintDrop).toBeLessThan(down.indexOf('DROP TABLE'));
    },
  );

  it('MySQL e Oracle tem as mesmas migrations, na mesma ordem', () => {
    const names = (type: DatabaseType): string[] =>
      MIGRATIONS[type].map((Migration) => new Migration().name ?? Migration.name);

    expect(names(DatabaseType.Oracle)).toEqual(names(DatabaseType.Mysql));
  });

  it.each(Object.values(DatabaseType))(
    '%s: todo arquivo da pasta esta registrado em migrations/index.ts',
    (type) => {
      const files = readdirSync(join(__dirname, 'migrations', type)).filter((file) =>
        /^\d+-\w+\.ts$/.test(file),
      );
      const registered = MIGRATIONS[type].map((Migration) => Migration.name);

      // Convencao do TypeORM: arquivo `<timestamp>-<Nome>.ts` exporta `<Nome><timestamp>`.
      const expected = files.map((file) => {
        const [timestamp, name] = file.replace(/\.ts$/, '').split('-');
        return `${name}${timestamp}`;
      });

      expect(registered).toEqual(expected);
    },
  );
});

describe('ENTITIES', () => {
  it('contem toda entity declarada no codigo', () => {
    const modulesDir = join(__dirname, '..', 'modules');
    const declared = readdirSync(modulesDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.entity.ts'))
      .flatMap((file) => {
        const source = readFileSync(join(modulesDir, file), 'utf8');
        return [...source.matchAll(/@Entity\([\s\S]*?\)\s*export class (\w+)/g)].map((m) => m[1]);
      });

    expect(ENTITIES.map((entity) => entity.name).sort()).toEqual(declared.sort());
  });
});
