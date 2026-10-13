import {
  FAKE_N8N_PORT,
  FAKE_TELEGRAM_PORT,
  RATE_LIMIT_E2E,
  TRANSPORT_KEY_E2E,
} from './support/telegram-transport-env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http, { type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CreatedLinkRequestResponseDto } from '../src/modules/external-identities/dto/link-request.dto';
import { TELEGRAM_RELAY_UNAVAILABLE_REPLY } from '../src/modules/integrations/telegram/telegram-relay.service';
import { TELEGRAM_RATE_LIMIT_REPLY } from '../src/modules/integrations/telegram/telegram-polling.service';
import { TelegramAdapter } from '../src/modules/integrations/telegram/telegram.adapter';
import { TELEGRAM_UNLINKED_REPLY } from '../src/modules/integrations/telegram/telegram-reply';
import { TelegramPollingService } from '../src/modules/integrations/telegram/telegram-polling.service';
import { RoleName } from '../src/modules/roles/role-name.enum';
import {
  addCredential,
  EMPTY_CREDENTIALS_FILE,
} from '../src/modules/service-auth/service-credentials.admin';
import { serializeCredentialsFile } from '../src/modules/service-auth/service-credentials.file';
import { UsersService } from '../src/modules/users/users.service';
import { startFakeBotApi, type FakeBotApi } from './fake-telegram/fake-bot-api';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const FAKE = `http://127.0.0.1:${String(FAKE_TELEGRAM_PORT)}`;

type N8nMode = 'ok' | 'tamper-reply' | 'tamper-envelope-chat' | 'identity-token' | 'extra-fields';

interface Sent {
  chat_id: string;
  text: string;
}

/**
 * O transporte do Telegram de ponta a ponta, SEM Telegram real:
 *
 *   Bot API FALSO -> polling REAL -> relay REAL -> "n8n" falso (HTTP) -> /service/telegram/ingest
 *   REAL -> identidade + RBAC + Command Engine -> resposta assinada -> relay -> sendMessage no
 *   Bot API FALSO.
 *
 * O "n8n" falso reproduz o workflow versionado (repassa SO envelope+assinatura com o token do
 * principal n8n-telegram; qualquer resposta nao-200 vira `{"outcome":"UNAVAILABLE"}`) e tem modos
 * MALICIOSOS para provar que adulterar o caminho nunca chega ao usuario. Usuarios, ids,
 * mensagens e tokens sao ficticios; nada sai da maquina.
 */
