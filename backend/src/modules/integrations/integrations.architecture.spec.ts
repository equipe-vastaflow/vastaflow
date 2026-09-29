import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { IntegrationRegistry } from './integration-registry';
import { IntegrationsModule } from './integrations.module';

/** Dois "modulos de integracao" de teste, cada um importando a foundation. */
@Module({
  imports: [IntegrationsModule],
  providers: [{ provide: 'REGISTRO_A', useExisting: IntegrationRegistry }],
  exports: ['REGISTRO_A'],
})
class ModuloA {}

@Module({
  imports: [IntegrationsModule],
  providers: [{ provide: 'REGISTRO_B', useExisting: IntegrationRegistry }],
  exports: ['REGISTRO_B'],
})
class ModuloB {}

/**
 * Regra de dependencia da foundation, verificada no codigo-fonte.
 *
 * A camada de integracoes fica ABAIXO dos modulos de negocio: ela nao pode
 * importar nenhum deles, nem cliente HTTP ou SDK de fornecedor. Se alguem
 * acrescentar um `import` fora da lista, este teste falha.
 */
const PERMITIDOS = new Set(['@nestjs/common', '@nestjs/config', '../health/health.types']);

const fontes = readdirSync(__dirname)
  .filter((arquivo) => arquivo.endsWith('.ts') && !arquivo.endsWith('.spec.ts'))
  .map((arquivo) => ({ arquivo, codigo: readFileSync(join(__dirname, arquivo), 'utf8') }));

function importsDe(codigo: string): string[] {
  return [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem);
}

describe('Arquitetura da camada de integracoes', () => {
  it('ha arquivos de fonte para verificar', () => {
    expect(fontes.map(({ arquivo }) => arquivo)).toContain('integration-registry.ts');
  });

  it.each(fontes.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s so importa do proprio modulo, do Nest e do tipo de health',
    (_arquivo, codigo) => {
      const externos = importsDe(codigo).filter(
        (origem) => !origem.startsWith('./') && !PERMITIDOS.has(origem),
      );

      expect(externos).toEqual([]);
    },
  );

  it.each(fontes.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s nao faz chamada de rede',
    (_arquivo, codigo) => {
      expect(codigo).not.toMatch(/\bfetch\s*\(/);
      expect(codigo).not.toMatch(/require\(/);
    },
  );

  it('o modulo nao importa nenhum outro modulo', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, IntegrationsModule) as
      unknown[] | undefined;

    expect(imports ?? []).toEqual([]);
  });

  it('o modulo nao declara rota HTTP', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, IntegrationsModule) as
      unknown[] | undefined;

    expect(controllers ?? []).toEqual([]);
  });

  it('modulos diferentes que importam a foundation enxergam o MESMO registro', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ModuloA, ModuloB] }).compile();

    const a = moduleRef.get<IntegrationRegistry>('REGISTRO_A');
    const b = moduleRef.get<IntegrationRegistry>('REGISTRO_B');

    expect(a).toBeInstanceOf(IntegrationRegistry);
    expect(a).toBe(b);
    await moduleRef.close();
  });
});
