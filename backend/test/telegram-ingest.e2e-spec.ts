import { INGEST_KEY_E2E } from './support/telegram-ingest-env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { ExternalIdentityResponseDto } from '../src/modules/external-identities/dto/external-identity-response.dto';
import type { CreatedLinkRequestResponseDto } from '../src/modules/external-identities/dto/link-request.dto';
import { TELEGRAM_UNLINKED_REPLY } from '../src/modules/integrations/telegram/telegram-reply';
import {
  signEnvelope,
  verifyReply,
  type TelegramEnvelope,
} from '../src/modules/integrations/telegram/telegram-envelope';
import { TelegramAdapter } from '../src/modules/integrations/telegram/telegram.adapter';
import { TelegramApiClient } from '../src/modules/integrations/telegram/telegram-api.client';
import { RoleName } from '../src/modules/roles/role-name.enum';
import {
  addCredential,
  EMPTY_CREDENTIALS_FILE,
} from '../src/modules/service-auth/service-credentials.admin';
import { serializeCredentialsFile } from '../src/modules/service-auth/service-credentials.file';
import { UsersService } from '../src/modules/users/users.service';
import { entryJson, jsonResponse, listJson } from './support/plantae-fixtures';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const ROTA = '/service/telegram/ingest';
const BOT_ID = '123456789';
/** Literal: tabelas de `it.each` sao avaliadas antes do `beforeAll`. */
const ID_ALHEIO = '11111111-2222-4333-8444-555555555555';

interface Resposta {
  correlationId: string;
  outcome: string;
  duplicate: boolean;
  reply: string | null;
  signature: string | null;
}

/**
 * Entrada de mensagens do Telegram pelo canal de servico, na aplicacao COMPLETA.
 *
 * O que se prova aqui, de ponta a ponta (guards globais, pipes, banco, Command
 * Engine, auditoria): quem decide e o backend; o n8n so entrega um envelope que
 * ele nao consegue forjar.
 */
