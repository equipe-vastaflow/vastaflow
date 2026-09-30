import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'reflect-metadata';
import { DataSource, type DataSourceOptions, type QueryRunner } from 'typeorm';
import { DatabaseType } from '../config/env.validation';
import { AuditAction, AuditModuleName } from '../modules/audit/audit-action.enum';
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

/** SQL de cada migration separadamente, na ordem de execucao da direcao pedida. */
async function captureSqlPerMigration(
  type: DatabaseType,
  direction: 'up' | 'down',
): Promise<string[][]> {
  const migrations = MIGRATIONS[type].map((Migration) => new Migration());
  const ordered = direction === 'up' ? migrations : [...migrations].reverse();

  const porMigration: string[][] = [];
  for (const migration of ordered) {
    const statements: string[] = [];
    const queryRunner = {
      query: (sql: string): Promise<void> => {
        statements.push(sql);
        return Promise.resolve();
      },
    } as unknown as QueryRunner;

    await migration[direction](queryRunner);
    porMigration.push(statements);
  }
  return porMigration;
}

/** Executa `up`/`down` de todas as migrations com um QueryRunner falso que so registra o SQL. */
async function captureSql(type: DatabaseType, direction: 'up' | 'down'): Promise<string[]> {
  return (await captureSqlPerMigration(type, direction)).flat();
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

  it('IdentityLinkRequest: codigo so em hash, uma pendente por usuario, sem id externo', async () => {
    const dataSource = await buildDataSource(type);
    const metadata = dataSource.getMetadata('IdentityLinkRequest');
    const unico = (nome: string): string[] | undefined => {
      const index = metadata.indices.find((i) => i.name === nome);
      return index?.isUnique ? index.columns.map((c) => c.databaseName) : undefined;
    };

    expect(unico('ux_link_req_codigo')).toEqual(['codigo_hash']);
    expect(unico('ux_link_req_pendente')).toEqual(['pendente_chave']);
    expect(metadata.findColumnWithPropertyName('pendenteChave')?.isNullable).toBe(true);
    expect(metadata.foreignKeys).toEqual([]);
    // Quem inicia nao escolhe a conta externa, e o codigo em claro nao e gravado.
    const colunas = metadata.columns.map((column) => column.databaseName);
    expect(colunas).not.toContain('id_externo');
    expect(colunas).not.toContain('codigo');
  });

  it('ExternalIdentityLink: (canal, id_externo) unico, sem FK e sem coluna de perfil', async () => {
    const dataSource = await buildDataSource(type);
    const metadata = dataSource.getMetadata('ExternalIdentityLink');

    const unico = metadata.indices.find((index) => index.name === 'ux_ext_ident_canal_id');
    expect(unico?.isUnique).toBe(true);
    expect(unico?.columns.map((column) => column.databaseName)).toEqual(['canal', 'id_externo']);
    expect(metadata.foreignKeys).toEqual([]);
    // A autorizacao vem do usuario: o vinculo nao copia perfil nem permissao.
    expect(metadata.columns.map((column) => column.databaseName).sort()).toEqual(
      ['canal', 'created_at', 'id', 'id_externo', 'updated_at', 'usuario_id'].sort(),
    );
  });

  it('FinancialEntry.valor e DECIMAL(15,2) e sempre lido como number', async () => {
    const dataSource = await buildDataSource(type);
    const valor = dataSource.getMetadata('FinancialEntry').findColumnWithPropertyName('valor');
    if (!valor) {
      throw new Error('coluna FinancialEntry.valor nao encontrada');
    }

    expect(valor.precision).toBe(15);
    expect(valor.scale).toBe(2);

    // Dinheiro nunca em ponto flutuante no banco...
    expect(['decimal', 'number']).toContain(dataSource.driver.normalizeType(valor));

    // ...e o transformer cobre a divergencia entre drivers: o MySQL devolve
    // string e os demais, number. O dominio precisa ver sempre number.
    expect(dataSource.driver.prepareHydratedValue('1500.50', valor)).toBe(1500.5);
    expect(dataSource.driver.prepareHydratedValue(1500.5, valor)).toBe(1500.5);
    expect(typeof dataSource.driver.preparePersistentValue(1500.5, valor)).toBe('number');
  });

  it('FinancialEntry.data e uma data sem hora, lida como YYYY-MM-DD', async () => {
    const dataSource = await buildDataSource(type);
    const data = dataSource.getMetadata('FinancialEntry').findColumnWithPropertyName('data');
    if (!data) {
      throw new Error('coluna FinancialEntry.data nao encontrada');
    }

    expect(data.type).toBe('date');

    // O dominio trafega a data como string `YYYY-MM-DD` de ponta a ponta (DTO,
    // entity e resposta). Na LEITURA os tres drivers entregam essa string.
    expect(dataSource.driver.prepareHydratedValue('2026-09-23', data)).toBe('2026-09-23');

    // Na ESCRITA os caminhos diferem, e os dois estao corretos: MySQL e SQLite
    // enviam a string; o Oracle monta a expressao `TO_DATE(...)`, que e como o
    // TypeORM grava data naquele banco. O dominio nao percebe a diferenca.
    const gravado = dataSource.driver.preparePersistentValue('2026-09-23', data) as unknown;
    if (typeof gravado === 'function') {
      expect(String((gravado as () => string)())).toContain('2026-09-23');
    } else {
      expect(gravado).toBe('2026-09-23');
    }

    // O MySQL devolve DATE como `Date` em 00:00 UTC. Sem `utc: true` na coluna,
    // o TypeORM formataria no fuso LOCAL e o dia voltaria um em qualquer fuso
    // negativo - gravar 2026-09-23 e ler 2026-09-22. Este teste falha se a
    // opcao for removida, em qualquer fuso do servidor.
    expect(data.utc).toBe(true);
    expect(dataSource.driver.prepareHydratedValue(new Date('2026-09-23T00:00:00Z'), data)).toBe(
      '2026-09-23',
    );
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

  it.each(Object.values(DatabaseType))(
    '%s: identity_link_requests nasce com os indices UNICOS de codigo e de pendente',
    async (type) => {
      const sql = (await captureSql(type, 'up')).join('\n');

      expect(sql).toMatch(/UNIQUE INDEX [`"]ux_link_req_codigo[`"]/);
      expect(sql).toMatch(/UNIQUE INDEX [`"]ux_link_req_pendente[`"]/);
    },
  );

  it.each(Object.values(DatabaseType))(
    '%s: external_identity_links nasce com o indice UNICO de (canal, id_externo)',
    async (type) => {
      const sql = (await captureSql(type, 'up')).join('\n');

      expect(sql).toMatch(/UNIQUE INDEX [`"]ux_ext_ident_canal_id[`"]/);
      expect(sql).toMatch(/[`"]canal[`"], [`"]id_externo[`"]/);
    },
  );

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

      // A ordem "FKs antes das tabelas" vale DENTRO de cada migration: entre
      // migrations diferentes os blocos se intercalam, e comparar o texto
      // concatenado compararia objetos que nao tem relacao entre si.
      for (const sql of await captureSqlPerMigration(type, 'down')) {
        const bloco = sql.join('\n');
        const ultimoDropDeConstraint = Math.max(
          bloco.lastIndexOf('DROP CONSTRAINT'),
          bloco.lastIndexOf('DROP FOREIGN KEY'),
        );
        if (ultimoDropDeConstraint >= 0) {
          expect(ultimoDropDeConstraint).toBeLessThan(bloco.indexOf('DROP TABLE'));
        }
      }
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

/**
 * O SQLite dos testes nao impoe o tamanho de `varchar`; MySQL e Oracle sim. Uma
 * acao de auditoria maior que a coluna seria recusada em producao - e, como a
 * auditoria e best-effort, o registro sumiria em silencio.
 */
describe('vocabulario da auditoria cabe nas colunas', () => {
  it.each(Object.values(DatabaseType))('%s', async (type) => {
    const metadata = (await buildDataSource(type)).getMetadata('AuditLog');
    const tamanho = (propriedade: string): number =>
      Number(metadata.findColumnWithPropertyName(propriedade)?.length);

    for (const acao of Object.values(AuditAction)) {
      expect(acao.length).toBeLessThanOrEqual(tamanho('acao'));
    }
    for (const modulo of Object.values(AuditModuleName)) {
      expect(modulo.length).toBeLessThanOrEqual(tamanho('modulo'));
    }
  });
});
