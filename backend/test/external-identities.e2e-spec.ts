import type { Server } from 'node:http';
import { type INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { AuditLogPageResponseDto } from '../src/modules/audit/dto/audit-log-page-response.dto';
import type { AuditLogResponseDto } from '../src/modules/audit/dto/audit-log-response.dto';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto';
import { CommandRouter, ROUTER_MESSAGES } from '../src/modules/commands/command-router.service';
import type { ExternalIdentityResponseDto } from '../src/modules/external-identities/dto/external-identity-response.dto';
import type {
  CreatedLinkRequestResponseDto,
  LinkRequestResponseDto,
} from '../src/modules/external-identities/dto/link-request.dto';
import { IdentityLinkRequest } from '../src/modules/external-identities/entities/identity-link-request.entity';
import { IdentityChannel } from '../src/modules/external-identities/external-identity.enums';
import {
  DuplicatePendingRequestError,
  IdentityLinkRequestsRepository,
} from '../src/modules/external-identities/identity-link-requests.repository';
import { LinkConfirmationOutcome } from '../src/modules/integrations/channels/channel-link';
import { TelegramAdapter } from '../src/modules/integrations/telegram/telegram.adapter';
import { TelegramApiClient } from '../src/modules/integrations/telegram/telegram-api.client';
import {
  linkConfirmationReply,
  TELEGRAM_UNLINKED_REPLY,
} from '../src/modules/integrations/telegram/telegram-reply';
import { RoleName } from '../src/modules/roles/role-name.enum';
import { UsersService } from '../src/modules/users/users.service';
import { createTestApp } from './support/test-app';

const ADMIN = { email: 'admin@vasta.test', senha: 'AdminSenha1' };
const VALID_PASSWORD = 'Senha1234';
const CONFIRMADO = linkConfirmationReply(LinkConfirmationOutcome.Confirmed);
const RECUSADO = linkConfirmationReply(LinkConfirmationOutcome.Rejected);
const JA_VINCULADO = linkConfirmationReply(LinkConfirmationOutcome.AlreadyLinked);

interface Sessao {
  id: string;
  token: string;
}

/**
 * Vinculacao com prova de posse, na aplicacao COMPLETA (SQLite em memoria).
 *
 * O caminho do Telegram e o real: adapter, confirmador, resolvedor do banco,
 * CommandRouter e handlers. So o `sendMessage` e substituido - nada sai para o
 * Telegram, e o texto que iria para ele fica registrado para as asserções.
 */
describe('Vinculacao de identidade externa com confirmacao (e2e)', () => {
  let app: INestApplication;
  let admin: Sessao;
  let adapter: TelegramAdapter;
  let dataSource: DataSource;
  let enviado: jest.SpiedFunction<TelegramApiClient['sendMessage']>;
  let contador = 0;
  let proximoTelegramId = 700_000_000;

  const server = (): Server => app.getHttpServer() as Server;
  const bearer = (s: Sessao): string => `Bearer ${s.token}`;
  const novoTelegramId = (): string => String(++proximoTelegramId);

  async function login(email: string, senha: string): Promise<AuthResponseDto> {
    const response = await request(server()).post('/auth/login').send({ email, senha }).expect(200);
    return response.body as AuthResponseDto;
  }

  async function sessao(role: RoleName): Promise<Sessao> {
    const email = `${role.toLowerCase()}${++contador}@vasta.test`;
    const user = await app
      .get(UsersService, { strict: false })
      .create({ nome: `Teste ${role}`, email, senha: VALID_PASSWORD, role });
    return { id: user.id, token: (await login(email, VALID_PASSWORD)).accessToken };
  }

  function solicitar(ator: Sessao, userId: string): request.Test {
    return request(server())
      .post(`/users/${userId}/external-identities/link-requests`)
      .set('Authorization', bearer(ator))
      .send({ canal: 'telegram' });
  }

  async function codigoPara(userId: string): Promise<CreatedLinkRequestResponseDto> {
    return (await solicitar(admin, userId).expect(201)).body as CreatedLinkRequestResponseDto;
  }

  function vinculosDe(userId: string): Promise<ExternalIdentityResponseDto[]> {
    return request(server())
      .get(`/users/${userId}/external-identities`)
      .set('Authorization', bearer(admin))
      .expect(200)
      .then((r) => r.body as ExternalIdentityResponseDto[]);
  }

  async function enviar(telegramId: string, texto: string, extra = {}): Promise<void> {
    const id = Number(telegramId);
    await adapter.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1_790_000_000,
        chat: { id, type: 'private' },
        from: { id, is_bot: false },
        text: texto,
        ...extra,
      },
    });
  }

  /** Mensagem privada do Telegram; devolve o texto que o bot responderia. */
  async function telegram(telegramId: string, texto: string, extra = {}): Promise<string> {
    enviado.mockClear();
    await enviar(telegramId, texto, extra);
    expect(enviado).toHaveBeenCalledTimes(1);
    const [chatId, resposta] = enviado.mock.calls[0];
    expect(chatId).toBe(telegramId);
    return resposta;
  }

  /** Solicita e confirma pelo Telegram: o caminho feliz completo. */
  async function vincular(userId: string, telegramId: string): Promise<void> {
    const { codigo } = await codigoPara(userId);
    expect(await telegram(telegramId, `/vincular ${codigo}`)).toBe(CONFIRMADO);
  }

  async function auditoria(): Promise<AuditLogResponseDto[]> {
    const response = await request(server())
      .get('/audit-logs?page=1&limit=100')
      .set('Authorization', bearer(admin))
      .expect(200);
    return (response.body as AuditLogPageResponseDto).items;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const { accessToken, user } = await login(ADMIN.email, ADMIN.senha);
    admin = { id: user.id, token: accessToken };
    adapter = app.get(TelegramAdapter, { strict: false });
    dataSource = app.get(DataSource, { strict: false });
    enviado = jest
      .spyOn(app.get(TelegramApiClient, { strict: false }), 'sendMessage')
      .mockResolvedValue(undefined);
  });

  afterAll(async () => {
    enviado.mockRestore();
    await app.close();
  });

  describe('solicitacao', () => {
    it('ADMIN inicia: 201 com codigo e instrucao, auditado SEM o codigo', async () => {
      const alvo = await sessao(RoleName.Usuario);

      const criada = await codigoPara(alvo.id);

      expect(criada).toMatchObject({ canal: 'telegram', status: 'PENDENTE' });
      expect(criada.codigo).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(criada.instrucao).toBe(
        `Envie ao bot do Telegram, em conversa privada: /vincular ${criada.codigo}`,
      );
      const evento = (await auditoria()).find(
        (log) => log.acao === 'IDENTITY_LINK_REQUESTED' && log.metadados?.alvoId === alvo.id,
      );
      expect(evento?.metadados).toMatchObject({ solicitacaoId: criada.id, canal: 'telegram' });
      expect(JSON.stringify(evento)).not.toContain(criada.codigo);
    });

    it('a solicitacao NAO cria vinculo: nada ativo, e o Telegram continua sem acesso', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();

      await codigoPara(alvo.id);

      expect(await vinculosDe(alvo.id)).toEqual([]);
      expect(await telegram(telegramId, '/status')).toBe(TELEGRAM_UNLINKED_REPLY);
    });

    it('o corpo nao aceita id externo, usuario nem perfil', async () => {
      const alvo = await sessao(RoleName.Usuario);

      for (const corpo of [
        { canal: 'telegram', idExterno: '123' },
        { canal: 'telegram', usuarioId: admin.id },
        { canal: 'telegram', role: 'ADMIN' },
        // `whatsapp` e canal valido desde que o adaptador existe; o contrato segue estrito: canal
        // desconhecido e campo a mais continuam recusados.
        { canal: 'sms' },
        { canal: 'whatsapp', idExterno: '5511999990000' },
      ]) {
        await request(server())
          .post(`/users/${alvo.id}/external-identities/link-requests`)
          .set('Authorization', bearer(admin))
          .send(corpo)
          .expect(400);
      }
    });

    it('nao existe mais POST direto de vinculo com id externo', async () => {
      const alvo = await sessao(RoleName.Usuario);

      await request(server())
        .post(`/users/${alvo.id}/external-identities`)
        .set('Authorization', bearer(admin))
        .send({ canal: 'telegram', idExterno: novoTelegramId() })
        .expect(404);
    });

    it('lista as pendentes sem o codigo', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const { id, codigo } = await codigoPara(alvo.id);

      const response = await request(server())
        .get(`/users/${alvo.id}/external-identities/link-requests`)
        .set('Authorization', bearer(admin))
        .expect(200);

      const pendentes = response.body as LinkRequestResponseDto[];
      expect(pendentes.map((p) => p.id)).toEqual([id]);
      expect(JSON.stringify(pendentes)).not.toContain(codigo);
    });

    it('usuario inexistente: 404; inativo: 409', async () => {
      await solicitar(admin, '3f2c1a7e-0000-4000-8000-000000000000').expect(404);

      const alvo = await sessao(RoleName.Usuario);
      await request(server())
        .patch(`/users/${alvo.id}/status`)
        .set('Authorization', bearer(admin))
        .send({ ativo: false })
        .expect(200);
      await solicitar(admin, alvo.id).expect(409);
    });
  });

  describe('confirmacao pelo Telegram', () => {
    it('a conta que envia o codigo e a vinculada; a seguinte ja executa comandos', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();

      await vincular(alvo.id, telegramId);

      expect(await vinculosDe(alvo.id)).toEqual([
        expect.objectContaining({ canal: 'telegram', idExterno: telegramId }),
      ]);
      expect(await telegram(telegramId, '/status')).toContain('Canal: telegram');
      expect(await telegram(telegramId, '/ajuda')).toContain('Comandos disponiveis:');
      const evento = (await auditoria()).find(
        (log) => log.acao === 'EXTERNAL_IDENTITY_LINKED' && log.metadados?.alvoId === alvo.id,
      );
      expect(evento).toMatchObject({ usuarioId: alvo.id });
      expect(evento?.metadados).toMatchObject({ canal: 'telegram', idExterno: telegramId });
    });

    it('outra conta do Telegram nao assume a solicitacao ja confirmada', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const dono = novoTelegramId();
      const intruso = novoTelegramId();
      const { codigo } = await codigoPara(alvo.id);

      expect(await telegram(dono, `/vincular ${codigo}`)).toBe(CONFIRMADO);
      expect(await telegram(intruso, `/vincular ${codigo}`)).toBe(RECUSADO);

      expect((await vinculosDe(alvo.id)).map((l) => l.idExterno)).toEqual([dono]);
      expect(await telegram(intruso, '/status')).toBe(TELEGRAM_UNLINKED_REPLY);
    });

    it('codigo ja usado, mesmo pela propria conta: recusado', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      const { codigo } = await codigoPara(alvo.id);
      await telegram(telegramId, `/vincular ${codigo}`);

      expect(await telegram(telegramId, `/vincular ${codigo}`)).toBe(RECUSADO);
      expect(await vinculosDe(alvo.id)).toHaveLength(1);
    });

    it.each([
      ['codigo inventado', '/vincular ZZZZ-ZZZZ-ZZZZ'],
      ['sem codigo', '/vincular'],
      ['numero no lugar do codigo', '/vincular 123456789'],
    ])('%s: resposta neutra, nenhum vinculo', async (_caso, texto) => {
      const telegramId = novoTelegramId();

      expect(await telegram(telegramId, texto)).toBe(RECUSADO);
      expect(await telegram(telegramId, '/status')).toBe(TELEGRAM_UNLINKED_REPLY);
    });

    it('codigo expirado: recusado; e uma nova solicitacao pode ser feita', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      const { id, codigo } = await codigoPara(alvo.id);
      await dataSource
        .getRepository(IdentityLinkRequest)
        .update({ id }, { expiraEm: new Date(Date.now() - 1000) });

      expect(await telegram(telegramId, `/vincular ${codigo}`)).toBe(RECUSADO);
      expect(await vinculosDe(alvo.id)).toEqual([]);

      const nova = await codigoPara(alvo.id);
      expect(await telegram(telegramId, `/vincular ${nova.codigo}`)).toBe(CONFIRMADO);
    });

    it('solicitacao cancelada: o codigo deixa de valer', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const { id, codigo } = await codigoPara(alvo.id);

      await request(server())
        .delete(`/users/${alvo.id}/external-identities/link-requests/${id}`)
        .set('Authorization', bearer(admin))
        .expect(204);

      expect(await telegram(novoTelegramId(), `/vincular ${codigo}`)).toBe(RECUSADO);
    });

    it('usuario desativado antes da confirmacao: recusado', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const { codigo } = await codigoPara(alvo.id);
      await request(server())
        .patch(`/users/${alvo.id}/status`)
        .set('Authorization', bearer(admin))
        .send({ ativo: false })
        .expect(200);

      expect(await telegram(novoTelegramId(), `/vincular ${codigo}`)).toBe(RECUSADO);
      expect(await vinculosDe(alvo.id)).toEqual([]);
    });

    it('userId, telegramId e perfil vindos do Telegram sao ignorados', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      const outroTelegram = novoTelegramId();
      const { codigo } = await codigoPara(alvo.id);

      // Argumentos a mais: nem sao considerados.
      expect(await telegram(telegramId, `/vincular ${codigo} ${admin.id}`)).toBe(RECUSADO);
      expect(await telegram(telegramId, `/vincular ${outroTelegram} ${codigo}`)).toBe(RECUSADO);
      // Campos no payload: ignorados. Quem vincula e o remetente, para o alvo da solicitacao.
      expect(
        await telegram(telegramId, `/vincular ${codigo}`, { userId: admin.id, role: 'ADMIN' }),
      ).toBe(CONFIRMADO);

      expect((await vinculosDe(alvo.id)).map((l) => l.idExterno)).toEqual([telegramId]);
      expect(await vinculosDe(admin.id)).toEqual([]);
    });

    it('conta do Telegram ja vinculada nao e reassociada; nada revela o dono', async () => {
      const primeiro = await sessao(RoleName.Usuario);
      const segundo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      await vincular(primeiro.id, telegramId);
      const { codigo } = await codigoPara(segundo.id);

      const resposta = await telegram(telegramId, `/vincular ${codigo}`);

      expect(resposta).toBe(JA_VINCULADO);
      expect(resposta).not.toContain(primeiro.id);
      expect(await vinculosDe(segundo.id)).toEqual([]);
      // A solicitacao do segundo continua pendente: outra conta ainda pode confirma-la.
      expect(await telegram(novoTelegramId(), `/vincular ${codigo}`)).toBe(CONFIRMADO);
    });
  });

  /**
   * LIMITACAO DO AMBIENTE: o SQLite em memoria dos testes tem UMA conexao, e
   * duas transacoes simultaneas nela se anulam ("cannot start a transaction
   * within a transaction") - as duas confirmacoes falham e nada e gravado. No
   * MySQL/Oracle cada transacao tem a sua conexao: a segunda espera o lock da
   * linha e depois nao a encontra mais PENDENTE, entao exatamente uma passa.
   *
   * Aqui se prova o que vale em QUALQUER banco: nunca dois vinculos, nunca duas
   * confirmacoes. A exclusividade em si (codigo usado uma vez, conta ja
   * vinculada) e provada, sequencialmente, na secao de confirmacao.
   */
  describe('concorrencia', () => {
    const RESPOSTAS_POSSIVEIS = [CONFIRMADO, RECUSADO, JA_VINCULADO];

    it('o mesmo codigo enviado por duas contas ao mesmo tempo: no maximo um vinculo', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const { codigo } = await codigoPara(alvo.id);
      enviado.mockClear();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await Promise.all([
        enviar(novoTelegramId(), `/vincular ${codigo}`),
        enviar(novoTelegramId(), `/vincular ${codigo}`),
      ]);

      const respostas = enviado.mock.calls.map(([, texto]) => texto);
      expect(respostas).toHaveLength(2);
      expect(respostas.every((r) => RESPOSTAS_POSSIVEIS.includes(r))).toBe(true);
      expect(respostas.filter((r) => r === CONFIRMADO).length).toBeLessThanOrEqual(1);
      expect((await vinculosDe(alvo.id)).length).toBeLessThanOrEqual(1);
      jest.restoreAllMocks();
      enviado = jest
        .spyOn(app.get(TelegramApiClient, { strict: false }), 'sendMessage')
        .mockResolvedValue(undefined);
    });

    it('o BANCO recusa a segunda pendente, mesmo sem a checagem previa do service', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const repositorio = app.get(IdentityLinkRequestsRepository, { strict: false });
      const nova = (hash: string): Promise<unknown> =>
        repositorio.create({
          canal: IdentityChannel.Telegram,
          usuarioId: alvo.id,
          codigoHash: hash,
          expiraEm: new Date(Date.now() + 60_000),
          criadoPorId: admin.id,
        });

      await nova('a'.repeat(64));

      await expect(nova('b'.repeat(64))).rejects.toBeInstanceOf(DuplicatePendingRequestError);
    });

    it('dois inicios simultaneos para o mesmo usuario: um 201, um 409', async () => {
      const alvo = await sessao(RoleName.Usuario);

      const status = (
        await Promise.all([solicitar(admin, alvo.id), solicitar(admin, alvo.id)])
      ).map((r) => r.status);

      expect(status.sort()).toEqual([201, 409]);
    });

    it('a mesma conta confirmando dois usuarios ao mesmo tempo: no maximo um vinculo', async () => {
      const a = await sessao(RoleName.Usuario);
      const b = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      const [codigoA, codigoB] = [(await codigoPara(a.id)).codigo, (await codigoPara(b.id)).codigo];
      enviado.mockClear();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await Promise.all([
        enviar(telegramId, `/vincular ${codigoA}`),
        enviar(telegramId, `/vincular ${codigoB}`),
      ]);

      const respostas = enviado.mock.calls.map(([, t]) => t);
      expect(respostas.every((r) => RESPOSTAS_POSSIVEIS.includes(r))).toBe(true);
      expect(respostas.filter((r) => r === CONFIRMADO).length).toBeLessThanOrEqual(1);
      const total = (await vinculosDe(a.id)).length + (await vinculosDe(b.id)).length;
      expect(total).toBeLessThanOrEqual(1);
      jest.restoreAllMocks();
      enviado = jest
        .spyOn(app.get(TelegramApiClient, { strict: false }), 'sendMessage')
        .mockResolvedValue(undefined);
    });
  });

  describe('permissoes e IDOR', () => {
    it.each([RoleName.Usuario, RoleName.Operador])(
      '%s nao inicia, nao cancela e nao remove (nem os proprios)',
      async (role) => {
        const ator = await sessao(role);
        const alvo = await sessao(RoleName.Usuario);
        const pendente = await codigoPara(alvo.id);
        const telegramId = novoTelegramId();
        const outro = await sessao(RoleName.Usuario);
        await vincular(outro.id, telegramId);
        const [link] = await vinculosDe(outro.id);

        await solicitar(ator, alvo.id).expect(403);
        await solicitar(ator, ator.id).expect(403);
        await request(server())
          .delete(`/users/${alvo.id}/external-identities/link-requests/${pendente.id}`)
          .set('Authorization', bearer(ator))
          .expect(403);
        await request(server())
          .delete(`/users/${outro.id}/external-identities/${link.id}`)
          .set('Authorization', bearer(ator))
          .expect(403);
      },
    );

    it('GESTOR inicia para quem esta abaixo, nao para um ADMIN', async () => {
      const gestor = await sessao(RoleName.Gestor);
      const alvo = await sessao(RoleName.Usuario);

      await solicitar(gestor, alvo.id).expect(201);
      await solicitar(gestor, admin.id).expect(403);
    });

    it('solicitacao e vinculo de outro usuario pela rota deste: 404, nada muda', async () => {
      const dono = await sessao(RoleName.Usuario);
      const outro = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      await vincular(dono.id, telegramId);
      const [link] = await vinculosDe(dono.id);
      // Nova pendente do dono (a anterior ja foi confirmada).
      const pendente = await codigoPara(dono.id);

      await request(server())
        .delete(`/users/${outro.id}/external-identities/link-requests/${pendente.id}`)
        .set('Authorization', bearer(admin))
        .expect(404);
      await request(server())
        .delete(`/users/${outro.id}/external-identities/${link.id}`)
        .set('Authorization', bearer(admin))
        .expect(404);

      // Nada mudou: o vinculo segue valendo e a pendente ainda confirma.
      expect(await telegram(telegramId, '/status')).toContain('Canal: telegram');
      expect(await telegram(novoTelegramId(), `/vincular ${pendente.codigo}`)).toBe(CONFIRMADO);
    });
  });

  describe('depois do vinculo', () => {
    it('o CommandRouter recebe o AuthenticatedUser real, com perfil atual', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      await vincular(alvo.id, telegramId);
      const execute = jest.spyOn(app.get(CommandRouter, { strict: false }), 'execute');

      expect(await telegram(telegramId, '/financeiro')).toBe(ROUTER_MESSAGES.permissionDenied);
      expect(execute.mock.calls[0][0].user).toMatchObject({
        id: alvo.id,
        role: RoleName.Usuario,
        ativo: true,
      });

      await request(server())
        .patch(`/users/${alvo.id}/role`)
        .set('Authorization', bearer(admin))
        .send({ role: RoleName.Gestor })
        .expect(200);
      expect(await telegram(telegramId, '/financeiro')).not.toBe(ROUTER_MESSAGES.permissionDenied);
      execute.mockRestore();
    });

    it('desativar o usuario corta o acesso sem remover o vinculo', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      await vincular(alvo.id, telegramId);

      await request(server())
        .patch(`/users/${alvo.id}/status`)
        .set('Authorization', bearer(admin))
        .send({ ativo: false })
        .expect(200);

      expect(await telegram(telegramId, '/status')).toBe(TELEGRAM_UNLINKED_REPLY);
      expect(await vinculosDe(alvo.id)).toHaveLength(1);
    });

    it('remover o vinculo corta o acesso na mensagem seguinte, com auditoria', async () => {
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      await vincular(alvo.id, telegramId);
      const [link] = await vinculosDe(alvo.id);

      await request(server())
        .delete(`/users/${alvo.id}/external-identities/${link.id}`)
        .set('Authorization', bearer(admin))
        .expect(204);

      expect(await telegram(telegramId, '/status')).toBe(TELEGRAM_UNLINKED_REPLY);
      expect(
        (await auditoria()).some(
          (log) =>
            log.acao === 'EXTERNAL_IDENTITY_UNLINKED' && log.metadados?.vinculoId === link.id,
        ),
      ).toBe(true);
    });
  });

  describe('sigilo do codigo e das mensagens', () => {
    it('o codigo nao aparece em log nem na auditoria; mensagens nao sao auditadas', async () => {
      const logs = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((nivel) =>
        jest.spyOn(Logger.prototype, nivel),
      );
      const alvo = await sessao(RoleName.Usuario);
      const telegramId = novoTelegramId();
      const { codigo } = await codigoPara(alvo.id);

      await telegram(telegramId, `/vincular ${codigo}`);
      await telegram(telegramId, '/status minha-senha-secreta');
      await telegram(novoTelegramId(), `/vincular ${codigo}`);

      const semHifen = codigo.replace(/-/g, '');
      const registrado = JSON.stringify(logs.map((spy) => spy.mock.calls as unknown));
      const trilha = JSON.stringify(await auditoria());
      for (const segredo of [codigo, semHifen, 'minha-senha-secreta']) {
        expect(registrado).not.toContain(segredo);
        expect(trilha).not.toContain(segredo);
      }
      logs.forEach((spy) => {
        spy.mockRestore();
      });
    });
  });
});
