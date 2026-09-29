import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { TelegramModule } from './telegram.module';

/**
 * Regras de dependencia do canal Telegram, verificadas no codigo-fonte.
 *
 * - o Command Engine nao conhece o Telegram (nem a camada de integracoes);
 * - o Telegram nao depende de modulo de negocio;
 * - so o cliente HTTP faz chamada de rede;
 * - nenhuma rota HTTP (webhook) e aberta.
 */
function fontes(dir: string): { arquivo: string; codigo: string }[] {
  return readdirSync(dir)
    .filter((arquivo) => arquivo.endsWith('.ts') && !arquivo.endsWith('.spec.ts'))
    .map((arquivo) => ({ arquivo, codigo: readFileSync(join(dir, arquivo), 'utf8') }));
}

function importsDe(codigo: string): string[] {
  return [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem);
}

const TELEGRAM = fontes(__dirname);
const COMMANDS = [
  ...fontes(join(__dirname, '../../commands')),
  ...fontes(join(__dirname, '../../commands/handlers')),
];
const CHANNELS = fontes(join(__dirname, '../channels'));

/** Unicas origens que o Telegram pode importar fora da propria pasta. */
const PERMITIDOS = new Set([
  '@nestjs/common',
  '@nestjs/config',
  '../channels/channel-identity',
  '../channels/incoming-message',
  '../integration-config',
  '../integration-registry',
  '../integration.enums',
  '../integration.types',
  '../integrations.module',
  '../../auth/auth.types',
  '../../commands/command-router.service',
  '../../commands/command.types',
  '../../commands/commands.module',
  '../../health/health.types',
  '../../../config/env.validation',
]);

describe('Arquitetura do canal Telegram', () => {
  it('ha fontes para verificar nas tres pastas', () => {
    expect(TELEGRAM.length).toBeGreaterThan(0);
    expect(COMMANDS.length).toBeGreaterThan(0);
    expect(CHANNELS.length).toBeGreaterThan(0);
  });

  it.each(COMMANDS.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    'Command Engine (%s) nao importa integracoes nem Telegram',
    (_arquivo, codigo) => {
      expect(importsDe(codigo).filter((origem) => /integrations|telegram/i.test(origem))).toEqual(
        [],
      );
    },
  );

  it.each(TELEGRAM.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s so importa da propria pasta e das abstracoes permitidas',
    (_arquivo, codigo) => {
      const externos = importsDe(codigo).filter(
        (origem) => !origem.startsWith('./') && !PERMITIDOS.has(origem),
      );

      expect(externos).toEqual([]);
    },
  );

  it.each(TELEGRAM.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s nao depende de modulo de negocio',
    (_arquivo, codigo) => {
      expect(
        importsDe(codigo).filter((origem) => /finance|notifications|users|settings/.test(origem)),
      ).toEqual([]);
    },
  );

  it('somente o cliente HTTP chama fetch', () => {
    const comFetch = TELEGRAM.filter(({ codigo }) => /\bfetch\s*\(/.test(codigo)).map(
      ({ arquivo }) => arquivo,
    );

    expect(comFetch).toEqual(['telegram-api.client.ts']);
  });

  it('a camada de canal e neutra: nao conhece o Telegram', () => {
    for (const { codigo } of CHANNELS) {
      expect(importsDe(codigo).filter((origem) => /telegram/i.test(origem))).toEqual([]);
    }
  });

  it('o modulo nao abre rota HTTP (sem webhook)', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, TelegramModule) as
      unknown[] | undefined;

    expect(controllers ?? []).toEqual([]);
  });
});
