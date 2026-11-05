import {
  GATEWAY_ACCOUNT,
  GATEWAY_CREDENTIALS_DIR,
  GATEWAY_CREDENTIALS_FILE,
} from './support/whatsapp-gateway-env';
import { rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import type { CreatedLinkRequestResponseDto } from '../src/modules/external-identities/dto/link-request.dto';
import { WHATSAPP_REPLIES } from '../src/modules/integrations/whatsapp/whatsapp-message.processor';
import { RoleName } from '../src/modules/roles/role-name.enum';
import {
  addCredential,
  EMPTY_CREDENTIALS_FILE,
} from '../src/modules/service-auth/service-credentials.admin';
import { serializeCredentialsFile } from '../src/modules/service-auth/service-credentials.file';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const SENHA = 'Senha1234';
const ROTA = '/service/whatsapp/ingest';
const CREDENCIAL_ID = 'gateway-e2e';
/** Literal: tabelas de `it.each` sao avaliadas antes do `beforeAll`. */
const ID_ALHEIO = '11111111-2222-4333-8444-555555555555';

interface Resposta {
  correlationId: string | null;
  outcome: string;
  duplicate: boolean;
  replyTo: string | null;
  reply: string | null;
}

/**
 * Entrada das mensagens do WhatsApp pelo GATEWAY (transporte Baileys), na aplicacao COMPLETA: guards globais,
 * pipes, banco, Command Engine e auditoria. Mensagens SINTETICAS, numeros ficticios, nenhum WhatsApp real.
 *
 * Prova: so o principal do gateway entra; o gateway nao escolhe o usuario nem o destinatario da resposta;
 * duplicata, mensagem antiga e remetente nao vinculado nao executam nada.
 */
describe('WhatsApp - entrada pelo gateway (e2e)', () => {
  let app: INestApplication;
  let tokenGateway: string;
  let tokenIdentidade: string;
  let tokenTelegram: string;
  let adminJwt: string;
  let operadorId: string;
  let seq = 0;
  let proximoNumero = 5_511_977_000_000;
  const logs: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;
  const novoNumero = (): string => String(++proximoNumero);

  function mensagem(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      version: 1,
      messageId: `3EB0TESTE${String(++seq)}`,
      from: novoNumero(),
      to: GATEWAY_ACCOUNT,
      chatType: 'private',
      text: '/ajuda',
      timestamp: Math.floor(Date.now() / 1000),
      ...over,
    };
  }

  const enviar = (corpo: unknown, token: string | null = tokenGateway): request.Test => {
    const req = request(server()).post(ROTA);
    return (token === null ? req : req.set('X-Service-Token', token)).send(corpo as object);
  };

  async function ingerir(over: Record<string, unknown> = {}): Promise<Resposta> {
    return (await enviar(mensagem(over)).expect(200)).body as Resposta;
  }

  async function auditoria(): Promise<AuditLogPageResponseDto['items']> {
    const r = await request(server())
      .get('/audit-logs?limit=100')
      .set('Authorization', `Bearer ${adminJwt}`)
      .expect(200);
    return (r.body as AuditLogPageResponseDto).items.filter(
      (i) => i.acao === 'CHANNEL_MESSAGE' && i.metadados?.canal === 'whatsapp',
    );
  }

  async function vincular(userId: string, numero: string): Promise<Resposta> {
    const criada = await request(server())
      .post(`/users/${userId}/external-identities/link-requests`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ canal: 'whatsapp' })
      .expect(201);
    const { codigo } = criada.body as CreatedLinkRequestResponseDto;
    return ingerir({ from: numero, text: `/vincular ${codigo}` });
  }

  beforeAll(async () => {
    for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const a = addCredential(EMPTY_CREDENTIALS_FILE, {
      id: CREDENCIAL_ID,
      principal: 'whatsapp-gateway',
      now: new Date(),
    });
    tokenGateway = a.token;
    const b = addCredential(a.file, { id: 'n8n-e2e', principal: 'n8n', now: new Date() });
    tokenIdentidade = b.token;
    const c = addCredential(b.file, {
      id: 'n8n-telegram-e2e',
      principal: 'n8n-telegram',
      now: new Date(),
    });
    tokenTelegram = c.token;
    writeFileSync(GATEWAY_CREDENTIALS_FILE, serializeCredentialsFile(c.file));

    app = await createTestApp();
    const login = await request(server()).post('/auth/login').send(ADMIN).expect(200);
    adminJwt = (login.body as AuthResponseDto).accessToken;
    const operador = await app.get(UsersService, { strict: false }).create({
      nome: 'Operador WA',
      email: 'operador@gateway.test',
      senha: SENHA,
      role: RoleName.Operador,
    });
    operadorId = operador.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    rmSync(GATEWAY_CREDENTIALS_DIR, { recursive: true, force: true });
  });

  describe('autenticacao e escopo do SERVICO', () => {
    it.each([
      ['sem token', null],
      ['token desconhecido', `vfs_${'A'.repeat(43)}`],
      ['lixo', 'qualquer-coisa'],
    ])('%s: 401, nada executa', async (_nome, token) => {
      await enviar(mensagem(), token).expect(401);
      expect(await auditoria()).toEqual([]);
    });

    it('JWT de ADMIN (pessoa) nao abre a rota de servico', async () => {
      await request(server())
        .post(ROTA)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send(mensagem())
        .expect(401);
    });

    it('principal `n8n` (so identidade) e `n8n-telegram` (so Telegram) sao recusados por ESCOPO: 403', async () => {
      await enviar(mensagem(), tokenIdentidade).expect(403);
      await enviar(mensagem(), tokenTelegram).expect(403);
      expect(await auditoria()).toEqual([]);
    });

    it('principal `whatsapp-gateway` com mensagem valida: 200', async () => {
      await enviar(mensagem()).expect(200);
    });

    it('o token do gateway nao abre identidade, Telegram nem rota de pessoa (escopos separados)', async () => {
      await request(server())
        .get('/service/identity')
        .set('X-Service-Token', tokenGateway)
        .expect(403);
      await request(server())
        .post('/service/telegram/ingest')
        .set('X-Service-Token', tokenGateway)
        .send({})
        .expect(403);
      await request(server()).get('/users').set('X-Service-Token', tokenGateway).expect(401);
    });
  });

  describe('o gateway NAO escolhe quem e o usuario nem para quem se responde', () => {
    it.each([
      ['replyTo (destinatario da resposta)', { replyTo: '5511999990001' }],
      ['reply_to', { reply_to: '5511999990001' }],
      ['actorUserId', { actorUserId: ID_ALHEIO }],
      ['usuarioId', { usuarioId: ID_ALHEIO }],
      ['role', { role: 'ADMIN' }],
      ['permissions', { permissions: ['*'] }],
      ['isAdmin', { isAdmin: true }],
    ])('campo %s: 400, nada e processado', async (_nome, extra) => {
      const antes = (await auditoria()).length;

      await enviar(mensagem(extra)).expect(400);

      expect((await auditoria()).length).toBe(antes);
    });

    it('a resposta volta SEMPRE ao remetente da mensagem (`replyTo` = `from`)', async () => {
      const a = novoNumero();
      const b = novoNumero();

      const respostaA = await ingerir({ from: a, text: '/vincular CODIGOINVALIDO' });
      const respostaB = await ingerir({ from: b, text: '/vincular CODIGOINVALIDO' });

      expect(respostaA.replyTo).toBe(a);
      expect(respostaB.replyTo).toBe(b);
      expect(respostaA.reply).toBe(WHATSAPP_REPLIES.linkRejected);
    });

    it('sem resposta (null), `replyTo` tambem e null: nao ha destino sem texto', async () => {
      const r = await ingerir({ from: novoNumero(), text: '/financeiro' });

      expect(r).toMatchObject({ outcome: 'UNLINKED', reply: null, replyTo: null });
    });
  });

  describe('contrato estrito do corpo', () => {
    it.each([
      ['versao diferente', { version: 2 }],
      ['sem versao', { version: undefined }],
      ['grupo', { chatType: 'group' }],
      ['remetente com letras', { from: '55119999abcd' }],
      ['remetente com JID', { from: '5511999990001@s.whatsapp.net' }],
      ['remetente curto', { from: '1234' }],
      ['destinatario ausente', { to: undefined }],
      ['destinatario invalido', { to: 'bot' }],
      ['messageId com espaco', { messageId: 'abc def' }],
      ['messageId vazio', { messageId: '' }],
      ['messageId enorme', { messageId: 'A'.repeat(201) }],
      ['texto vazio', { text: '' }],
      ['texto enorme', { text: 'x'.repeat(4097) }],
      ['texto nao textual', { text: { body: '/ajuda' } }],
      ['timestamp como texto', { timestamp: '1790000000' }],
      ['timestamp fracionario', { timestamp: 1.5 }],
      ['timestamp negativo', { timestamp: -1 }],
    ])('%s: 400', async (_nome, over) => {
      await enviar(mensagem(over)).expect(400);
    });

    it('corpo vazio ou sem campos obrigatorios: 400', async () => {
      await enviar({}).expect(400);
      await enviar({ version: 1, text: '/ajuda' }).expect(400);
    });
  });

  describe('remetente nao vinculado', () => {
    it('fica em SILENCIO: nada executa, nenhuma resposta, e a tentativa e auditada sem numero nem texto', async () => {
      const numero = novoNumero();

      const r = await ingerir({ from: numero, text: '/financeiro SENTINELA' });

      expect(r).toMatchObject({
        outcome: 'UNLINKED',
        reply: null,
        replyTo: null,
        duplicate: false,
      });
      const eventos = await auditoria();
      const evento = eventos.find((e) => e.metadados?.correlacao === r.correlationId);
      expect(evento?.metadados).toMatchObject({
        resultado: 'UNLINKED',
        autorizacao: 'NAO_VINCULADO',
      });
      expect(evento?.usuarioId ?? null).toBeNull();
      expect(JSON.stringify(eventos)).not.toContain(numero);
      expect(JSON.stringify(eventos)).not.toContain('SENTINELA');
    });

    it('conversa comum de cliente (texto livre) tambem fica em silencio', async () => {
      for (const text of ['Oi, tudo bem?', 'Quanto custa?', '/ajuda']) {
        expect(await ingerir({ text })).toMatchObject({ outcome: 'UNLINKED', reply: null });
      }
    });
  });

  describe('vinculo, identidade e RBAC', () => {
    let numeroOperador: string;

    it('/vincular com codigo valido vincula o numero (prova de posse) e responde', async () => {
      numeroOperador = novoNumero();

      const r = await vincular(operadorId, numeroOperador);

      expect(r).toMatchObject({
        outcome: 'LINK_CONFIRMED',
        reply: WHATSAPP_REPLIES.linked,
        replyTo: numeroOperador,
      });
    });

    it('o codigo nao serve para outro numero (ja usado)', async () => {
      expect(await ingerir({ from: novoNumero(), text: '/vincular ABCD-EFGH-JKLM' })).toMatchObject(
        { outcome: 'LINK_REJECTED', reply: WHATSAPP_REPLIES.linkRejected },
      );
    });

    it('vinculado: /ajuda executa pelo Command Engine; /financeiro e NEGADO ao OPERADOR (RBAC dele)', async () => {
      const ajuda = await ingerir({ from: numeroOperador, text: '/ajuda' });
      const financeiro = await ingerir({ from: numeroOperador, text: '/financeiro' });

      expect(ajuda.outcome).toBe('EXECUTED');
      expect(ajuda.reply).toContain('Comandos disponiveis');
      expect(ajuda.reply).not.toContain('/financeiro');
      expect(financeiro.outcome).toBe('DENIED');
      expect(financeiro.reply).toContain('nao tem permissao');
      expect(financeiro.replyTo).toBe(numeroOperador);
    });

    it('a auditoria registra a PESSOA, o canal, o principal e o servicoId do gateway, sem texto nem numero', async () => {
      const r = await ingerir({ from: numeroOperador, text: '/status SENTINELA-AUDIT' });

      const eventos = await auditoria();
      const evento = eventos.find((e) => e.metadados?.correlacao === r.correlationId);
      expect(evento?.usuarioId).toBe(operadorId);
      expect(evento?.metadados).toMatchObject({
        canal: 'whatsapp',
        origem: 'gateway-baileys',
        principal: 'whatsapp-gateway',
        servicoId: CREDENCIAL_ID,
        resultado: 'EXECUTED',
      });
      const bruto = JSON.stringify(eventos);
      expect(bruto).not.toContain(numeroOperador);
      expect(bruto).not.toContain('SENTINELA-AUDIT');
    });

    it('limite por remetente: 10 por minuto (contando o /vincular); o excesso e descartado sem resposta', async () => {
      const usuario = await app.get(UsersService, { strict: false }).create({
        nome: 'Limite WA',
        email: 'limite@gateway.test',
        senha: SENHA,
        role: RoleName.Operador,
      });
      const numero = novoNumero();
      await vincular(usuario.id, numero);

      const resultados: Resposta[] = [];
      for (let i = 0; i < 12; i += 1) {
        resultados.push(await ingerir({ from: numero, text: '/ajuda' }));
      }

      // 1 (vincular) + 9 comandos = 10 na janela; os 3 seguintes sao cortados.
      expect(resultados.filter((r) => r.outcome === 'EXECUTED')).toHaveLength(9);
      const limitadas = resultados.filter((r) => r.outcome === 'RATE_LIMITED');
      expect(limitadas).toHaveLength(3);
      expect(limitadas.every((r) => r.reply === null && r.replyTo === null)).toBe(true);
    });
  });

  describe('idempotencia e protecoes', () => {
    it('a mesma mensagem entregue 3 vezes (retentativa do gateway): executa UMA vez', async () => {
      const corpo = mensagem({ from: novoNumero(), text: '/vincular XXXXXXXX' });

      const [um, dois, tres] = [
        (await enviar(corpo).expect(200)).body as Resposta,
        (await enviar(corpo).expect(200)).body as Resposta,
        (await enviar(corpo).expect(200)).body as Resposta,
      ];

      expect(um.outcome).toBe('LINK_REJECTED');
      for (const repetida of [dois, tres]) {
        expect(repetida).toMatchObject({
          outcome: 'DUPLICATE',
          duplicate: true,
          reply: null,
          replyTo: null,
        });
      }
    });

    it('entregas SIMULTANEAS da mesma mensagem: so uma executa', async () => {
      const corpo = mensagem({ from: novoNumero(), text: '/vincular YYYYYYYY' });

      const respostas = await Promise.all(
        Array.from({ length: 6 }, async () => (await enviar(corpo).expect(200)).body as Resposta),
      );

      expect(respostas.filter((r) => r.outcome === 'LINK_REJECTED')).toHaveLength(1);
      expect(respostas.filter((r) => r.outcome === 'DUPLICATE')).toHaveLength(5);
    });

    it('mensagem de OUTRO destinatario (nao e a conta do bot): ignorada, nada e reservado nem auditado', async () => {
      const antes = (await auditoria()).length;

      const r = await ingerir({ to: '5511911112222' });

      expect(r).toMatchObject({
        outcome: 'IGNORED',
        reply: null,
        replyTo: null,
        correlationId: null,
      });
      expect((await auditoria()).length).toBe(antes);
    });

    it('mensagem antiga (20 min): descartada sem executar e sem responder', async () => {
      const r = await ingerir({ timestamp: Math.floor(Date.now() / 1000) - 20 * 60 });

      expect(r).toMatchObject({ outcome: 'STALE', reply: null, replyTo: null });
    });

    it('mensagem com relogio no FUTURO (1 h a frente): tambem descartada', async () => {
      const r = await ingerir({ timestamp: Math.floor(Date.now() / 1000) + 3600 });

      expect(r.outcome).toBe('STALE');
    });
  });

  describe('o transporte antigo (Meta) fica fora quando o gateway esta ativo', () => {
    it.each([
      ['GET (verificacao)', () => request(server()).get('/webhooks/whatsapp')],
      [
        'POST (webhook)',
        () =>
          request(server())
            .post('/webhooks/whatsapp')
            .send({ object: 'whatsapp_business_account' }),
      ],
    ])('webhook da Meta %s: 404', async (_nome, chamar) => {
      await chamar().expect(404);
    });
  });

  it('nenhum log traz texto de mensagem, numero ou credencial', () => {
    const bruto = logs.join('\n');

    expect(bruto).not.toMatch(/SENTINELA|vfs_|55119770000\d\d/);
    expect(bruto).not.toContain(tokenGateway);
    expect(bruto).not.toContain(GATEWAY_ACCOUNT);
  });
});
