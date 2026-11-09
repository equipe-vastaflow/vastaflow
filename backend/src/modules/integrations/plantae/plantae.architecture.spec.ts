import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import {
  HEADERS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { RoleName } from '../../roles/role-name.enum';
import { SERVICE_ROUTE_KEY } from '../../service-auth/service-auth.constants';
import {
  SERVICE_PRINCIPALS,
  ServicePrincipalId,
  ServiceScope,
} from '../../service-auth/service-principals';
import { PlantaeController } from './plantae.controller';
import { PlantaeModule } from './plantae.module';

/**
 * Propriedades de seguranca e de isolamento do modulo Plantae, verificadas no
 * CODIGO-FONTE. Sao as que nenhum teste de comportamento enxerga: um `fetch` a
 * mais, um `POST` escondido, uma leitura de `process.env` ou um token lido fora
 * do cliente HTTP.
 */
function fontes(dir: string): { arquivo: string; codigo: string }[] {
  return readdirSync(dir)
    .filter((arquivo) => arquivo.endsWith('.ts') && !arquivo.endsWith('.spec.ts'))
    .map((arquivo) => ({ arquivo, codigo: readFileSync(join(dir, arquivo), 'utf8') }));
}

function importsDe(codigo: string): string[] {
  return [...codigo.matchAll(/from\s+'([^']+)'/g)].map(([, origem]) => origem ?? '');
}

/** Sem comentarios: uma explicacao em texto nao pode disparar (nem esconder) uma busca. */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const PLANTAE = fontes(__dirname);
const MODULES = join(__dirname, '../..');

/** Unicas origens que o Plantae pode importar fora da propria pasta. */
const PERMITIDOS = new Set([
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/swagger',
  'node:crypto',
  '../integration-config',
  '../integration-registry',
  '../integration.enums',
  '../integration.types',
  '../integrations.module',
  '../../health/health.types',
  '../../audit/audit.module',
  '../../audit/audit.service',
  '../../audit/audit-action.enum',
  '../../audit/entities/audit-log.entity',
  '../../auth/auth.types',
  // Comando de chat /contas_pagar: so o contrato do Command Engine e o codigo de permissao.
  '../../commands/command-catalog',
  '../../commands/command-parser',
  '../../commands/command.types',
  '../../commands/commands.module',
  '../../permissions/permission-code.enum',
  '../../auth/decorators/current-user.decorator',
  '../../auth/decorators/require-permissions.decorator',
  '../../auth/decorators/roles.decorator',
  '../../roles/role-name.enum',
  '../../../common/decorators/client-ip.decorator',
  '../../../common/rate-limit/sliding-window-limiter',
]);

describe('Arquitetura do modulo Plantae', () => {
  it('ha fontes para verificar', () => {
    expect(PLANTAE.length).toBeGreaterThanOrEqual(14);
  });

  it.each(PLANTAE.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s so importa da propria pasta e das abstracoes permitidas',
    (_arquivo, codigo) => {
      const externos = importsDe(codigo).filter(
        (origem) => !origem.startsWith('./') && !PERMITIDOS.has(origem),
      );

      expect(externos).toEqual([]);
    },
  );

  it.each(PLANTAE.map(({ arquivo, codigo }) => [arquivo, codigo]))(
    '%s nao depende de modulo de negocio (dado do Plantae nao se mistura com o local)',
    (_arquivo, codigo) => {
      expect(
        importsDe(codigo)
          .filter((origem) => !origem.startsWith('./'))
          .filter((origem) =>
            /finance|documents|users|settings|notifications|external-identities|dashboard/.test(
              origem,
            ),
          ),
      ).toEqual([]);
    },
  );

  it('nenhum outro modulo do sistema importa o Plantae (so o AppModule o liga)', () => {
    const donos: string[] = [];
    const visitar = (dir: string): void => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const caminho = join(dir, entrada.name);
        if (entrada.isDirectory()) {
          if (caminho !== __dirname) {
            visitar(caminho);
          }
        } else if (entrada.name.endsWith('.ts') && !entrada.name.endsWith('.spec.ts')) {
          if (/from\s+'[^']*plantae[^']*'/.test(readFileSync(caminho, 'utf8'))) {
            donos.push(caminho.slice(MODULES.length + 1).replace(/\\/g, '/'));
          }
        }
      }
    };
    visitar(MODULES);

    expect(donos).toEqual([]);
  });

  describe('rede e token', () => {
    it('SO o cliente HTTP chama fetch', () => {
      // `\bfetch\b` e nao `fetch(`: o cliente a chama por um alias (`doFetch`).
      const comFetch = PLANTAE.filter(({ codigo }) => /\bfetch\b/.test(semComentarios(codigo))).map(
        ({ arquivo }) => arquivo,
      );

      expect(comFetch).toEqual(['plantae-http.client.ts']);
    });

    it('SO o cliente HTTP le o token', () => {
      const leitores = PLANTAE.filter(({ codigo }) =>
        /PLANTAE_API_TOKEN_KEY|PLANTAE_API_TOKEN\b/.test(semComentarios(codigo)),
      ).map(({ arquivo }) => arquivo);

      expect(leitores.sort()).toEqual(['plantae-http.client.ts', 'plantae.constants.ts']);
    });

    it('o token so entra em texto num lugar: o cabecalho `Authorization: Bearer`', () => {
      const cliente = semComentarios(
        PLANTAE.find(({ arquivo }) => arquivo === 'plantae-http.client.ts')?.codigo ?? '',
      );

      // Toda interpolacao do token numa string:
      const interpolacoes = [...cliente.matchAll(/`[^`]*\$\{token\}[^`]*`/g)].map(([t]) => t);
      expect(interpolacoes).toEqual(['`Bearer ${token}`']);
      // E nunca como argumento de erro, log ou parametro de query.
      expect(cliente).not.toMatch(
        /(Error|logger\.\w+|console\.\w+|searchParams\.\w+)\([^)]*\btoken\b/,
      );
    });

    it('nenhum fonte le process.env (a configuracao vem so do leitor de configuracao)', () => {
      expect(
        PLANTAE.filter(({ codigo }) => semComentarios(codigo).includes('process.env')),
      ).toEqual([]);
    });

    it('nenhum fonte usa console.*', () => {
      expect(PLANTAE.filter(({ codigo }) => semComentarios(codigo).includes('console.'))).toEqual(
        [],
      );
    });

    it('nenhuma opcao que enfraqueca o TLS (rejectUnauthorized, NODE_TLS_REJECT_UNAUTHORIZED, agent)', () => {
      const achados = PLANTAE.filter(({ codigo }) =>
        /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|dispatcher|new\s+https?\.Agent|insecure/i.test(
          semComentarios(codigo),
        ),
      ).map(({ arquivo }) => arquivo);

      expect(achados).toEqual([]);
    });

    it('o cliente nao segue redirect', () => {
      const cliente =
        PLANTAE.find(({ arquivo }) => arquivo === 'plantae-http.client.ts')?.codigo ?? '';

      expect(cliente).toContain("redirect: 'manual'");
      expect(cliente).not.toMatch(/redirect:\s*'follow'/);
    });
  });

  describe('somente leitura', () => {
    it('nenhum fonte monta requisicao com verbo de escrita', () => {
      const achados = PLANTAE.filter(({ codigo }) =>
        /method:\s*'(POST|PUT|PATCH|DELETE)'|@(Post|Put|Patch|Delete)\(/i.test(
          semComentarios(codigo),
        ),
      ).map(({ arquivo }) => arquivo);

      expect(achados).toEqual([]);
    });

    it('o cliente so faz GET, sem corpo na requisicao', () => {
      const cliente = semComentarios(
        PLANTAE.find(({ arquivo }) => arquivo === 'plantae-http.client.ts')?.codigo ?? '',
      );
      const inicio = cliente.indexOf('doFetch(url, {');
      const init = cliente.slice(inicio, cliente.indexOf('});', inicio));

      expect(inicio).toBeGreaterThan(-1);
      expect(cliente.match(/method:\s*'[A-Z]+'/g)).toEqual(["method: 'GET'"]);
      expect(init).not.toMatch(/\bbody\b/);
    });

    it('TODA rota do controller e GET', () => {
      const metodos = Object.getOwnPropertyNames(PlantaeController.prototype)
        .filter((nome) => nome !== 'constructor')
        .map((nome) => {
          const handler: unknown = Reflect.get(PlantaeController.prototype, nome);
          return Reflect.getMetadata(METHOD_METADATA, handler as object) as
            RequestMethod | undefined;
        })
        .filter((metodo) => metodo !== undefined);

      expect(metodos.length).toBeGreaterThanOrEqual(9);
      expect(new Set(metodos)).toEqual(new Set([RequestMethod.GET]));
    });

    it('o conjunto de rotas e exatamente o dos 8 endpoints oficiais, mais o estado local', () => {
      const rotas = Object.getOwnPropertyNames(PlantaeController.prototype)
        .filter((nome) => nome !== 'constructor')
        .map((nome) => Reflect.get(PlantaeController.prototype, nome) as object)
        .map((handler) => Reflect.getMetadata(PATH_METADATA, handler) as string | undefined)
        .filter((caminho) => caminho !== undefined)
        .sort();

      expect(rotas).toEqual(
        [
          'status',
          'me',
          'financial/entries',
          'financial/accounts',
          'financial/movements',
          'financial/account-statement',
          'fiscal/issued-invoices',
          'organization/legal-entities',
          'people',
        ].sort(),
      );
    });
  });

  describe('acesso', () => {
    /** Nome do metodo -> handler, so dos metodos que sao rota (tem caminho). */
    const rotas = (): Array<[string, object]> =>
      Object.getOwnPropertyNames(PlantaeController.prototype)
        .filter((nome) => nome !== 'constructor')
        .map((nome): [string, object] => [
          nome,
          Reflect.get(PlantaeController.prototype, nome) as object,
        ])
        .filter(([, handler]) => Reflect.getMetadata(PATH_METADATA, handler) !== undefined);

    it('o controller exige `plantae:read` (e so ela) na classe', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, PlantaeController)).toEqual([
        PermissionCode.PlantaeRead,
      ]);
    });

    it('NAO ha restricao de perfil residual na classe (o GESTOR autorizado consulta)', () => {
      expect(Reflect.getMetadata(ROLES_KEY, PlantaeController)).toBeUndefined();
    });

    it('nenhuma rota sobrescreve a permissao da classe com outra (ou com nenhuma)', () => {
      for (const [, handler] of rotas()) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
      }
    });

    it('SO `/me` e `/fiscal/issued-invoices` sao restritas a ADMIN; as demais nao tem `@Roles`', () => {
      const comPerfil = rotas()
        .filter(([, handler]) => Reflect.getMetadata(ROLES_KEY, handler) !== undefined)
        .map(([nome, handler]) => [nome, Reflect.getMetadata(ROLES_KEY, handler) as unknown])
        .sort(([a], [b]) => String(a).localeCompare(String(b)));

      expect(comPerfil).toEqual([
        ['invoices', [RoleName.Admin]],
        ['me', [RoleName.Admin]],
      ]);
    });

    it('as rotas so de ADMIN continuam exigindo `plantae:read` (nada foi removido)', () => {
      for (const nome of ['me', 'invoices']) {
        const handler = Reflect.get(PlantaeController.prototype, nome) as object;
        // Sem metadado proprio de permissao: vale a da classe (`plantae:read`).
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
        expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
          { name: 'Cache-Control', value: 'no-store' },
        ]);
      }
      expect(Reflect.getMetadata(PERMISSIONS_KEY, PlantaeController)).toEqual([
        PermissionCode.PlantaeRead,
      ]);
    });

    it('TODA rota responde com `Cache-Control: no-store`', () => {
      const lista = rotas();

      expect(lista.length).toBe(9);
      for (const [nome, handler] of lista) {
        const cabecalhos = Reflect.getMetadata(HEADERS_METADATA, handler) as
          Array<{ name: string; value: string }> | undefined;
        expect({ nome, cabecalhos }).toEqual({
          nome,
          cabecalhos: [{ name: 'Cache-Control', value: 'no-store' }],
        });
      }
    });

    it('toda resposta com itens passa pelo mascaramento (listagens e extrato)', () => {
      const controlador = semComentarios(
        PLANTAE.find(({ arquivo }) => arquivo === 'plantae.controller.ts')?.codigo ?? '',
      );

      // As duas unicas saidas de itens: `listing` (6 listagens) e `statementResponse`.
      expect(controlador.match(/data:\s*maskSensitive\(page\.items\)/g)).toHaveLength(2);
      expect(controlador).not.toMatch(/data:\s*page\.items/);
    });

    it('nenhuma rota e publica', () => {
      const publicas = Object.getOwnPropertyNames(PlantaeController.prototype).filter(
        (nome) =>
          Reflect.getMetadata(
            IS_PUBLIC_KEY,
            Reflect.get(PlantaeController.prototype, nome) as object,
          ) === true,
      );

      expect(publicas).toEqual([]);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, PlantaeController)).toBeUndefined();
    });

    it('nenhuma rota e de SERVICO: o token do n8n nao autentica aqui', () => {
      expect(Reflect.getMetadata(SERVICE_ROUTE_KEY, PlantaeController)).toBeUndefined();
      for (const nome of Object.getOwnPropertyNames(PlantaeController.prototype)) {
        expect(
          Reflect.getMetadata(
            SERVICE_ROUTE_KEY,
            Reflect.get(PlantaeController.prototype, nome) as object,
          ),
        ).toBeUndefined();
      }
    });

    it('o escopo do principal n8n continua SO o de identidade', () => {
      expect(SERVICE_PRINCIPALS[ServicePrincipalId.N8n].scopes).toEqual([ServiceScope.Identity]);
    });

    it('o parametro @Query de cada rota tem metadado `Object` (o parser proprio valida, nao o ValidationPipe)', () => {
      // Regressao real: um `type Query` local colidiu com o decorador `@Query` e o
      // TypeScript emitiu a FUNCAO do decorador como tipo do parametro; o
      // ValidationPipe global a tratou como classe e devolveu 400 em toda rota.
      const comQuery = [
        'entries',
        'accounts',
        'movements',
        'statement',
        'invoices',
        'legalEntities',
        'people',
      ];

      for (const nome of comQuery) {
        const tipos = Reflect.getMetadata(
          'design:paramtypes',
          PlantaeController.prototype,
          nome,
        ) as unknown[] | undefined;
        expect(tipos?.[0]).toBe(Object);
      }
    });

    it('o controller nao e uma API generica: nenhum parametro aceita URL, metodo ou token', () => {
      const controlador = semComentarios(
        PLANTAE.find(({ arquivo }) => arquivo === 'plantae.controller.ts')?.codigo ?? '',
      );

      expect(controlador).not.toMatch(/@Body\(|@Headers\(|@Req\(|@Param\(/);
    });
  });

  describe('modulo', () => {
    it('declara exatamente um controller', () => {
      expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PlantaeModule)).toEqual([
        PlantaeController,
      ]);
    });

    it('nao tem entity nem acesso a banco (nada do Plantae e gravado)', () => {
      const achados = PLANTAE.filter(({ codigo }) =>
        /@Entity|TypeOrmModule|Repository|DataSource|createQueryBuilder/.test(
          semComentarios(codigo),
        ),
      ).map(({ arquivo }) => arquivo);

      expect(achados).toEqual([]);
    });
  });
});