describe('Entrada do Telegram pelo n8n (e2e)', () => {
  let app: INestApplication;
  let dir: string;
  let tokenIngest: string;
  let tokenIdentidade: string;
  let adminJwt: string;
  let adminId: string;
  let adminTelegram: string;
  let operadorTelegram: string;
  let naoVinculado: string;
  let fetchSpy: jest.SpyInstance<
    Promise<Response>,
    [input: string | URL | Request, init?: RequestInit]
  >;
  let respostasEnviadas: jest.SpiedFunction<TelegramApiClient['sendMessage']>;
  let updateSeq = 1000;
  let proximoTelegramId = 810_000_000;
  let contador = 0;
  const logs: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;
  const novoTelegramId = (): string => String(++proximoTelegramId);

  function envelope(over: Partial<TelegramEnvelope> = {}): TelegramEnvelope {
    const id = over.userId ?? adminTelegram;
    return {
      version: 'v1',
      platform: 'telegram',
      botId: BOT_ID,
      updateId: ++updateSeq,
      messageId: 1,
      chatId: id,
      userId: id,
      chatType: 'private',
      text: '/ajuda',
      sentAt: Math.floor(Date.now() / 1000),
      issuedAt: Date.now(),
      ...over,
    };
  }

  const assinado = (env: TelegramEnvelope): { envelope: TelegramEnvelope; signature: string } => ({
    envelope: env,
    signature: signEnvelope(env, INGEST_KEY_E2E),
  });

  const enviar = (corpo: unknown, token: string | null = tokenIngest): request.Test => {
    const req = request(server()).post(ROTA);
    return (token === null ? req : req.set('X-Service-Token', token)).send(corpo as object);
  };

  async function ingerir(over: Partial<TelegramEnvelope> = {}): Promise<Resposta> {
    const corpo = assinado(envelope(over));
    return (await enviar(corpo).expect(200)).body as Resposta;
  }

  async function criarUsuario(role: RoleName): Promise<{ id: string; jwt: string }> {
    contador += 1;
    const email = `${role.toLowerCase()}${String(contador)}@ingest.test`;
    const user = await app
      .get(UsersService, { strict: false })
      .create({ nome: `Teste ${role}`, email, senha: SENHA, role });
    const login = await request(server())
      .post('/auth/login')
      .send({ email, senha: SENHA })
      .expect(200);
    return { id: user.id, jwt: (login.body as AuthResponseDto).accessToken };
  }

  async function vincular(userId: string, telegramId: string): Promise<void> {
    const criada = await request(server())
      .post(`/users/${userId}/external-identities/link-requests`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ canal: 'telegram' })
      .expect(201);
    const { codigo } = criada.body as CreatedLinkRequestResponseDto;
    const id = Number(telegramId);
    // O vinculo e feito pelo caminho DIRETO (o /vincular nunca passa pelo n8n).
    await app.get(TelegramAdapter, { strict: false }).handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1_790_000_000,
        chat: { id, type: 'private' },
        from: { id, is_bot: false },
        text: `/vincular ${codigo}`,
      },
    });
  }

  async function vinculosDe(userId: string): Promise<ExternalIdentityResponseDto[]> {
    const r = await request(server())
      .get(`/users/${userId}/external-identities`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    return r.body as ExternalIdentityResponseDto[];
  }

  async function auditoria(acao: string): Promise<AuditLogPageResponseDto['items']> {
    const r = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    return (r.body as AuditLogPageResponseDto).items.filter((i) => i.acao === acao);
  }

  const chamadasAoPlantae = (): number =>
    fetchSpy.mock.calls.filter(([input]) =>
      String(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      ).includes('plantae'),
    ).length;

  beforeAll(async () => {
    for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }

    dir = mkdtempSync(join(tmpdir(), 'vf-ingest-e2e-'));
    const arquivo = join(dir, 'credentials.json');
    const a = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: 'n8n-telegram-e2e',
      principal: 'n8n-telegram',
      now: new Date(),
    });
    tokenIngest = a.token;
    const b = addCredential(a.file, { id: 'n8n-e2e', principal: 'n8n', now: new Date() });
    tokenIdentidade = b.token;
    writeFileSync(arquivo, serializeCredentialsFile(b.file));
    process.env.SERVICE_CREDENTIALS_FILE = arquivo;

    fetchSpy = jest.spyOn(globalThis, 'fetch');
    app = await createTestApp();
    respostasEnviadas = jest
      .spyOn(app.get(TelegramApiClient, { strict: false }), 'sendMessage')
      .mockResolvedValue(undefined);

    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    const body = login.body as AuthResponseDto;
    adminJwt = body.accessToken;
    adminId = body.user.id;

    adminTelegram = novoTelegramId();
    await vincular(adminId, adminTelegram);
    const operador = await criarUsuario(RoleName.Operador);
    operadorTelegram = novoTelegramId();
    await vincular(operador.id, operadorTelegram);
    naoVinculado = novoTelegramId();

    fetchSpy.mockClear();
    respostasEnviadas.mockClear();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    delete process.env.SERVICE_CREDENTIALS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchSpy.mockReset();
    fetchSpy.mockRejectedValue(new Error('nenhuma chamada de rede esperada'));
  });

  describe('autenticacao do SERVICO', () => {
    it.each([
      ['sem token', null],
      ['token desconhecido', `vfs_${'A'.repeat(43)}`],
      ['lixo', 'qualquer-coisa'],
    ])('%s: 401, nada executa', async (_nome, token) => {
      await enviar(assinado(envelope()), token).expect(401);
    });

    it('JWT de ADMIN (pessoa) nao abre a rota de servico', async () => {
      await request(server())
        .post(ROTA)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send(assinado(envelope()))
        .expect(401);
    });

    it('principal `n8n` (so identidade) e recusado por ESCOPO: 403', async () => {
      await enviar(assinado(envelope()), tokenIdentidade).expect(403);
    });

    it('principal `n8n-telegram` com envelope valido: 200', async () => {
      await enviar(assinado(envelope())).expect(200);
    });

    it('o token de ingestao nao abre a rota de identidade (escopos separados)', async () => {
      await request(server())
        .get('/service/identity')
        .set('X-Service-Token', tokenIngest)
        .expect(403);
    });

    it('o token de ingestao nao abre rota de pessoa', async () => {
      await request(server()).get('/users').set('X-Service-Token', tokenIngest).expect(401);
    });
  });

  describe('o n8n NAO escolhe quem e o usuario', () => {
    it.each([
      ['actorUserId no envelope', { actorUserId: ID_ALHEIO }],
      ['role no envelope', { role: 'ADMIN' }],
      ['permissions no envelope', { permissions: ['*'] }],
      ['usuarioId no envelope', { usuarioId: ID_ALHEIO }],
    ])('%s: 400, nada executa', async (_nome, extra) => {
      const env = envelope({ userId: naoVinculado, chatId: naoVinculado });
      const corpo = {
        envelope: { ...env, ...extra },
        signature: signEnvelope(env, INGEST_KEY_E2E),
      };

      await enviar(corpo).expect(400);
    });

    it.each([
      ['actorUserId no topo', { actorUserId: ID_ALHEIO }],
      ['role no topo', { role: 'ADMIN' }],
      ['permissions no topo', { permissions: ['*'] }],
    ])('%s: 400', async (_nome, extra) => {
      await enviar({ ...assinado(envelope()), ...extra }).expect(400);
    });

    it('trocar o userId depois de assinar (assumir a identidade do ADMIN): 403', async () => {
      const original = envelope({ userId: naoVinculado, chatId: naoVinculado });
      const corpo = {
        envelope: { ...original, userId: adminTelegram, chatId: adminTelegram },
        signature: signEnvelope(original, INGEST_KEY_E2E),
      };

      await enviar(corpo).expect(403);
    });

    it('trocar o texto depois de assinar: 403', async () => {
      const original = envelope({ text: '/ajuda' });
      const corpo = {
        envelope: { ...original, text: '/contas_pagar' },
        signature: signEnvelope(original, INGEST_KEY_E2E),
      };

      await enviar(corpo).expect(403);
      expect(chamadasAoPlantae()).toBe(0);
    });

    it('assinatura de outra chave: 403', async () => {
      const env = envelope();

      await enviar({ envelope: env, signature: signEnvelope(env, 'x'.repeat(40)) }).expect(403);
    });

    it('envelope expirado (replay tardio): 403', async () => {
      await enviar(assinado(envelope({ issuedAt: Date.now() - 10 * 60 * 1000 }))).expect(403);
    });

    it('chat diferente do remetente: 403', async () => {
      await enviar(assinado(envelope({ chatId: novoTelegramId() }))).expect(403);
    });

    it.each([
      ['grupo', { chatType: 'group' }],
      ['versao', { version: 'v2' }],
      ['plataforma', { platform: 'whatsapp' }],
      ['texto vazio', { text: '' }],
      ['texto enorme', { text: 'x'.repeat(5000) }],
      ['updateId negativo', { updateId: -1 }],
      ['userId nao numerico', { userId: 'abc', chatId: 'abc' }],
    ])('envelope fora do contrato (%s): 400', async (_nome, over) => {
      await enviar(assinado(envelope(over as Partial<TelegramEnvelope>))).expect(400);
    });

    it('corpo sem envelope ou sem assinatura: 400', async () => {
      await enviar({}).expect(400);
      await enviar({ envelope: envelope() }).expect(400);
      await enviar({ signature: 'a'.repeat(64) }).expect(400);
    });
  });

  describe('autorizacao pela IDENTIDADE (o Command Engine existente)', () => {
    it('usuario vinculado: executa /ajuda e a resposta volta ASSINADA e amarrada ao envelope', async () => {
      const env = envelope();

      const out = (await enviar(assinado(env)).expect(200)).body as Resposta;

      expect(out).toMatchObject({ outcome: 'EXECUTED', duplicate: false });
      expect(out.reply).toContain('/ajuda');
      expect(
        verifyReply(
          env,
          { outcome: out.outcome, reply: out.reply ?? '', signature: out.signature ?? '' },
          INGEST_KEY_E2E,
        ),
      ).toBe(true);
    });

    it('NAO vinculado: UNLINKED, texto padrao, nenhum comando executado', async () => {
      const out = await ingerir({
        userId: naoVinculado,
        chatId: naoVinculado,
        text: '/financeiro',
      });

      expect(out).toMatchObject({ outcome: 'UNLINKED', reply: TELEGRAM_UNLINKED_REPLY });
    });

    it('NAO vinculado + /contas_pagar: nao consulta o Plantae', async () => {
      const out = await ingerir({
        userId: naoVinculado,
        chatId: naoVinculado,
        text: '/contas_pagar',
      });

      expect(out.outcome).toBe('UNLINKED');
      expect(chamadasAoPlantae()).toBe(0);
    });

    it('ADMIN vinculado + /contas_pagar: consulta o Plantae (so GET) e responde sem CPF/CNPJ', async () => {
      fetchSpy.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            listJson([entryJson(482, { statusCode: 0 })], { endpoint: 'financial/entries' }),
          ),
        ),
      );

      const out = await ingerir({ text: '/contas_pagar' });

      expect(out.outcome).toBe('EXECUTED');
      expect(out.reply).toContain('Contas a pagar pendentes');
      expect(out.reply).toContain('8.337,10');
      expect(out.reply).not.toContain('000.000.000-00');
      expect(out.reply).not.toContain('DOC-001');
      // Fase 6: aviso de homologacao na 1a linha, favorecido oculto por padrao, referencia curta.
      expect(out.reply?.split(String.fromCharCode(10))[0]).toContain('HOMOLOGACAO');
      expect(out.reply).not.toContain('Pessoa Ficticia');
      expect(out.reply).toMatch(/ref 482/);
      expect(chamadasAoPlantae()).toBe(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string | URL, RequestInit];
      expect(init.method).toBe('GET');
      const u = new URL(String(url));
      expect(u.pathname).toBe('/api/v1/external/financial/entries');
      expect(u.searchParams.get('tipo')).toBe('despesa');
      expect(u.searchParams.get('per_page')).toBe('5');
    });

    it('Plantae devolve parcela QUITADA e SUBSTITUIDA mesmo com o filtro: nenhuma aparece no chat', async () => {
      fetchSpy.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(
            listJson(
              [
                entryJson(501, { statusCode: 0 }),
                entryJson(502, { statusCode: 1 }),
                entryJson(503, { statusCode: 2 }),
              ],
              { endpoint: 'financial/entries' },
            ),
          ),
        ),
      );

      const out = await ingerir({ text: '/contas_pagar' });

      expect(out.reply).toContain('ref 501');
      expect(out.reply).not.toContain('ref 502');
      expect(out.reply).not.toContain('ref 503');
      expect(out.reply).toContain('2 item(ns) fora do status pendente foram ignorados');
    });

    it('erro do fornecedor (500): frase fixa, nenhum valor inventado', async () => {
      fetchSpy.mockImplementation(() => Promise.resolve(jsonResponse('{}', { status: 500 })));

      const out = await ingerir({ text: '/contas_pagar' });

      expect(out.outcome).toBe('FAILED');
      expect(out.reply).not.toMatch(/R\$|\d+,\d{2}/);
    });

    it('OPERADOR vinculado SEM plantae:read + /contas_pagar: DENIED e o Plantae nem e chamado', async () => {
      const out = await ingerir({
        userId: operadorTelegram,
        chatId: operadorTelegram,
        text: '/contas_pagar',
      });

      expect(out.outcome).toBe('DENIED');
      expect(chamadasAoPlantae()).toBe(0);
      expect(out.reply).not.toContain('Contas a pagar pendentes');
    });

    it('comando desconhecido e texto comum: resposta de ajuda, sem executar nada', async () => {
      expect((await ingerir({ text: '/xpto' })).outcome).toBe('UNKNOWN_COMMAND');
      expect((await ingerir({ text: 'ola, tudo bem?' })).outcome).toBe('UNKNOWN_COMMAND');
    });

    it('SQL ou codigo na mensagem e so texto: nada e interpretado', async () => {
      const out = await ingerir({ text: "/financeiro'; DROP TABLE users; --" });

      expect(['UNKNOWN_COMMAND', 'EXECUTED', 'DENIED']).toContain(out.outcome);
      await request(server()).get('/users').set('Authorization', `Bearer ${adminJwt}`).expect(200);
    });

    it('/vincular pelo n8n NAO vincula: o codigo so vale no caminho direto', async () => {
      const alvo = await criarUsuario(RoleName.Usuario);
      const criada = await request(server())
        .post(`/users/${alvo.id}/external-identities/link-requests`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ canal: 'telegram' })
        .expect(201);
      const { codigo } = criada.body as CreatedLinkRequestResponseDto;
      const novo = novoTelegramId();

      const out = await ingerir({ userId: novo, chatId: novo, text: `/vincular ${codigo}` });

      expect(out.outcome).not.toBe('EXECUTED');
      expect(await vinculosDe(alvo.id)).toEqual([]);
    });

    it('o servico nunca e o ator: nao ha como executar comando sem uma pessoa vinculada', async () => {
      const out = await ingerir({ userId: naoVinculado, chatId: naoVinculado, text: '/status' });

      expect(out.outcome).toBe('UNLINKED');
      expect(out.reply).not.toContain('Perfil');
    });
  });

  describe('idempotencia persistente', () => {
    it('o mesmo update entregue duas vezes executa UMA vez; a segunda e duplicada, sem resposta', async () => {
      const corpo = assinado(envelope({ text: '/status' }));
      const antes = (await auditoria('CHANNEL_MESSAGE')).length;

      const primeira = (await enviar(corpo).expect(200)).body as Resposta;
      const segunda = (await enviar(corpo).expect(200)).body as Resposta;

      expect(primeira.duplicate).toBe(false);
      expect(segunda).toMatchObject({
        duplicate: true,
        outcome: 'DUPLICATE',
        reply: null,
        signature: null,
      });
      expect(segunda.correlationId).toBe(primeira.correlationId);
      const depois = await auditoria('CHANNEL_MESSAGE');
      expect(depois.length - antes).toBe(2);
      expect(
        depois.filter((l) => l.metadados?.resultado === 'DUPLICATE').length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('entregas CONCORRENTES do mesmo update: exatamente uma executa', async () => {
      const corpo = assinado(envelope({ text: '/status' }));

      const respostas = await Promise.all(
        Array.from({ length: 6 }, async () => (await enviar(corpo)).body as Resposta),
      );

      expect(respostas.filter((r) => r.duplicate === false)).toHaveLength(1);
      expect(respostas.filter((r) => r.duplicate === true)).toHaveLength(5);
    });

    it('updates diferentes nao se bloqueiam', async () => {
      const a = await ingerir({ text: '/ajuda' });
      const b = await ingerir({ text: '/ajuda' });

      expect(a.duplicate).toBe(false);
      expect(b.duplicate).toBe(false);
    });

    it('o mesmo updateId em OUTRO bot e outro evento', async () => {
      const base = envelope({ text: '/ajuda' });

      await enviar(assinado(base)).expect(200);
      const outro = (await enviar(assinado({ ...base, botId: '987654321' })).expect(200))
        .body as Resposta;

      expect(outro.duplicate).toBe(false);
    });

    it('replay de uma recusa nao vira execucao: envelope adulterado nao reserva o update', async () => {
      const env = envelope({ text: '/ajuda' });
      await enviar({
        envelope: { ...env, text: '/status' },
        signature: signEnvelope(env, INGEST_KEY_E2E),
      }).expect(403);

      const ok = (await enviar(assinado(env)).expect(200)).body as Resposta;

      expect(ok.duplicate).toBe(false);
    });
  });

  describe('auditoria e logs', () => {
    it('uma linha por mensagem, com principal, resultado e correlacao - sem texto, sem resposta, sem ids do Telegram', async () => {
      const textoUnico = `/status SENTINELA-${String(Date.now())}`;
      const out = await ingerir({ text: textoUnico });

      const eventos = (await auditoria('CHANNEL_MESSAGE')).filter(
        (l) => l.metadados?.correlacao === out.correlationId,
      );
      expect(eventos).toHaveLength(1);
      expect(eventos[0]?.metadados).toMatchObject({
        canal: 'telegram',
        principal: 'n8n-telegram',
        servicoId: 'n8n-telegram-e2e',
      });
      expect(eventos[0]?.usuarioId).toBe(adminId);
      const bruto = JSON.stringify(eventos);
      expect(bruto).not.toContain('SENTINELA');
      expect(bruto).not.toContain(adminTelegram);
      expect(bruto).not.toContain(INGEST_KEY_E2E);
      expect(bruto).not.toContain(tokenIngest);
    });

    it('envelope recusado e auditado sem usuario', async () => {
      const env = envelope({ userId: naoVinculado, chatId: naoVinculado, text: '/ajuda' });
      await enviar({ envelope: env, signature: 'f'.repeat(64) }).expect(403);

      const rejeitados = (await auditoria('CHANNEL_MESSAGE')).filter(
        (l) => l.metadados?.resultado === 'ENVELOPE_REJECTED',
      );
      expect(rejeitados.length).toBeGreaterThan(0);
      expect(rejeitados[0]?.usuarioId).toBeNull();
    });

    it('o comando /contas_pagar tambem e auditado pelo motor (PLANTAE_QUERIED), sem o conteudo', async () => {
      fetchSpy.mockImplementation(() =>
        Promise.resolve(jsonResponse(listJson([entryJson(482, { statusCode: 0 })]))),
      );
      await ingerir({ text: '/contas_pagar' });

      const eventos = await auditoria('PLANTAE_QUERIED');
      expect(eventos.length).toBeGreaterThan(0);
      expect(JSON.stringify(eventos)).not.toContain('Pessoa Ficticia');
      expect(JSON.stringify(eventos)).not.toContain('8337');
      // Detalhe fechado: distingue "consulta ok" de vazio/erro/desligado.
      const detalhes = eventos.map((e) => e.metadados?.detalhe);
      expect(detalhes).toContain('ok');
      expect(
        detalhes
          .filter((d) => typeof d === 'string')
          .every((d) => /^[a-z_]{1,40}$/.test(String(d))),
      ).toBe(true);
    });

    it('nenhum log da suite traz texto de mensagem, resposta, token, chave ou id do Telegram', () => {
      const tudo = logs.join('\n');

      expect(tudo).not.toContain(INGEST_KEY_E2E);
      expect(tudo).not.toContain(tokenIngest);
      expect(tudo).not.toContain(tokenIdentidade);
      expect(tudo).not.toContain(adminTelegram);
      expect(tudo).not.toContain('SENTINELA');
      expect(tudo).not.toContain('plt_TOKEN_FALSO');
    });
  });

  describe('regressao', () => {
    it('nenhuma resposta da rota traz token do Plantae, chave ou hash', async () => {
      const out = await enviar(assinado(envelope({ text: '/status' }))).expect(200);
      const corpo = JSON.stringify(out.body);

      expect(corpo).not.toContain(INGEST_KEY_E2E);
      expect(corpo).not.toContain('plt_');
      expect(corpo).not.toMatch(/sha256|hash/i);
    });

    it('o envio da resposta ao Telegram NAO acontece pela rota (so o transporte envia)', async () => {
      respostasEnviadas.mockClear();

      await ingerir({ text: '/ajuda' });

      expect(respostasEnviadas).not.toHaveBeenCalled();
    });

    it('/health continua publico e igual', async () => {
      const r = await request(server()).get('/health').expect(200);

      expect(r.body).toEqual({ status: 'ok', service: 'vasta-flow' });
    });
  });
});
