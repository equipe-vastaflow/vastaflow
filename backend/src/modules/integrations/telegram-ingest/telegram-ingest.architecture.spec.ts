import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { SERVICE_ROUTE_KEY, SERVICE_SCOPES_KEY } from '../../service-auth/service-auth.constants';
import {
  SERVICE_PRINCIPALS,
  ServicePrincipalId,
  ServiceScope,
} from '../../service-auth/service-principals';
import { TelegramIngestController } from './telegram-ingest.controller';
import { TelegramIngestModule } from './telegram-ingest.module';

function fontes(dir: string): { arquivo: string; codigo: string }[] {
  return readdirSync(dir)
    .filter((arquivo) => arquivo.endsWith('.ts') && !arquivo.endsWith('.spec.ts'))
    .map((arquivo) => ({ arquivo, codigo: readFileSync(join(dir, arquivo), 'utf8') }));
}

function importsDe(codigo: string): string[] {
  return [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem ?? '');
}

function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const INGEST = fontes(__dirname);

/** Unicas origens que a entrada de servico importa fora da propria pasta. */
const PERMITIDOS = new Set([
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/swagger',
  '@nestjs/typeorm',
  'reflect-metadata',
  'class-transformer',
  'class-validator',
  'typeorm',
  '../../../config/env.validation',
  '../../../database/database.config',
  '../../../database/unique-violation',
  '../../audit/audit.module',
  '../../audit/audit.service',
  '../../audit/audit-action.enum',
  '../../audit/entities/audit-log.entity',
  '../../commands/command.types',
  '../../service-auth/decorators/current-service.decorator',
  '../../service-auth/decorators/service-route.decorator',
  '../../service-auth/service-auth.constants',
  '../../service-auth/service-principals',
  '../integration-config',
  '../channels/incoming-message',
  '../telegram/telegram.adapter',
  '../telegram/telegram.module',
  '../telegram/telegram-envelope',
  '../telegram/telegram-n8n-settings',
]);

describe('Arquitetura da entrada de servico do Telegram', () => {
  it('ha fontes para verificar', () => {
    expect(INGEST.length).toBeGreaterThanOrEqual(6);
  });

  it.each(INGEST.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s so importa da propria pasta e das abstracoes permitidas',
    (_arquivo, codigo) => {
      expect(
        importsDe(codigo).filter((origem) => !origem.startsWith('./') && !PERMITIDOS.has(origem)),
      ).toEqual([]);
    },
  );

  it.each(INGEST.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s nao depende de modulo de negocio, do Plantae nem de usuarios',
    (_arquivo, codigo) => {
      expect(
        importsDe(codigo).filter((origem) =>
          /(^|\/)(finance|documents|plantae|users|settings|notifications|external-identities|permissions)(\/|$)/.test(
            origem,
          ),
        ),
      ).toEqual([]);
    },
  );

  it('nenhuma rede, nenhum process.env, nenhum console, nenhum token do bot ou do Plantae', () => {
    // O CLI do operador (`*.cli.ts`) e a unica excecao de `process.env`: monta a propria
    // conexao com o banco, como o `data-source.ts`. Mesmo assim, sem rede, sem console e
    // sem token (verificado abaixo).
    for (const { arquivo, codigo } of INGEST) {
      const limpo = semComentarios(codigo);
      const ehCli = arquivo.endsWith('.cli.ts');

      expect({ arquivo, fetch: /\bfetch\b/.test(limpo) }).toEqual({ arquivo, fetch: false });
      expect({ arquivo, env: !ehCli && limpo.includes('process.env') }).toEqual({
        arquivo,
        env: false,
      });
      expect({ arquivo, console: limpo.includes('console.') }).toEqual({
        arquivo,
        console: false,
      });
      expect({ arquivo, token: /TELEGRAM_BOT_TOKEN|PLANTAE_API_TOKEN/.test(limpo) }).toEqual({
        arquivo,
        token: false,
      });
    }
  });

  it('o DTO nao declara NENHUM campo de autoridade (usuario, perfil, permissao)', () => {
    const dto = semComentarios(
      INGEST.find(({ arquivo }) => arquivo === 'telegram-ingest.dto.ts')?.codigo ?? '',
    );

    expect(dto).not.toMatch(
      /\b(actorUserId|usuarioId|userRole|role|roles|permissions?|isAdmin|admin)\s*[?:]/i,
    );
  });

  it('o servico nao escolhe o ator nem dispensa o RBAC, e nunca aceita vinculo', () => {
    const servico = semComentarios(
      INGEST.find(({ arquivo }) => arquivo === 'telegram-ingest.service.ts')?.codigo ?? '',
    );

    expect(servico).not.toMatch(/hasPermission|RoleName|Admin/);
    expect(servico).toContain('allowLinking: false');
  });

  describe('controller', () => {
    const handler = Reflect.get(TelegramIngestController.prototype, 'handle') as object;

    it('tem exatamente UMA rota: POST /service/telegram/ingest', () => {
      const metodos = Object.getOwnPropertyNames(TelegramIngestController.prototype).filter(
        (nome) => nome !== 'constructor',
      );

      expect(metodos).toEqual(['handle']);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('ingest');
      expect(Reflect.getMetadata(PATH_METADATA, TelegramIngestController)).toBe('service/telegram');
    });

    it('e rota de SERVICO com o escopo proprio, e nunca publica', () => {
      expect(Reflect.getMetadata(SERVICE_ROUTE_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(SERVICE_SCOPES_KEY, handler)).toEqual([
        ServiceScope.TelegramIngest,
      ]);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, TelegramIngestController)).toBeUndefined();
    });
  });

  it('o escopo de ingestao e SO do principal n8n-telegram; o n8n antigo segue so com identidade', () => {
    expect(SERVICE_PRINCIPALS[ServicePrincipalId.N8nTelegram].scopes).toEqual([
      ServiceScope.TelegramIngest,
    ]);
    expect(SERVICE_PRINCIPALS[ServicePrincipalId.N8n].scopes).toEqual([ServiceScope.Identity]);
  });

  it('o modulo declara um controller e nenhum consumidor do Telegram', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, TelegramIngestModule)).toEqual([
      TelegramIngestController,
    ]);
    const modulo = semComentarios(
      INGEST.find(({ arquivo }) => arquivo === 'telegram-ingest.module.ts')?.codigo ?? '',
    );
    expect(modulo).not.toMatch(/TelegramPollingService|TelegramApiClient/);
  });
});
