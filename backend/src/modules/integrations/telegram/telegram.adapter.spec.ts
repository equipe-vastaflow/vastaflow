import { Logger } from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CommandCatalog } from '../../commands/command-catalog';
import { CommandRouter, ROUTER_MESSAGES } from '../../commands/command-router.service';
import {
  CommandChannel,
  type CommandContext,
  type CommandHandler,
} from '../../commands/command.types';
import { HelpCommandHandler } from '../../commands/handlers/help.command';
import { StatusCommandHandler } from '../../commands/handlers/status.command';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { RoleName } from '../../roles/role-name.enum';
import {
  type ChannelIdentityResolver,
  UnlinkedIdentityResolver,
} from '../channels/channel-identity';
import type { ExternalIdentity } from '../channels/incoming-message';
import { TelegramApiError, type TelegramApiClient } from './telegram-api.client';
import { TelegramAdapter, TelegramUpdateOutcome } from './telegram.adapter';
import { TELEGRAM_UNLINKED_REPLY } from './telegram-reply';

const TOKEN_FALSO = 'TOKEN-FALSO-DE-TESTE-nao-e-token-real';
const CHAT = 4242;

/** Usuario interno que um resolvedor DE TESTE devolve - nao existe em producao. */
const VINCULADO: AuthenticatedUser = {
  id: 'usuario-interno-1',
  nome: 'Pessoa Vinculada',
  email: 'vinculada@vasta.test',
  role: RoleName.Usuario,
  permissions: [],
  ativo: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function update(text: string, extra: Record<string, unknown> = {}): unknown {
  return {
    update_id: 1,
    message: {
      message_id: 9,
      date: 1_790_000_000,
      chat: { id: CHAT, type: 'private' },
      from: { id: CHAT, is_bot: false, username: 'remetente' },
      text,
      ...extra,
    },
  };
}

interface ClienteFalso {
  sendMessage: jest.Mock<Promise<void>, [string, string]>;
}

interface ResolvedorFalso {
  resolve: jest.Mock<Promise<AuthenticatedUser | null>, [ExternalIdentity]>;
}

describe('TelegramAdapter', () => {
  let catalog: CommandCatalog;
  let router: CommandRouter;
  let execute: jest.SpiedFunction<CommandRouter['execute']>;
  let client: ClienteFalso;
  let audit: { record: jest.Mock };

  /** Comando de teste que exige permissao, para provar que o RBAC vale no canal. */
  const restrito: CommandHandler = {
    name: 'restrito',
    description: 'Exige finance:read',
    permission: PermissionCode.FinanceRead,
    handle: () => ({ success: true, outcome: 'OK' as never, reply: 'nao deveria chegar' }),
  };

  function adapter(resolver: ChannelIdentityResolver): TelegramAdapter {
    return new TelegramAdapter(router, client as unknown as TelegramApiClient, resolver);
  }

  function vinculado(): ResolvedorFalso {
    return {
      resolve: jest.fn((_identity: ExternalIdentity) =>
        Promise.resolve<AuthenticatedUser | null>(VINCULADO),
      ),
    };
  }

  /** Texto enviado ao Telegram na unica resposta do teste. */
  function respostaEnviada(): string {
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, texto] = client.sendMessage.mock.calls[0];
    expect(chatId).toBe(String(CHAT));
    return texto;
  }

  beforeEach(() => {
    // O MESMO motor da aplicacao: catalogo, parser, router e handlers reais.
    catalog = new CommandCatalog();
    catalog.register([
      new HelpCommandHandler(catalog),
      new StatusCommandHandler(catalog),
      restrito,
    ]);
    audit = { record: jest.fn() };
    router = new CommandRouter(catalog, audit as unknown as AuditService);
    execute = jest.spyOn(router, 'execute');
    client = { sendMessage: jest.fn((_chatId: string, _texto: string) => Promise.resolve()) };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sem vinculo (resolvedor desta etapa)', () => {
    it('/ajuda nao chega ao motor: responde que a conta nao esta vinculada', async () => {
      const resultado = await adapter(new UnlinkedIdentityResolver()).handleUpdate(
        update('/ajuda'),
      );

      expect(resultado).toBe(TelegramUpdateOutcome.Unlinked);
      expect(execute).not.toHaveBeenCalled();
      expect(respostaEnviada()).toBe(TELEGRAM_UNLINKED_REPLY);
    });

    it('/status tambem nao executa, e nada vai para a auditoria', async () => {
      await adapter(new UnlinkedIdentityResolver()).handleUpdate(update('/status'));

      expect(execute).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(respostaEnviada()).toBe(TELEGRAM_UNLINKED_REPLY);
    });

    it('falha do resolvedor conta como nao vinculado, nunca como acesso', async () => {
      const quebrado: ResolvedorFalso = {
        resolve: jest.fn((_identity: ExternalIdentity) =>
          Promise.reject<AuthenticatedUser | null>(new Error('banco fora')),
        ),
      };

      const resultado = await adapter(quebrado).handleUpdate(update('/ajuda'));

      expect(resultado).toBe(TelegramUpdateOutcome.Unlinked);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('identidade', () => {
    it('o resolvedor recebe SO a identidade externa: canal e id do remetente', async () => {
      const resolver = vinculado();

      await adapter(resolver).handleUpdate(update('/ajuda'));

      expect(resolver.resolve).toHaveBeenCalledWith({
        channel: 'telegram',
        externalId: String(CHAT),
      });
      expect(Object.keys(resolver.resolve.mock.calls[0][0]).sort()).toEqual([
        'channel',
        'externalId',
      ]);
    });

    it('userId no texto ou no payload nao escolhe o usuario interno', async () => {
      const resolver = vinculado();

      await adapter(resolver).handleUpdate(
        update('/ajuda {"userId":"admin-interno"}', { userId: 'admin-interno' }),
      );

      expect(resolver.resolve.mock.calls[0][0]).toEqual({
        channel: 'telegram',
        externalId: String(CHAT),
      });
      const [contexto] = execute.mock.calls[0];
      expect(contexto.user).toBe(VINCULADO);
      expect(contexto.user.id).not.toBe('admin-interno');
    });
  });

  describe('com vinculo (resolvedor de teste): o mesmo Command Engine', () => {
    it('/ajuda chega ao CommandRouter com um CommandContext neutro', async () => {
      const resultado = await adapter(vinculado()).handleUpdate(update('/ajuda'));

      expect(resultado).toBe(TelegramUpdateOutcome.Executed);
      expect(execute).toHaveBeenCalledTimes(1);
      const [contexto] = execute.mock.calls[0];
      const esperado: CommandContext = {
        user: VINCULADO,
        conversationId: String(CHAT),
        channel: CommandChannel.Telegram,
        text: '/ajuda',
      };
      expect(contexto).toEqual(esperado);
      expect(Object.keys(contexto).sort()).toEqual(
        ['channel', 'conversationId', 'text', 'user'].sort(),
      );
    });

    it('/ajuda: a resposta do motor vai ao Telegram, filtrada pelo perfil', async () => {
      await adapter(vinculado()).handleUpdate(update('/ajuda'));

      const texto = respostaEnviada();
      expect(texto).toContain('Comandos disponiveis:');
      expect(texto).toContain('/ajuda');
      expect(texto).toContain('/status');
      // Sem finance:read, o comando restrito nem aparece.
      expect(texto).not.toContain('/restrito');
    });

    it('/status: responde pelo motor, identificando o canal', async () => {
      await adapter(vinculado()).handleUpdate(update('/status'));

      const texto = respostaEnviada();
      expect(texto).toContain('Motor de comandos operacional.');
      expect(texto).toContain('Canal: telegram');
    });

    it.each([
      ['comando desconhecido', '/inexistente', ROUTER_MESSAGES.unknown('inexistente')],
      ['comando sem permissao', '/restrito', ROUTER_MESSAGES.permissionDenied],
      ['texto que nao e comando', 'oi, tudo bem?', ROUTER_MESSAGES.notACommand],
      ['comando malformado', '/aju-da', ROUTER_MESSAGES.malformed],
    ])('%s: responde o texto do proprio motor', async (_caso, texto, esperado) => {
      await adapter(vinculado()).handleUpdate(update(texto));

      expect(respostaEnviada()).toBe(esperado);
    });

    it('handler que quebra: mensagem generica, sem detalhe interno', async () => {
      catalog.register([
        {
          name: 'quebra',
          description: 'Falha de proposito',
          handle: () => {
            throw new Error('detalhe interno: tabela users');
          },
        },
      ]);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await adapter(vinculado()).handleUpdate(update('/quebra'));

      const texto = respostaEnviada();
      expect(texto).toBe(ROUTER_MESSAGES.handlerError);
      expect(texto).not.toContain('tabela');
    });
  });

  describe('updates ignorados', () => {
    it('mensagem de grupo: nem identidade, nem motor, nem resposta', async () => {
      const resolver = vinculado();
      const grupo = {
        update_id: 1,
        message: {
          date: 1,
          chat: { id: -100, type: 'group' },
          from: { id: 1, is_bot: false },
          text: '/ajuda',
        },
      };

      expect(await adapter(resolver).handleUpdate(grupo)).toBe(TelegramUpdateOutcome.Ignored);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(client.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('falha ao responder', () => {
    it('erro do Telegram no envio: nao lanca, e o log nao leva token', async () => {
      client.sendMessage.mockRejectedValue(new TelegramApiError('sendMessage', 'http', 403));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const resultado = await adapter(vinculado()).handleUpdate(update('/ajuda'));

      expect(resultado).toBe(TelegramUpdateOutcome.ReplyFailed);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('sendMessage falhou: http 403'));
      expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN_FALSO);
    });

    it('erro desconhecido no envio: log com o nome do erro, nunca a mensagem', async () => {
      client.sendMessage.mockRejectedValue(
        new Error(`https://api.telegram.org/bot${TOKEN_FALSO}/sendMessage`),
      );
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await adapter(vinculado()).handleUpdate(update('/ajuda'));

      expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN_FALSO);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('api.telegram.org');
    });
  });

  describe('observabilidade', () => {
    it('os logs nao levam o texto da mensagem, o id do remetente nem a resposta', async () => {
      const logs = [
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      ];

      await adapter(vinculado()).handleUpdate(update('/ajuda minha-senha-secreta'));

      const registrado = JSON.stringify(logs.map((spy) => spy.mock.calls));
      expect(registrado).not.toContain('minha-senha-secreta');
      expect(registrado).not.toContain(String(CHAT));
      expect(registrado).not.toContain('Comandos disponiveis');
    });
  });
});
