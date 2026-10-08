import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, Logger, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import request from 'supertest';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator';
import {
  SERVICE_ROUTE_KEY,
  SERVICE_UNAUTHORIZED_MESSAGE,
} from '../src/modules/service-auth/service-auth.constants';
import {
  addCredential,
  EMPTY_CREDENTIALS_FILE,
  revokeCredential,
} from '../src/modules/service-auth/service-credentials.admin';
import {
  type ServiceCredentialsFile,
  serializeCredentialsFile,
} from '../src/modules/service-auth/service-credentials.file';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };

/** O TTL do store e 1 s; esperar mais que isso garante que a mudanca no arquivo foi relida. */
const PASSOU_O_TTL_MS = 1300;
const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Autenticacao servico-a-servico (n8n -> NestJS), com a aplicacao COMPLETA:
 * mesmos guards globais, na mesma ordem, e o store lendo um arquivo de verdade.
 */
describe('Autenticacao de servico (e2e)', () => {
  let app: INestApplication;
  let dir: string;
  let arquivo: string;
  let estado: ServiceCredentialsFile;
  let token: string;
  let humanToken: string;

  const server = (): Server => app.getHttpServer() as Server;
  const gravar = (file: ServiceCredentialsFile): void => {
    estado = file;
    writeFileSync(arquivo, serializeCredentialsFile(file));
  };

  const identity = (valor?: string): request.Test => {
    const req = request(server()).get('/service/identity');
    return valor === undefined ? req : req.set('X-Service-Token', valor);
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vf-service-e2e-'));
    arquivo = join(dir, 'credentials.json');
    process.env.SERVICE_CREDENTIALS_FILE = arquivo;

    const criada = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-e2e',
      principal: 'n8n',
      now: new Date(),
    });
    token = criada.token;
    gravar(criada.file);

    app = await createTestApp();
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    humanToken = (login.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
    delete process.env.SERVICE_CREDENTIALS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  describe('A. token valido', () => {
    it('autentica como SERVICO (n8n), nunca como pessoa', async () => {
      const response = await identity(token).expect(200);

      expect(response.body).toEqual({
        authenticatedAs: 'service',
        principal: 'n8n',
        credentialId: 'n8n-e2e',
        scopes: ['service:identity'],
      });
    });

    it('a resposta nao traz token, hash nem identificador de usuario', async () => {
      const response = await identity(token).expect(200);
      const corpo = JSON.stringify(response.body);

      expect(corpo).not.toContain(token);
      expect(corpo).not.toMatch(/sha256|hash|userId|usuarioId|email/i);
    });
  });

  describe('B/C. token ausente ou invalido: 401, sempre a mesma resposta', () => {
    // Funcoes, porque `token` so existe depois do `beforeAll`.
    const invalidos: Array<[string, () => string | undefined]> = [
      ['ausente', () => undefined],
      ['vazio', () => ''],
      ['formato errado', () => 'qualquer-coisa'],
      ['formato certo mas desconhecido', () => `vfs_${'A'.repeat(43)}`],
      [
        'o token com um caractere trocado',
        () => `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`,
      ],
    ];

    it.each(invalidos)('%s', async (_nome, valor) => {
      const response = await identity(valor()).expect(401);

      expect((response.body as { message: string }).message).toBe(SERVICE_UNAUTHORIZED_MESSAGE);
    });

    it('todas as recusas tem corpo identico (nao revelam o motivo)', async () => {
      const corpos = await Promise.all(
        invalidos.map(async ([, valor]) => (await identity(valor()).expect(401)).body as unknown),
      );

      // Tudo igual, exceto o instante da resposta.
      const semInstante = corpos.map((c) =>
        JSON.stringify({ ...(c as object), timestamp: undefined }),
      );
      expect(new Set(semInstante).size).toBe(1);
    });

    it('cabecalho repetido nao autentica', async () => {
      await request(server())
        .get('/service/identity')
        .set('X-Service-Token', [token, token] as unknown as string)
        .expect(401);
    });
  });

  describe('E. JWT de pessoa na rota de servico', () => {
    it('Authorization: Bearer com JWT de ADMIN nao autentica', async () => {
      await request(server())
        .get('/service/identity')
        .set('Authorization', `Bearer ${humanToken}`)
        .expect(401);
    });

    it('nem o JWT de ADMIN junto de um X-Service-Token invalido', async () => {
      await request(server())
        .get('/service/identity')
        .set('Authorization', `Bearer ${humanToken}`)
        .set('X-Service-Token', `vfs_${'B'.repeat(43)}`)
        .expect(401);
    });

    it('o token de servico no lugar do Bearer tambem nao vale na rota de servico', async () => {
      await request(server())
        .get('/service/identity')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('F. token de servico em rota de pessoa', () => {
    // Controle positivo: com o JWT humano cada rota FUNCIONA. Sem isto, um 401
    // abaixo poderia ser so uma rota quebrada.
    const rotas: Array<[string, 'get' | 'post', string]> = [
      ['GET /auth/me', 'get', '/auth/me'],
      ['GET /users', 'get', '/users'],
      ['GET /finance/entries', 'get', '/finance/entries'],
      ['GET /audit-logs', 'get', '/audit-logs'],
      ['GET /settings', 'get', '/settings'],
      ['GET /dashboard/summary', 'get', '/dashboard/summary'],
      ['GET /documents', 'get', '/documents'],
    ];

    it.each(rotas)(
      'controle positivo: %s funciona com o JWT humano',
      async (_nome, metodo, caminho) => {
        await request(server())
          [metodo](caminho)
          .set('Authorization', `Bearer ${humanToken}`)
          .expect(200);
      },
    );

    it.each(rotas)('%s recusa o X-Service-Token', async (_nome, metodo, caminho) => {
      await request(server())[metodo](caminho).set('X-Service-Token', token).expect(401);
    });

    it.each(rotas)(
      '%s recusa o token de servico mesmo como Bearer',
      async (_nome, metodo, caminho) => {
        await request(server())
          [metodo](caminho)
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
      },
    );

    it('POST /commands/execute (a unica porta de comandos) recusa o servico', async () => {
      await request(server())
        .post('/commands/execute')
        .set('X-Service-Token', token)
        .send({ comando: 'ajuda' })
        .expect(401);
    });

    it('POST /finance/entries recusa o servico (nao ha permissao financeira)', async () => {
      await request(server())
        .post('/finance/entries')
        .set('X-Service-Token', token)
        .send({})
        .expect(401);
    });
  });

  describe('rotas publicas e de saude', () => {
    it('continuam abertas e nao pedem credencial de servico', async () => {
      await request(server()).get('/health').expect(200);
      await request(server()).get('/health/readiness').expect(200);
    });

    it('login de pessoa segue funcionando', async () => {
      await request(server()).post('/auth/login').send(ADMIN).expect(200);
    });
  });

  describe('o servico nao vira rota de pessoa nem o contrario (classificacao)', () => {
    interface Rota {
      readonly metodo: string;
      readonly caminho: string;
      readonly publica: boolean;
      readonly servico: boolean;
    }

    function rotas(): Rota[] {
      const reflector = new Reflector();
      const encontradas: Rota[] = [];
      for (const modulo of app.get(ModulesContainer, { strict: false }).values()) {
        for (const wrapper of modulo.controllers.values()) {
          const classe = wrapper.metatype;
          if (!classe) {
            continue;
          }
          const base = Reflect.getMetadata(PATH_METADATA, classe) as string | undefined;
          for (const nome of Object.getOwnPropertyNames(classe.prototype)) {
            const handler = Reflect.get(classe.prototype, nome) as unknown;
            if (typeof handler !== 'function') {
              continue;
            }
            const metodo = Reflect.getMetadata(METHOD_METADATA, handler) as
              RequestMethod | undefined;
            if (metodo === undefined) {
              continue;
            }
            const sub = Reflect.getMetadata(PATH_METADATA, handler) as string;
            encontradas.push({
              metodo: RequestMethod[metodo],
              caminho: `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(
                /\/+/g,
                '/',
              ),
              publica:
                reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
                  handler,
                  classe,
                ]) === true,
              servico:
                reflector.getAllAndOverride<boolean | undefined>(SERVICE_ROUTE_KEY, [
                  handler,
                  classe,
                ]) === true,
            });
          }
        }
      }
      return encontradas;
    }

    it('as rotas PUBLICAS sao exatamente as esperadas (qualquer nova exige decisao consciente)', () => {
      const publicas = rotas()
        .filter((r) => r.publica)
        .map((r) => `${r.metodo} ${r.caminho}`)
        .sort();

      expect(publicas).toEqual(
        ['GET /health', 'GET /health/readiness', 'POST /auth/login', 'POST /auth/register'].sort(),
      );
    });

    it('as rotas de SERVICO sao exatamente [GET /service/identity]', () => {
      const servico = rotas()
        .filter((r) => r.servico)
        .map((r) => `${r.metodo} ${r.caminho}`);

      expect(servico).toEqual(['GET /service/identity']);
    });

    it('nenhuma rota e publica E de servico ao mesmo tempo', () => {
      expect(rotas().filter((r) => r.publica && r.servico)).toEqual([]);
    });
  });

  describe('D. revogacao e rotacao (sem reiniciar a aplicacao)', () => {
    it('revogar a credencial passa a recusar o token depois do TTL', async () => {
      const usada = addCredential(estado, {
        id: 'n8n-revogavel',
        principal: 'n8n',
        now: new Date(),
      });
      gravar(usada.file);
      await esperar(PASSOU_O_TTL_MS);
      await identity(usada.token).expect(200);

      gravar(revokeCredential(estado, 'n8n-revogavel', new Date()));
      await esperar(PASSOU_O_TTL_MS);

      await identity(usada.token).expect(401);
      // A outra credencial nao foi afetada.
      await identity(token).expect(200);
    });

    it('rotacao: a nova passa a valer e a antiga continua valendo ate ser revogada', async () => {
      const nova = addCredential(estado, { id: 'n8n-nova', principal: 'n8n', now: new Date() });
      gravar(nova.file);
      await esperar(PASSOU_O_TTL_MS);

      await identity(nova.token).expect(200);
      await identity(token).expect(200);

      gravar(revokeCredential(estado, 'n8n-e2e', new Date()));
      await esperar(PASSOU_O_TTL_MS);

      await identity(token).expect(401);
      await identity(nova.token).expect(200);
      token = nova.token;
    });

    it('credencial expirada e recusada', async () => {
      const agora = new Date();
      const curta = addCredential(estado, {
        id: 'n8n-curta',
        principal: 'n8n',
        now: agora,
        expiresAt: new Date(agora.getTime() + 1500),
      });
      gravar(curta.file);
      await esperar(PASSOU_O_TTL_MS);
      await identity(curta.token).expect(200);

      await esperar(PASSOU_O_TTL_MS + 500);

      await identity(curta.token).expect(401);
    });
  });

  describe('fail-closed: arquivo de credenciais com problema', () => {
    it('arquivo corrompido nega TUDO, inclusive a credencial que era valida; ao consertar, volta', async () => {
      const bom = serializeCredentialsFile(estado);
      writeFileSync(arquivo, '{ corrompido');
      await esperar(PASSOU_O_TTL_MS);

      await identity(token).expect(401);

      writeFileSync(arquivo, bom);
      await esperar(PASSOU_O_TTL_MS);
      await identity(token).expect(200);
    });

    it('arquivo removido nega tudo', async () => {
      const bom = serializeCredentialsFile(estado);
      unlinkSync(arquivo);
      await esperar(PASSOU_O_TTL_MS);

      await identity(token).expect(401);

      writeFileSync(arquivo, bom);
      await esperar(PASSOU_O_TTL_MS);
      await identity(token).expect(200);
    });

    it('arquivo com campo desconhecido nega tudo (nao ignora o campo)', async () => {
      const bom = serializeCredentialsFile(estado);
      const adulterado = JSON.stringify({
        ...(JSON.parse(bom) as object),
        credentials: (JSON.parse(bom) as ServiceCredentialsFile).credentials.map((c) => ({
          ...c,
          statuss: 'revoked',
        })),
      });
      writeFileSync(arquivo, adulterado);
      await esperar(PASSOU_O_TTL_MS);

      await identity(token).expect(401);

      writeFileSync(arquivo, bom);
      await esperar(PASSOU_O_TTL_MS);
    });
  });

  describe('o token nunca aparece nos logs', () => {
    it('nem em sucesso, nem em recusa', async () => {
      const espioes = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((nivel) =>
        jest.spyOn(Logger.prototype, nivel).mockImplementation(() => undefined),
      );
      const falso = `vfs_${'C'.repeat(43)}`;

      try {
        await identity(token).expect(200);
        await identity(falso).expect(401);
        await identity(`${token}, ${token}`).expect(401);
        await request(server()).get('/auth/me').set('X-Service-Token', token).expect(401);

        const tudo = JSON.stringify(espioes.flatMap((e) => e.mock.calls));
        expect(tudo).not.toContain(token);
        expect(tudo).not.toContain(falso);
        // Controle positivo: o log da recusa EXISTE (senao o teste acima nada provaria).
        expect(tudo).toContain('Autenticacao de servico recusada');
      } finally {
        jest.restoreAllMocks();
      }
    });
  });
});