describe('Transporte do Telegram, ponta a ponta com Bot API falso (e2e)', () => {
  let app: INestApplication;
  let fake: FakeBotApi;
  let n8n: HttpServer | null = null;
  let appPort: number;
  let dir: string;
  let tokenIngest: string;
  let tokenIdentity: string;
  let adminJwt: string;
  let adminTg: string;
  let operadorTg: string;
  let n8nMode: N8nMode = 'ok';
  let n8nCalls = 0;
  let tgSeq = 820_000_000;
  let polling: TelegramPollingService;
  const logs: string[] = [];

  const novoTg = (): string => String(++tgSeq);
  const nowSec = (): number => Math.floor(Date.now() / 1000);

  async function control(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${FAKE}/__control/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  const sent = async (): Promise<Sent[]> => (await control('sent')).sent as Sent[];
  const state = async (): Promise<Record<string, number>> =>
    (await control('state')) as unknown as Record<string, number>;

  function mensagem(
    from: string,
    text: string,
    extra: Record<string, unknown> = {},
    date = nowSec(),
    updateId?: number,
  ): Record<string, unknown> {
    const id = Number(from);
    return {
      ...(updateId === undefined ? {} : { update_id: updateId }),
      message: {
        message_id: 1,
        date,
        chat: { id, type: 'private' },
        from: { id, is_bot: false },
        text,
        ...extra,
      },
    };
  }

  async function enviar(update: Record<string, unknown>): Promise<void> {
    await control('enqueue', { update });
  }

  async function esperar<T>(
    lido: () => Promise<T>,
    pronto: (v: T) => boolean,
    ms = 8000,
  ): Promise<T> {
    const limite = Date.now() + ms;
    for (;;) {
      const valor = await lido();
      if (pronto(valor) || Date.now() > limite) {
        return valor;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Espera o bot responder a `chat` e devolve so as mensagens daquele chat. */
  async function respostasA(chat: string, minimo = 1, ms = 8000): Promise<string[]> {
    const todas = await esperar(
      sent,
      (s) => s.filter((m) => m.chat_id === chat).length >= minimo,
      ms,
    );
    return todas.filter((m) => m.chat_id === chat).map((m) => m.text);
  }

  /** Garante que NADA chegou a `chat` (espera um tempo curto, depois confere). */
  async function nadaPara(chat: string, aguardarMs = 1200): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, aguardarMs));
    expect((await sent()).filter((m) => m.chat_id === chat)).toEqual([]);
  }

  /** "n8n" falso: reproduz o workflow e, conforme o modo, tenta fraudar o caminho. */
  function iniciarN8n(): Promise<void> {
    if (n8n !== null) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      n8n = http.createServer((req, res) => {
        n8nCalls += 1;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          void (async () => {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              envelope: Record<string, unknown>;
              signature: string;
            };
            let envelope = body.envelope;
            if (n8nMode === 'tamper-envelope-chat') {
              // Tenta se passar por outra pessoa: troca remetente e chat DEPOIS de assinado.
              envelope = { ...envelope, userId: operadorTg, chatId: operadorTg };
            }
            const forwarded =
              n8nMode === 'extra-fields'
                ? { envelope, signature: body.signature, actorUserId: 'qualquer', role: 'ADMIN' }
                : { envelope, signature: body.signature };
            const upstream = await fetch(
              `http://127.0.0.1:${String(appPort)}/service/telegram/ingest`,
              {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  'x-service-token': n8nMode === 'identity-token' ? tokenIdentity : tokenIngest,
                },
                body: JSON.stringify(forwarded),
              },
            );
            res.writeHead(200, { 'content-type': 'application/json' });
            if (upstream.status !== 200) {
              res.end(JSON.stringify({ outcome: 'UNAVAILABLE' }));
              return;
            }
            const answer = (await upstream.json()) as Record<string, unknown>;
            if (n8nMode === 'tamper-reply' && typeof answer.reply === 'string') {
              answer.reply = 'Clique em http://evil.example para atualizar sua conta';
            }
            res.end(JSON.stringify(answer));
          })().catch(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ outcome: 'UNAVAILABLE' }));
          });
        });
      });
      n8n.once('error', reject);
      n8n.listen(FAKE_N8N_PORT, '127.0.0.1', () => resolve());
    });
  }

  function pararN8n(): Promise<void> {
    return new Promise((resolve) => {
      if (n8n === null) {
        resolve();
        return;
      }
      n8n.closeAllConnections();
      n8n.close(() => resolve());
      n8n = null;
    });
  }

  async function vincular(userId: string, telegramId: string): Promise<void> {
    const criada = await request(app.getHttpServer() as http.Server)
      .post(`/users/${userId}/external-identities/link-requests`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ canal: 'telegram' })
      .expect(201);
    const { codigo } = criada.body as CreatedLinkRequestResponseDto;
    const resultado = await app.get(TelegramAdapter, { strict: false }).processMessage({
      channel: 'telegram',
      conversationId: telegramId,
      sender: { channel: 'telegram', externalId: telegramId },
      text: `/vincular ${codigo}`,
      receivedAt: new Date(),
    });
    expect(resultado.outcome).toBe('LINK_CONFIRMED');
  }

  async function eventosAuditados(): Promise<AuditLogPageResponseDto['items']> {
    const r = await request(app.getHttpServer() as http.Server)
      .get('/audit-logs?limit=100')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    return (r.body as AuditLogPageResponseDto).items.filter((i) => i.acao === 'CHANNEL_MESSAGE');
  }

  beforeAll(async () => {
    for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    fake = await startFakeBotApi({ port: FAKE_TELEGRAM_PORT, host: '127.0.0.1' });

    dir = mkdtempSync(join(tmpdir(), 'vf-transport-e2e-'));
    const a = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-telegram-t',
      principal: 'n8n-telegram',
      now: new Date(),
    });
    tokenIngest = a.token;
    const b = addCredential(a.file, { id: 'n8n-t', principal: 'n8n', now: new Date() });
    tokenIdentity = b.token;
    const arquivo = join(dir, 'credentials.json');
    writeFileSync(arquivo, serializeCredentialsFile(b.file));
    process.env.SERVICE_CREDENTIALS_FILE = arquivo;

    app = await createTestApp();
    await (app as NestExpressApplication).listen(0, '127.0.0.1');
    appPort = ((app.getHttpServer() as http.Server).address() as { port: number }).port;
    polling = app.get(TelegramPollingService, { strict: false });

    const login = await request(app.getHttpServer() as http.Server)
      .post('/auth/login')
      .send(ADMIN)
      .expect(200);
    adminJwt = (login.body as AuthResponseDto).accessToken;
    const adminId = (login.body as AuthResponseDto).user.id;
    const operador = await app.get(UsersService, { strict: false }).create({
      nome: 'Operador T',
      email: 'operador@transporte.test',
      senha: SENHA,
      role: RoleName.Operador,
    });

    adminTg = novoTg();
    operadorTg = novoTg();
    await vincular(adminId, adminTg);
    await vincular(operador.id, operadorTg);
    await iniciarN8n();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await pararN8n();
    await app.close();
    await fake.close();
    delete process.env.SERVICE_CREDENTIALS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    n8nMode = 'ok';
    n8nCalls = 0;
    await control('reset', {});
    if (n8n === null) {
      await iniciarN8n();
    }
  });

  it('o polling esta ligado, e e UM so consumidor (nenhum conflito de getUpdates)', async () => {
    expect(polling.isRunning()).toBe(true);
    await enviar(mensagem(adminTg, '/ajuda'));
    await respostasA(adminTg);

    expect((await state()).conflicts).toBe(0);
  });

  describe('A-C. identidade e autorizacao, resposta no MESMO chat', () => {
    it('A. vinculado e autorizado: /ajuda responde no chat de origem e em nenhum outro', async () => {
      await enviar(mensagem(adminTg, '/ajuda'));

      const respostas = await respostasA(adminTg);

      expect(respostas).toHaveLength(1);
      expect(respostas[0]).toContain('Comandos disponiveis');
      expect(respostas[0]).toContain('/financeiro');
      expect((await sent()).map((m) => m.chat_id)).toEqual([adminTg]);
    });

    it('B. nao vinculado: resposta segura, sem executar comando', async () => {
      const estranho = novoTg();
      await enviar(mensagem(estranho, '/financeiro'));

      expect(await respostasA(estranho)).toEqual([TELEGRAM_UNLINKED_REPLY]);
    });

    it('C. sem permissao: /financeiro negado ao OPERADOR; a ajuda dele nao lista o comando', async () => {
      await enviar(mensagem(operadorTg, '/financeiro'));
      expect((await respostasA(operadorTg))[0]).toContain('nao tem permissao');

      await control('reset', {});
      await enviar(mensagem(operadorTg, '/ajuda'));
      const ajuda = (await respostasA(operadorTg))[0] ?? '';
      expect(ajuda).not.toContain('/financeiro');
      expect(ajuda).not.toContain('/contas_pagar');
    });
  });

  describe('D. mensagem duplicada', () => {
    it('re-entrega do MESMO update (o que o Telegram faz apos uma queda): nao executa e nao responde de novo', async () => {
      const id = 700_001;
      await enviar(mensagem(adminTg, '/status', {}, nowSec(), id));
      await respostasA(adminTg);
      const antes = (await eventosAuditados()).length;

      // Reinicia o consumo (offset volta a zero, como apos um restart) e re-entrega o update.
      await polling.stop();
      // Um reinicio de PROCESSO perde o offset em memoria; e por isso que o Telegram reentrega.
      (polling as unknown as { offset: number | undefined }).offset = undefined;
      await control('redeliver', { update_id: id });
      polling.start();
      await esperar(
        () => n8nCallsAsync(),
        (n) => n >= 2,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect((await sent()).filter((m) => m.chat_id === adminTg)).toHaveLength(1);
      const depois = await eventosAuditados();
      expect(depois.length - antes).toBe(1);
      expect(
        depois.filter((e) => e.metadados?.resultado === 'DUPLICATE').length,
      ).toBeGreaterThanOrEqual(1);
      expect((await state()).conflicts).toBe(0);
    });
  });

  describe('E. atualizacoes simultaneas', () => {
    it('cada usuario recebe SO a propria resposta, no proprio chat', async () => {
      const estranho = novoTg();
      await control('enqueue', {
        updates: [
          mensagem(adminTg, '/status'),
          mensagem(operadorTg, '/ajuda'),
          mensagem(estranho, '/ajuda'),
        ],
      });

      const todas = await esperar(sent, (s) => s.length >= 3);

      const porChat = Object.fromEntries(todas.map((m) => [m.chat_id, m.text]));
      expect(Object.keys(porChat).sort()).toEqual([adminTg, operadorTg, estranho].sort());
      expect(porChat[adminTg]).toContain('Motor de comandos operacional');
      expect(porChat[operadorTg]).toContain('Comandos disponiveis');
      expect(porChat[operadorTg]).not.toContain('/financeiro');
      expect(porChat[estranho]).toBe(TELEGRAM_UNLINKED_REPLY);
    });
  });

  describe('F. n8n indisponivel', () => {
    it('falha segura: aviso fixo ao PROPRIO chat, nada executado', async () => {
      await pararN8n();
      await enviar(mensagem(adminTg, '/financeiro'));

      expect(await respostasA(adminTg)).toEqual([TELEGRAM_RELAY_UNAVAILABLE_REPLY]);
    });

    it('depois que o n8n volta, o fluxo normal retoma', async () => {
      await iniciarN8n().catch(() => undefined);
      await enviar(mensagem(adminTg, '/ajuda'));

      expect((await respostasA(adminTg))[0]).toContain('Comandos disponiveis');
    });
  });

  describe('H-I-L. caminho adulterado nunca chega ao usuario', () => {
    it('H. n8n altera o TEXTO da resposta: o texto adulterado nunca e enviado', async () => {
      n8nMode = 'tamper-reply';
      await enviar(mensagem(adminTg, '/ajuda'));

      const respostas = await respostasA(adminTg);

      expect(respostas).toEqual([TELEGRAM_RELAY_UNAVAILABLE_REPLY]);
      expect(JSON.stringify(await sent())).not.toContain('evil.example');
    });

    it('I. n8n troca remetente e chat (se passar pelo OPERADOR): recusado; ninguem recebe a resposta do outro', async () => {
      n8nMode = 'tamper-envelope-chat';
      await enviar(mensagem(adminTg, '/ajuda'));

      expect(await respostasA(adminTg)).toEqual([TELEGRAM_RELAY_UNAVAILABLE_REPLY]);
      await nadaPara(operadorTg);
      const rejeitados = (await eventosAuditados()).filter(
        (e) => e.metadados?.resultado === 'ENVELOPE_REJECTED',
      );
      expect(rejeitados.length).toBeGreaterThan(0);
    });

    it('n8n acrescenta actorUserId/role ao corpo: rejeitado (400), nada executa', async () => {
      n8nMode = 'extra-fields';
      await enviar(mensagem(adminTg, '/financeiro'));

      expect(await respostasA(adminTg)).toEqual([TELEGRAM_RELAY_UNAVAILABLE_REPLY]);
    });

    it('L. token de servico com escopo incorreto (principal n8n): acesso negado', async () => {
      n8nMode = 'identity-token';
      await enviar(mensagem(adminTg, '/financeiro'));

      expect(await respostasA(adminTg)).toEqual([TELEGRAM_RELAY_UNAVAILABLE_REPLY]);
    });
  });

  describe('J. mensagens que nao viram comando', () => {
    it.each([
      ['encaminhada', { forward_origin: { type: 'user', date: 1 } }],
      ['via outro bot', { via_bot: { id: 8, is_bot: true } }],
    ])('%s: ignorada, sem n8n e sem resposta', async (_nome, extra) => {
      await enviar(mensagem(adminTg, '/financeiro', extra));
      await enviar(mensagem(adminTg, '/ajuda')); // controle positivo: a seguinte e atendida

      const respostas = await respostasA(adminTg);

      expect(respostas).toHaveLength(1);
      expect(respostas[0]).toContain('Comandos disponiveis');
      expect(n8nCalls).toBe(1);
    });

    it('grupo: ignorado', async () => {
      await enviar({
        message: {
          message_id: 1,
          date: nowSec(),
          chat: { id: -100, type: 'group' },
          from: { id: Number(adminTg), is_bot: false },
          text: '/ajuda',
        },
      });
      await enviar(mensagem(adminTg, '/status'));

      await respostasA(adminTg);
      expect(n8nCalls).toBe(1);
    });
  });

  describe('K. Plantae desabilitado', () => {
    it('/contas_pagar: nenhuma chamada externa e nenhuma resposta que sugira dados atualizados', async () => {
      const externo = jest.spyOn(globalThis, 'fetch');
      await enviar(mensagem(adminTg, '/contas_pagar'));

      const resposta = (await respostasA(adminTg))[0] ?? '';

      expect(resposta).toContain('integracao com o Plantae esta desativada');
      expect(resposta).not.toMatch(/R\$|Contas a pagar pendentes|Vencimento/);
      const urls = externo.mock.calls.map(([input]) =>
        String(input instanceof Request ? input.url : input),
      );
      expect(urls.filter((u) => /plantae|api\.telegram\.org/.test(u))).toEqual([]);
      externo.mockRestore();
    });
  });

  describe('mensagens antigas e abuso', () => {
    it('mensagem com 20 minutos (reentrega apos queda): descartada, sem execucao e sem resposta', async () => {
      await enviar(mensagem(adminTg, '/financeiro', {}, nowSec() - 20 * 60));
      await nadaPara(adminTg);

      expect(n8nCalls).toBe(0);
    });

    it('limite por remetente: excesso descartado em silencio apos UM aviso; outro usuario nao e afetado', async () => {
      const barulhento = novoTg();
      await control('enqueue', {
        updates: Array.from({ length: RATE_LIMIT_E2E + 3 }, () => mensagem(barulhento, '/ajuda')),
      });
      await enviar(mensagem(adminTg, '/status'));

      const dele = await respostasA(barulhento, RATE_LIMIT_E2E + 1, 20_000);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const todas = (await sent()).filter((m) => m.chat_id === barulhento).map((m) => m.text);

      expect(dele.length).toBeGreaterThanOrEqual(RATE_LIMIT_E2E + 1);
      expect(todas.filter((t) => t === TELEGRAM_RATE_LIMIT_REPLY)).toHaveLength(1);
      expect(todas.filter((t) => t === TELEGRAM_UNLINKED_REPLY)).toHaveLength(RATE_LIMIT_E2E);
      expect((await respostasA(adminTg))[0]).toContain('Motor de comandos operacional');
    });
  });

  describe('privacidade', () => {
    it('nenhum log traz texto de mensagem, resposta, id do Telegram, token ou chave', async () => {
      const marca = `SENTINELA-${String(Date.now())}`;
      await enviar(mensagem(adminTg, `/financeiro ${marca}`));
      await respostasA(adminTg);

      const tudo = logs.join('\n');
      for (const proibido of [
        marca,
        adminTg,
        operadorTg,
        TRANSPORT_KEY_E2E,
        tokenIngest,
        tokenIdentity,
        '999000111:AAFAKE',
      ]) {
        expect(tudo).not.toContain(proibido);
      }
      expect(JSON.stringify(await eventosAuditados())).not.toContain(marca);

      // Auditoria INTEIRA (inclui o PLANTAE_QUERIED do /contas_pagar do cenario K): so a trilha
      // administrativa do VINCULO guarda o id externo, de proposito.
      const tudo2 = await request(app.getHttpServer() as http.Server)
        .get('/audit-logs?limit=100')
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);
      const semVinculo = (tudo2.body as AuditLogPageResponseDto).items.filter(
        (i) => !i.acao.startsWith('EXTERNAL_IDENTITY'),
      );
      expect(semVinculo.some((i) => i.acao === 'PLANTAE_QUERIED')).toBe(true);
      expect(JSON.stringify(semVinculo)).not.toContain(adminTg);
    });
  });

  function n8nCallsAsync(): Promise<number> {
    return Promise.resolve(n8nCalls);
  }
});
