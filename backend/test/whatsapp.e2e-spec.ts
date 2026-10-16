import {
  FAKE_GRAPH_PORT,
  WA_ACCESS_TOKEN,
  WA_APP_SECRET,
  WA_PHONE_NUMBER_ID,
  WA_WEBHOOK_TOKEN,
} from './support/whatsapp-env';
import { createHmac } from 'node:crypto';
import http, { type Server } from 'node:http';
import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CreatedLinkRequestResponseDto } from '../src/modules/external-identities/dto/link-request.dto';
import { WHATSAPP_REPLIES } from '../src/modules/integrations/whatsapp/whatsapp-message.processor';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const ROTA = '/webhooks/whatsapp';
const NUMERO = '5511999990001';
const OUTRO = '5511999990002';

interface Enviada {
  to: string;
  body: string;
  auth: string;
}

/**
 * Webhook do WhatsApp (Cloud API) na aplicacao COMPLETA, com Graph API FALSA e assinatura REAL
 * (HMAC-SHA256 sobre o corpo bruto). Numeros, tokens e segredos sao ficticios.
 */
describe('WhatsApp - webhook da Cloud API (e2e)', () => {
  let app: INestApplication;
  let graph: Server;
  let enviadas: Enviada[] = [];
  let adminJwt: string;
  let operadorId: string;
  let seq = 0;
  const logs: string[] = [];

  const server = (): http.Server => app.getHttpServer() as http.Server;

  function payload(
    texto: string,
    over: Record<string, unknown> = {},
    from = NUMERO,
    phoneId = WA_PHONE_NUMBER_ID,
  ): object {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5511000000000', phone_number_id: phoneId },
                contacts: [{ profile: { name: 'Pessoa Ficticia' }, wa_id: from }],
                messages: [
                  {
                    from,
                    id: `wamid.TESTE${String(++seq)}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: texto },
                    ...over,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  const assinar = (corpo: string, segredo = WA_APP_SECRET): string =>
    `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;

  /** Entrega o webhook como a Meta faria: corpo bruto + X-Hub-Signature-256. */
  function entregar(
    objeto: object,
    opcoes: { segredo?: string; semAssinatura?: boolean } = {},
  ): request.Test {
    const corpo = JSON.stringify(objeto);
    const req = request(server()).post(ROTA).set('Content-Type', 'application/json');
    if (opcoes.semAssinatura !== true) {
      req.set('X-Hub-Signature-256', assinar(corpo, opcoes.segredo));
    }
    return req.send(corpo);
  }

  const respostaPara = (numero: string): string[] =>
    enviadas.filter((e) => e.to === numero).map((e) => e.body);

  async function auditoria(): Promise<AuditLogPageResponseDto['items']> {
    const r = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    return (r.body as AuditLogPageResponseDto).items.filter(
      (i) => i.acao === 'CHANNEL_MESSAGE' && i.metadados?.canal === 'whatsapp',
    );
  }

  beforeAll(async () => {
    for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    graph = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const dados = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          to: string;
          text: { body: string };
        };
        enviadas.push({
          to: dados.to,
          body: dados.text.body,
          auth: String(req.headers.authorization),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"messages":[{"id":"wamid.OUT"}]}');
      });
    });
    await new Promise<void>((resolve) => graph.listen(FAKE_GRAPH_PORT, '127.0.0.1', resolve));

    app = await createTestApp();
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminJwt = (login.body as AuthResponseDto).accessToken;
    const operador = await app.get(UsersService, { strict: false }).create({
      nome: 'Operador WA',
      email: 'operador@whatsapp.test',
      senha: 'Senha1234',
      role: RoleName.Operador,
    });
    operadorId = operador.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    graph.closeAllConnections();
    await new Promise<void>((resolve) => graph.close(() => resolve()));
  });

  beforeEach(() => {
    enviadas = [];
  });

  describe('GET - verificacao do webhook', () => {
    const consulta = (q: Record<string, string>): request.Test =>
      request(server()).get(ROTA).query(q);

    it('token correto: devolve o desafio em texto simples', async () => {
      const r = await consulta({
        'hub.mode': 'subscribe',
        'hub.verify_token': WA_WEBHOOK_TOKEN,
        'hub.challenge': '1158201444',
      }).expect(200);

      expect(r.text).toBe('1158201444');
      expect(r.headers['content-type']).toContain('text/plain');
    });

    it.each([
      [
        'token errado',
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'errado-errado-errado-errado',
          'hub.challenge': '1',
        },
      ],
      ['sem token', { 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
      [
        'desafio com HTML',
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': WA_WEBHOOK_TOKEN,
          'hub.challenge': '<b>x</b>',
        },
      ],
    ])('%s: 403', async (_nome, q) => {
      await consulta(q).expect(403);
    });
  });

  describe('POST - autenticidade (a Meta assina o corpo)', () => {
    it.each([
      ['sem assinatura', { semAssinatura: true }],
      ['assinada com outro segredo', { segredo: 'outro-segredo-qualquer-0123456789' }],
    ])('%s: 403 e NADA e processado nem enviado', async (_nome, opcoes) => {
      await entregar(payload('/ajuda'), opcoes).expect(403);

      expect(enviadas).toEqual([]);
      expect(await auditoria()).toEqual([]);
    });

    it('corpo alterado depois de assinado: 403', async () => {
      const corpo = JSON.stringify(payload('/ajuda'));
      await request(server())
        .post(ROTA)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', assinar(corpo))
        .send(corpo.replace('/ajuda', '/status'))
        .expect(403);
      expect(enviadas).toEqual([]);
    });
  });

  describe('numero NAO vinculado', () => {
    it('fica em SILENCIO (nada executa e nada e enviado), como um cliente comum da empresa', async () => {
      await entregar(payload('/financeiro')).expect(200);
      await entregar(payload('Oi, tudo bem?')).expect(200);

      // Padrao (WHATSAPP_REPLY_TO_UNLINKED=false): desconhecido nao recebe NADA, mas a tentativa e auditada.
      expect(respostaPara(NUMERO)).toEqual([]);
    });

    it('a resposta (ao comando explicito /vincular) usa o token so no cabecalho', async () => {
      await entregar(payload('/vincular CODIGOINVALIDO')).expect(200);

      expect(enviadas[0]?.auth).toBe(`Bearer ${WA_ACCESS_TOKEN}`);
    });
  });

  describe('vinculo, identidade e RBAC', () => {
    it('vincula o numero por codigo (prova de posse) e depois executa /ajuda e nega /financeiro ao OPERADOR', async () => {
      const criada = await request(server())
        .post(`/users/${operadorId}/external-identities/link-requests`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ canal: 'whatsapp' })
        .expect(201);
      const { codigo } = criada.body as CreatedLinkRequestResponseDto;

      await entregar(payload(`/vincular ${codigo}`)).expect(200);
      expect(respostaPara(NUMERO)).toEqual([WHATSAPP_REPLIES.linked]);

      enviadas = [];
      await entregar(payload('/ajuda')).expect(200);
      expect(respostaPara(NUMERO)[0]).toContain('Comandos disponiveis');
      expect(respostaPara(NUMERO)[0]).not.toContain('/financeiro');

      enviadas = [];
      await entregar(payload('/financeiro')).expect(200);
      expect(respostaPara(NUMERO)[0]).toContain('nao tem permissao');
    });

    it('o codigo nao serve para outro numero (ja usado)', async () => {
      await entregar(payload('/vincular ABCD-EFGH-JKLM', {}, OUTRO)).expect(200);

      expect(respostaPara(OUTRO)).toEqual([WHATSAPP_REPLIES.linkRejected]);
    });

    it('a auditoria registra a PESSOA e o canal, sem texto nem numero', async () => {
      const eventos = await auditoria();

      expect(
        eventos.some((e) => e.usuarioId === operadorId && e.metadados?.resultado === 'DENIED'),
      ).toBe(true);
      const bruto = JSON.stringify(eventos);
      expect(bruto).not.toContain(NUMERO);
      expect(bruto).not.toContain('Pessoa Ficticia');
    });
  });

  describe('idempotencia e protecoes', () => {
    it('a Meta reentrega o MESMO wamid: executa e responde UMA vez', async () => {
      const mensagem = payload('/status');
      await entregar(mensagem).expect(200);
      await entregar(mensagem).expect(200);
      await entregar(mensagem).expect(200);

      expect(respostaPara(NUMERO)).toHaveLength(1);
    });

    it('entregas simultaneas do mesmo wamid: uma executa', async () => {
      const mensagem = payload('/status');

      await Promise.all(Array.from({ length: 5 }, () => entregar(mensagem).expect(200)));

      expect(respostaPara(NUMERO)).toHaveLength(1);
    });

    it.each([
      ['imagem', { type: 'image', image: { id: 'x' } }],
      ['documento', { type: 'document', document: { id: 'x' } }],
      ['encaminhada', { context: { forwarded: true } }],
    ])('%s: ignorada, sem resposta', async (_nome, over) => {
      await entregar(payload('/ajuda', over)).expect(200);

      expect(enviadas).toEqual([]);
    });

    it('mensagem de OUTRO phone_number_id: ignorada', async () => {
      await entregar(payload('/ajuda', {}, NUMERO, '999888777')).expect(200);

      expect(enviadas).toEqual([]);
    });

    it('mensagem antiga (20 min): descartada sem executar', async () => {
      await entregar(
        payload('/ajuda', { timestamp: String(Math.floor(Date.now() / 1000) - 20 * 60) }),
      ).expect(200);

      expect(enviadas).toEqual([]);
    });

    it('status de entrega e payload estranho: 200 sem efeito', async () => {
      await entregar({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: WA_PHONE_NUMBER_ID },
                  statuses: [{ id: 'x', status: 'delivered' }],
                },
              },
            ],
          },
        ],
      }).expect(200);
      await entregar({ object: 'outra-coisa' }).expect(200);

      expect(enviadas).toEqual([]);
    });
  });

  describe('privacidade', () => {
    it('nenhum log traz token, segredo, numero ou texto de mensagem', () => {
      const tudo = logs.join('\n');

      for (const proibido of [
        WA_ACCESS_TOKEN,
        WA_APP_SECRET,
        WA_WEBHOOK_TOKEN,
        NUMERO,
        OUTRO,
        '/financeiro',
        'Pessoa Ficticia',
      ]) {
        expect(tudo).not.toContain(proibido);
      }
    });
  });
});
