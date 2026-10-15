import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CommandCatalog } from '../../commands/command-catalog';
import { CommandRouter, ROUTER_MESSAGES } from '../../commands/command-router.service';
import { CommandChannel, CommandOutcome, type CommandResult } from '../../commands/command.types';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { DEFAULT_ROLE_PERMISSIONS } from '../../roles/role-defaults';
import { RoleName } from '../../roles/role-name.enum';
import { NfseEmissionStatus } from './nfse-emission.entity';
import {
  NFSE_USAGE,
  NfseConfirmCommandHandler,
  NfseRequestCommandHandler,
  NfseStatusCommandHandler,
} from './nfse.commands';
import type { ConfirmResult, NfseService, RequestResult, StatusResult } from './nfse.service';

function person(role: RoleName, permissions: PermissionCode[] = []): AuthenticatedUser {
  return {
    id: 'user-1',
    nome: 'Pessoa',
    email: 'pessoa@example.com',
    role,
    permissions,
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const ADMIN = person(RoleName.Admin);
const OPERADOR = person(RoleName.Operador, [
  ...(DEFAULT_ROLE_PERMISSIONS[RoleName.Operador] ?? []),
]);
const SO_EMITE = person(RoleName.Operador, [PermissionCode.NfseEmit]);
const SO_LE = person(RoleName.Operador, [PermissionCode.NfseRead]);

describe('NFS-e - comandos no Command Engine (RBAC, conversa, auditoria)', () => {
  let request: jest.Mock<Promise<RequestResult>, [string, string, string]>;
  let confirm: jest.Mock<Promise<ConfirmResult>, [string, string, string, string]>;
  let status: jest.Mock<Promise<StatusResult>, [string, string | undefined]>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let router: CommandRouter;

  const run = (
    text: string,
    user: AuthenticatedUser,
    channel = CommandChannel.Telegram,
  ): Promise<CommandResult> => router.execute({ user, conversationId: 'chat-1', channel, text });

  beforeEach(() => {
    request = jest.fn<Promise<RequestResult>, [string, string, string]>();
    confirm = jest.fn<Promise<ConfirmResult>, [string, string, string, string]>();
    status = jest.fn<Promise<StatusResult>, [string, string | undefined]>();
    const service = { request, confirm, status } as unknown as NfseService;
    const catalog = new CommandCatalog();
    catalog.register([
      new NfseRequestCommandHandler(service),
      new NfseConfirmCommandHandler(service),
      new NfseStatusCommandHandler(service),
    ]);
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    router = new CommandRouter(catalog, audit as unknown as AuditService);
  });

  describe('RBAC', () => {
    it('as permissoes de NFS-e nao pertencem a NENHUM perfil por padrao, exceto o ADMIN', () => {
      for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        if (role === String(RoleName.Admin)) {
          continue;
        }
        expect(permissions).not.toContain(PermissionCode.NfseEmit);
        expect(permissions).not.toContain(PermissionCode.NfseRead);
      }
      expect(DEFAULT_ROLE_PERMISSIONS[RoleName.Operador]).toEqual([]);
    });

    it('OPERADOR com as permissoes padrao e barrado nos tres comandos, sem executar nada', async () => {
      for (const text of [
        '/nfse',
        '/nfse tomador=1',
        '/nfse_confirmar 1 ABCDEFGH',
        '/nfse_status',
      ]) {
        const result = await run(text, OPERADOR);
        expect(result).toMatchObject({
          success: false,
          outcome: CommandOutcome.PermissionDenied,
          reply: ROUTER_MESSAGES.permissionDenied,
        });
      }
      expect(request).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
    });

    it('ler nao autoriza emitir, e emitir nao autoriza ler', async () => {
      expect((await run('/nfse x=1', SO_LE)).outcome).toBe(CommandOutcome.PermissionDenied);
      expect((await run('/nfse_confirmar 1 ABCDEFGH', SO_LE)).outcome).toBe(
        CommandOutcome.PermissionDenied,
      );
      expect((await run('/nfse_status', SO_EMITE)).outcome).toBe(CommandOutcome.PermissionDenied);
      status.mockResolvedValue({ kind: 'list', items: [] });
      expect((await run('/nfse_status', SO_LE)).success).toBe(true);
    });

    it('o ADMIN passa (regra unica de hasPermission)', async () => {
      status.mockResolvedValue({ kind: 'list', items: [] });
      expect((await run('/nfse_status', ADMIN)).success).toBe(true);
    });
  });

  describe('/nfse', () => {
    it('sem argumentos mostra o formato, sem consultar o servico', async () => {
      const result = await run('/nfse', ADMIN);
      expect(result).toMatchObject({ success: true, reply: NFSE_USAGE });
      expect(request).not.toHaveBeenCalled();
    });

    it('entrega ao servico o texto cru preservando aspas e espacos, com a pessoa e o canal certos', async () => {
      request.mockResolvedValue({ kind: 'disabled' });
      await run('/nfse   nome="Maria  da Silva" valor=10', ADMIN, CommandChannel.Whatsapp);
      expect(request).toHaveBeenCalledWith('user-1', 'whatsapp', 'nome="Maria  da Silva" valor=10');
    });

    it('pedido criado: mostra resumo, instrucao exata de confirmacao e que e uso unico', async () => {
      request.mockResolvedValue({
        kind: 'created',
        numero: 12,
        summary: 'RESUMO FISCAL',
        code: 'K7M2QX9P',
        expiresInMinutes: 10,
      });
      const result = await run('/nfse valor=10', ADMIN);
      expect(result.success).toBe(true);
      expect(result.reply).toContain('RESUMO FISCAL');
      expect(result.reply).toContain('/nfse_confirmar 12 K7M2QX9P');
      expect(result.reply).toMatch(/10 minutos/);
      expect(result.reply).toMatch(/so uma vez/);
      expect(result.reply).toMatch(/portal nfse\.gov\.br/);
    });

    it('entrada invalida: lista os problemas e o formato; nao e erro do sistema', async () => {
      request.mockResolvedValue({ kind: 'invalid', errors: ['falta o campo valor', 'iss: x'] });
      const result = await run('/nfse nome=a', ADMIN);
      expect(result).toMatchObject({ success: false, outcome: CommandOutcome.MalformedCommand });
      expect(result.reply).toContain('- falta o campo valor');
      expect(result.reply).toContain(NFSE_USAGE);
    });

    it('desligada e mal configurada tem respostas proprias, sem detalhe de configuracao', async () => {
      request.mockResolvedValueOnce({ kind: 'disabled' });
      expect((await run('/nfse a=1', ADMIN)).reply).toMatch(/desligada/);
      request.mockResolvedValueOnce({ kind: 'misconfigured' });
      const mis = await run('/nfse a=1', ADMIN);
      expect(mis.reply).toMatch(/nao esta configurada/);
      expect(mis.reply).not.toMatch(/NFSE_|certificado|senha/i);
    });
  });

  describe('/nfse_confirmar', () => {
    it('exige exatamente numero e codigo: um "sim" solto nunca confirma', async () => {
      for (const text of [
        '/nfse_confirmar',
        '/nfse_confirmar sim',
        '/nfse_confirmar 1',
        '/nfse_confirmar 1 A B',
      ]) {
        const result = await run(text, ADMIN);
        expect(result).toMatchObject({ success: false, outcome: CommandOutcome.MalformedCommand });
      }
      expect((await run('sim', ADMIN)).outcome).toBe(CommandOutcome.NotACommand);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('passa pessoa, canal, numero e codigo ao servico', async () => {
      confirm.mockResolvedValue({ kind: 'not_found' });
      await run('/nfse_confirmar 12 k7m2qx9p', ADMIN, CommandChannel.Telegram);
      expect(confirm).toHaveBeenCalledWith('user-1', 'telegram', '12', 'k7m2qx9p');
    });

    it('autorizada: entrega a chave de acesso; o resultado entra na auditoria como "emitida"', async () => {
      confirm.mockResolvedValue({
        kind: 'finished',
        emission: {
          numero: 12,
          status: NfseEmissionStatus.Autorizada,
          ambiente: 'homologacao',
          chaveAcesso: '1'.repeat(50),
          erroCodigo: null,
          erroMensagem: null,
        },
      });
      const result = await run('/nfse_confirmar 12 K7M2QX9P', ADMIN);
      expect(result).toMatchObject({ success: true, auditDetail: 'emitida' });
      expect(result.reply).toContain('EMITIDA');
      expect(result.reply).toContain('1'.repeat(50));
      expect(result.reply).toContain('HOMOLOGACAO');
    });

    it('rejeitada: mostra o codigo oficial e diz que NADA foi emitido', async () => {
      confirm.mockResolvedValue({
        kind: 'finished',
        emission: {
          numero: 12,
          status: NfseEmissionStatus.Rejeitada,
          ambiente: 'homologacao',
          chaveAcesso: null,
          erroCodigo: 'E0310',
          erroMensagem: 'Codigo inexistente',
        },
      });
      const result = await run('/nfse_confirmar 12 K7M2QX9P', ADMIN);
      expect(result.success).toBe(false);
      expect(result.reply).toContain('E0310');
      expect(result.reply).toMatch(/nada foi emitido/);
    });

    it('incerta: manda NAO reenviar, consultar e conferir no portal antes de pedir outra', async () => {
      confirm.mockResolvedValue({
        kind: 'finished',
        emission: {
          numero: 12,
          status: NfseEmissionStatus.Incerta,
          ambiente: 'producao',
          chaveAcesso: null,
          erroCodigo: 'transporte_apos_envio',
          erroMensagem: null,
        },
      });
      const result = await run('/nfse_confirmar 12 K7M2QX9P', ADMIN);
      expect(result.auditDetail).toBe('incerta');
      expect(result.reply).toMatch(/RESULTADO INCERTO/);
      expect(result.reply).toMatch(/NAO crie outro pedido igual/);
      expect(result.reply).toContain('/nfse_status 12');
      expect(result.reply).toContain('PRODUCAO');
    });

    it('nao enviada explica o motivo sem vazar configuracao', async () => {
      confirm.mockResolvedValue({
        kind: 'finished',
        emission: {
          numero: 3,
          status: NfseEmissionStatus.NaoEnviada,
          ambiente: 'homologacao',
          chaveAcesso: null,
          erroCodigo: 'certificado_diverge_do_prestador',
          erroMensagem: null,
        },
      });
      const result = await run('/nfse_confirmar 3 K7M2QX9P', ADMIN);
      expect(result.reply).toMatch(/nada foi emitido/);
      expect(result.reply).toMatch(/certificado nao e do prestador/);
    });

    it('respostas de recusa nao revelam por que (outro canal, outra pessoa e codigo errado sao iguais)', async () => {
      confirm.mockResolvedValue({ kind: 'not_found' });
      const a = await run('/nfse_confirmar 12 AAAAAAAA', ADMIN);
      const b = await run('/nfse_confirmar 99 BBBBBBBB', ADMIN);
      expect(a.reply).toBe(b.reply);
      expect(a).toMatchObject({ success: false, auditDetail: 'nao_encontrado' });
    });

    it('ja confirmado, vencido, em processamento e limite de tentativas', async () => {
      confirm.mockResolvedValueOnce({
        kind: 'already_used',
        status: NfseEmissionStatus.Autorizada,
      });
      expect((await run('/nfse_confirmar 12 K7M2QX9P', ADMIN)).reply).toMatch(
        /Nao vou enviar de novo/,
      );
      confirm.mockResolvedValueOnce({ kind: 'expired' });
      expect((await run('/nfse_confirmar 12 K7M2QX9P', ADMIN)).auditDetail).toBe('expirado');
      confirm.mockResolvedValueOnce({ kind: 'processing', numero: 12 });
      const processing = await run('/nfse_confirmar 12 K7M2QX9P', ADMIN);
      expect(processing.success).toBe(true);
      expect(processing.reply).toMatch(/NAO envie de novo/);
      confirm.mockResolvedValueOnce({ kind: 'throttled' });
      expect((await run('/nfse_confirmar 12 K7M2QX9P', ADMIN)).auditDetail).toBe(
        'limite_tentativas',
      );
    });
  });

  describe('/nfse_status', () => {
    it('lista os pedidos; sem nenhum, diz isso; numero invalido e recusado', async () => {
      status.mockResolvedValueOnce({ kind: 'list', items: [] });
      expect((await run('/nfse_status', ADMIN)).reply).toBe('Nenhuma NFS-e sua encontrada.');
      expect(status).toHaveBeenLastCalledWith('user-1', undefined);
      status.mockResolvedValueOnce({ kind: 'list', items: [] });
      await run('/nfse_status 7', ADMIN);
      expect(status).toHaveBeenLastCalledWith('user-1', '7');
      status.mockResolvedValueOnce({ kind: 'bad_format' });
      expect((await run('/nfse_status abc', ADMIN)).success).toBe(false);
    });
  });

  describe('auditoria do comando', () => {
    it('grava QUEM executou e o desfecho; nunca o texto, os argumentos, o codigo nem a resposta', async () => {
      request.mockResolvedValue({
        kind: 'created',
        numero: 12,
        summary: 'RESUMO COM DADOS DO TOMADOR',
        code: 'K7M2QX9P',
        expiresInMinutes: 10,
      });
      await run('/nfse tomador=52998224725 nome="Maria Sigilosa" valor=1500', ADMIN);
      expect(audit.record).toHaveBeenCalledTimes(1);
      const event = audit.record.mock.calls[0]?.[0];
      expect(event).toMatchObject({
        usuarioId: 'user-1',
        acao: AuditAction.NfseCommand,
        modulo: AuditModuleName.Nfse,
        metadados: { comando: 'nfse', canal: 'telegram', outcome: 'OK', detalhe: 'pedido_criado' },
      });
      const text = JSON.stringify(event);
      for (const secret of [
        '52998224725',
        'Maria Sigilosa',
        'K7M2QX9P',
        'RESUMO COM DADOS',
        'conversa',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toContain('chat-1');
    });

    it('comandos barrados por permissao nao entram na trilha do negocio', async () => {
      await run('/nfse x=1', OPERADOR);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
