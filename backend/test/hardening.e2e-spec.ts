import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { HealthResponseDto } from '../src/modules/health/dto/health-response.dto';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };

/**
 * Hardening de producao (Fase A).
 *
 * Cobre o que depende do pipeline HTTP completo: limite de corpo, resolucao de
 * IP atras de proxy e readiness do banco. As regras que dependem de
 * `NODE_ENV=production` ficam nos testes de unidade - o e2e sobe a aplicacao
 * uma unica vez, com `NODE_ENV=test` fixado em `setup-env.ts`, e trocar o
 * ambiente no meio invalidaria o seed e as demais suites.
 */
describe('Hardening de producao (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (token: string): string => `Bearer ${token}`;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource, { strict: false });
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminToken = (login.body as AuthResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('limite de corpo da requisicao', () => {
    it('payload normal e aceito', async () => {
      await request(server())
        .post('/finance/entries')
        .set('Authorization', bearer(adminToken))
        .send({
          tipo: 'DESPESA',
          descricao: 'Compra dentro do limite',
          valor: 10.5,
          data: '2026-01-10',
          categoria: 'Insumos',
        })
        .expect(201);
    });

    it('payload acima do limite e recusado', async () => {
      // 200 kB contra um limite de 100 kB.
      const resposta = await request(server())
        .post('/auth/login')
        .send({ email: 'a@b.test', senha: 'x'.repeat(200 * 1024) });

      expect(resposta.status).toBeGreaterThanOrEqual(400);
      expect(resposta.status).toBe(413);
    });

    it('a recusa por tamanho nao expoe stack trace nem o conteudo enviado', async () => {
      const marcador = 'SEGREDO-NO-CORPO';
      const resposta = await request(server())
        .post('/auth/login')
        .send({ email: 'a@b.test', senha: `${marcador}${'x'.repeat(200 * 1024)}` });

      const corpo = JSON.stringify(resposta.body);
      expect(corpo).not.toContain(marcador);
      expect(corpo).not.toMatch(/at |\.ts:|\.js:|node_modules/);
    });

    it('rotas existentes continuam funcionando depois do limite', async () => {
      await request(server()).get('/auth/me').set('Authorization', bearer(adminToken)).expect(200);
      await request(server())
        .get('/finance/entries')
        .set('Authorization', bearer(adminToken))
        .expect(200);
    });
  });

  describe('IP do cliente atras de proxy', () => {
    /** Ids de LOGIN ja presentes na trilha. */
    async function loginsRegistrados(): Promise<Map<string, string | null>> {
      const resposta = await request(server())
        .get('/audit-logs')
        .query({ limit: '100' })
        .set('Authorization', bearer(adminToken))
        .expect(200);
      const pagina = resposta.body as AuditLogPageResponseDto;
      return new Map(
        pagina.items.filter((item) => item.acao === 'LOGIN').map((item) => [item.id, item.ip]),
      );
    }

    /**
     * Faz login e devolve o IP do registro NOVO de auditoria.
     *
     * Identifica o registro pelo id que ainda nao existia, e nao pela posicao
     * na lista: varios logins deste arquivo caem no mesmo instante e o
     * desempate entre eles e um UUID, portanto a ordem nao e previsivel.
     */
    async function ipDoProximoLogin(forwardedFor?: string): Promise<string | null> {
      const antes = await loginsRegistrados();

      const login = request(server()).post('/auth/login');
      if (forwardedFor !== undefined) {
        login.set('X-Forwarded-For', forwardedFor);
      }
      await login.send(ADMIN).expect(200);

      const depois = await loginsRegistrados();
      const novos = [...depois.entries()].filter(([id]) => !antes.has(id));
      expect(novos).toHaveLength(1);
      return novos[0][1];
    }

    it('com X-Forwarded-For, a auditoria registra o IP do cliente', async () => {
      // Sem `trust proxy`, aqui apareceria o endereco da conexao (o proxy).
      expect(await ipDoProximoLogin('203.0.113.7')).toBe('203.0.113.7');
    });

    it('sem o header, registra o endereco da propria conexao', async () => {
      const ip = await ipDoProximoLogin();

      expect(ip).not.toBe('203.0.113.7');
      expect(typeof ip).toBe('string');
      expect(ip).not.toBe('');
    });

    it('com cadeia de proxies, confia apenas no salto mais proximo', async () => {
      // `trust proxy: 1` le o ULTIMO endereco da cadeia - o que o proxy
      // confiavel acrescentou. Os anteriores vem do cliente e poderiam ser
      // inventados, entao sao ignorados.
      const ip = await ipDoProximoLogin('198.51.100.1, 203.0.113.9');

      expect(ip).toBe('203.0.113.9');
      expect(ip).not.toBe('198.51.100.1');
    });
  });

  describe('readiness do banco', () => {
    it('GET /health/readiness responde 200 com o banco disponivel', async () => {
      const resposta = await request(server()).get('/health/readiness').expect(200);
      const corpo = resposta.body as HealthResponseDto;

      expect(corpo.status).toBe('ok');
      expect(corpo.service).toBe('vasta-flow');
      expect(corpo.checks?.database?.status).toBe('ok');
    });

    it('e publico, como o liveness', async () => {
      await request(server()).get('/health/readiness').expect(200);
    });

    it('banco indisponivel: responde 503', async () => {
      const espiao = jest
        .spyOn(dataSource, 'query')
        .mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:3306 user=vastaflow'));
      try {
        const resposta = await request(server()).get('/health/readiness').expect(503);
        const corpo = resposta.body as HealthResponseDto;

        expect(corpo.status).toBe('down');
        expect(corpo.checks?.database?.status).toBe('down');
      } finally {
        espiao.mockRestore();
      }
    });

    it('banco indisponivel: a resposta nao expoe host, usuario nem stack trace', async () => {
      const espiao = jest
        .spyOn(dataSource, 'query')
        .mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:3306 user=vastaflow senha=abc'));
      try {
        const resposta = await request(server()).get('/health/readiness').expect(503);

        const corpo = JSON.stringify(resposta.body);
        expect(corpo).not.toContain('10.0.0.5');
        expect(corpo).not.toContain('vastaflow');
        expect(corpo).not.toContain('senha');
        expect(corpo).not.toMatch(/at |\.ts:|\.js:/);
      } finally {
        espiao.mockRestore();
      }
    });

    it('banco indisponivel: o LIVENESS continua respondendo 200', async () => {
      const espiao = jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('indisponivel'));
      try {
        // O processo esta vivo: reiniciar nao resolveria uma queda de banco.
        const resposta = await request(server()).get('/health').expect(200);

        expect((resposta.body as HealthResponseDto).status).toBe('ok');
      } finally {
        espiao.mockRestore();
      }
    });

    it('readiness nao verifica integracao externa', async () => {
      const resposta = await request(server()).get('/health/readiness').expect(200);
      const corpo = resposta.body as HealthResponseDto;

      // Indisponibilidade de fornecedor nao deve tirar o VastaFlow do ar.
      expect(Object.keys(corpo.checks ?? {})).toEqual(['database']);
    });

    it('o liveness mantem o contrato anterior, sem checks', async () => {
      const resposta = await request(server()).get('/health').expect(200);

      expect(resposta.body).toEqual({ status: 'ok', service: 'vasta-flow' });
    });
  });

  describe('cadastro publico fora de producao', () => {
    it('segue disponivel no ambiente de teste', async () => {
      // O bloqueio vale em producao; aqui o fluxo existente continua valendo, e
      // e isso que as demais suites exercitam.
      await request(server())
        .post('/auth/register')
        .send({ nome: 'Novo Usuario', email: 'novo-hardening@vasta.test', senha: 'Senha1234' })
        .expect(201);
    });
  });
});
