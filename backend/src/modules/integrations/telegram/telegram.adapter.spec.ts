import { Logger } from '@nestjs/common';
import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { CommandCatalog } from '../../commands/command-catalog';
import { CommandRouter, ROUTER_MESSAGES } from '../../commands/command-router.service';
import {
  CommandChannel,
  commandOk,
  type CommandContext,
  type CommandHandler,
} from '../../commands/command.types';
import { HelpCommandHandler } from '../../commands/handlers/help.command';
import { StatusCommandHandler } from '../../commands/handlers/status.command';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { RoleName } from '../../roles/role-name.enum';
import { type ChannelIdentityResolver } from '../channels/channel-identity';
import { type ChannelLinkConfirmer, LinkConfirmationOutcome } from '../channels/channel-link';
import type { ExternalIdentity } from '../channels/incoming-message';
import { DatabaseIdentityResolver } from '../../external-identities/database-identity.resolver';
import type { ExternalIdentityLink } from '../../external-identities/entities/external-identity-link.entity';
import type { ExternalIdentitiesRepository } from '../../external-identities/external-identities.repository';
import { IdentityChannel } from '../../external-identities/external-identity.enums';
import type { Permission } from '../../permissions/entities/permission.entity';
import type { User } from '../../users/entities/user.entity';
import type { UsersService } from '../../users/users.service';
import { TelegramApiError, type TelegramApiClient } from './telegram-api.client';
import { TelegramAdapter, TelegramUpdateOutcome } from './telegram.adapter';
import { linkConfirmationReply, TELEGRAM_UNLINKED_REPLY } from './telegram-reply';

/** Resolvedor sem nenhum vinculo: toda identidade externa resolve para null. */
const SEM_VINCULO: ChannelIdentityResolver = { resolve: () => Promise.resolve(null) };

/** Confirmador que nunca reconhece a mensagem: ela segue o fluxo normal. */
const NAO_E_CONFIRMACAO: ChannelLinkConfirmer = {
  tryConfirm: () => Promise.resolve(LinkConfirmationOutcome.NotAttempted),
};

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
    handle: () => commandOk('Conteudo restrito'),
  };

  function adapter(
    resolver: ChannelIdentityResolver,
    confirmer: ChannelLinkConfirmer = NAO_E_CONFIRMACAO,
  ): TelegramAdapter {
    return new TelegramAdapter(router, client as unknown as TelegramApiClient, resolver, confirmer);
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

  describe('sem vinculo', () => {
    it('/ajuda nao chega ao motor: responde que a conta nao esta vinculada', async () => {
      const resultado = await adapter(SEM_VINCULO).handleUpdate(update('/ajuda'));

      expect(resultado).toBe(TelegramUpdateOutcome.Unlinked);
      expect(execute).not.toHaveBeenCalled();
      expect(respostaEnviada()).toBe(TELEGRAM_UNLINKED_REPLY);
    });

    it('/status tambem nao executa, e nada vai para a auditoria', async () => {
      await adapter(SEM_VINCULO).handleUpdate(update('/status'));

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

  /**
   * O resolvedor REAL (vinculo -> usuario atual), com o banco trocado por
   * fakes: prova que o RBAC e o estado da conta valem no canal.
   */
  describe('com o resolvedor do banco', () => {
    let vinculos: Map<string, string>;
    let usuarios: Map<string, User>;

    function usuario(id: string, codes: string[], ativo = true): User {
      return {
        id,
        nome: id,
        email: `${id}@vasta.test`,
        senhaHash: '$2b$04$hash',
        ativo,
        role: {
          id: 'r',
          nome: codes.length > 0 ? RoleName.Gestor : RoleName.Usuario,
          descricao: '',
          permissions: codes.map((code) => ({ id: code, code }) as Permission),
          createdAt: new Date(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    function doBanco(): DatabaseIdentityResolver {
      const repo = {
        findByIdentity: (
          canal: string,
          idExterno: string,
        ): Promise<ExternalIdentityLink | null> => {
          const usuarioId = vinculos.get(`${canal}:${idExterno}`);
          return Promise.resolve(
            usuarioId === undefined
              ? null
              : {
                  id: 'l',
                  canal: IdentityChannel.Telegram,
                  idExterno,
                  usuarioId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
          );
        },
      };
      const users = { findById: (id: string) => Promise.resolve(usuarios.get(id) ?? null) };
      return new DatabaseIdentityResolver(
        repo as unknown as ExternalIdentitiesRepository,
        users as unknown as UsersService,
      );
    }

    beforeEach(() => {
      vinculos = new Map([[`telegram:${CHAT}`, 'u-vinculado']]);
      usuarios = new Map([['u-vinculado', usuario('u-vinculado', [])]]);
    });

    it('vinculado e ativo: /status executa pelo CommandRouter', async () => {
      expect(await adapter(doBanco()).handleUpdate(update('/status'))).toBe(
        TelegramUpdateOutcome.Executed,
      );
      expect(execute.mock.calls[0][0].user.id).toBe('u-vinculado');
      expect(respostaEnviada()).toContain('Canal: telegram');
    });

    it('nao vinculado: nao executa', async () => {
      vinculos.clear();

      expect(await adapter(doBanco()).handleUpdate(update('/status'))).toBe(
        TelegramUpdateOutcome.Unlinked,
      );
      expect(execute).not.toHaveBeenCalled();
    });

    it('vinculado mas inativo: nao executa', async () => {
      usuarios.set('u-vinculado', usuario('u-vinculado', [], false));

      expect(await adapter(doBanco()).handleUpdate(update('/status'))).toBe(
        TelegramUpdateOutcome.Unlinked,
      );
      expect(execute).not.toHaveBeenCalled();
    });

    it('sem a permissao: comando protegido negado pelo RBAC do motor', async () => {
      await adapter(doBanco()).handleUpdate(update('/restrito'));

      expect(respostaEnviada()).toBe(ROUTER_MESSAGES.permissionDenied);
    });

    it('o perfil ATUAL vale: ganhou a permissao, o proximo comando passa', async () => {
      const resolver = doBanco();
      await adapter(resolver).handleUpdate(update('/restrito'));
      usuarios.set('u-vinculado', usuario('u-vinculado', ['finance:read']));
      await adapter(resolver).handleUpdate(update('/restrito'));

      expect(client.sendMessage.mock.calls.map(([, texto]) => texto)).toEqual([
        ROUTER_MESSAGES.permissionDenied,
        'Conteudo restrito',
      ]);
    });

    it('texto e payload nao escolhem o usuario: so o remetente vinculado conta', async () => {
      await adapter(doBanco()).handleUpdate(
        update('/status {"userId":"u-outro"}', { userId: 'u-outro', from_user_id: 'u-outro' }),
      );

      // O remetente 4242 esta vinculado a u-vinculado; nada leva a u-outro.
      expect(execute.mock.calls[0][0].user.id).toBe('u-vinculado');
    });
  });

  /**
   * Confirmacao de posse (`/vincular <codigo>`): tratada pelo confirmador ANTES
   * da identidade, e nunca chega ao Command Engine.
   */
  describe('confirmacao de vinculo', () => {
    interface ConfirmadorFalso {
      tryConfirm: jest.Mock<Promise<LinkConfirmationOutcome>, [ExternalIdentity, string]>;
    }

    function confirmador(resultado: LinkConfirmationOutcome): ConfirmadorFalso {
      return {
        tryConfirm: jest.fn((_s: ExternalIdentity, _t: string) => Promise.resolve(resultado)),
      };
    }

    it('o confirmador recebe o REMETENTE e o texto - nada mais', async () => {
      const confirmer = confirmador(LinkConfirmationOutcome.Confirmed);

      await adapter(SEM_VINCULO, confirmer).handleUpdate(
        update('/vincular K7QM-2XRA-9CVB', { userId: 'admin-interno' }),
      );

      expect(confirmer.tryConfirm).toHaveBeenCalledWith(
        { channel: 'telegram', externalId: String(CHAT) },
        '/vincular K7QM-2XRA-9CVB',
      );
    });

    it.each([
      [LinkConfirmationOutcome.Confirmed, TelegramUpdateOutcome.LinkConfirmed],
      [LinkConfirmationOutcome.Rejected, TelegramUpdateOutcome.LinkRejected],
      [LinkConfirmationOutcome.AlreadyLinked, TelegramUpdateOutcome.LinkRejected],
    ] as const)(
      '%s: responde e NAO passa pelo motor nem pela identidade',
      async (resultado, esperado) => {
        const resolver = vinculado();

        const desfecho = await adapter(resolver, confirmador(resultado)).handleUpdate(
          update('/vincular K7QM-2XRA-9CVB'),
        );

        expect(desfecho).toBe(esperado);
        expect(respostaEnviada()).toBe(linkConfirmationReply(resultado));
        expect(execute).not.toHaveBeenCalled();
        expect(resolver.resolve).not.toHaveBeenCalled();
      },
    );

    it('falha do confirmador vira recusa, nunca vinculo', async () => {
      const quebrado: ConfirmadorFalso = {
        tryConfirm: jest.fn((_s: ExternalIdentity, _t: string) =>
          Promise.reject<LinkConfirmationOutcome>(new Error('banco fora')),
        ),
      };
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      expect(await adapter(SEM_VINCULO, quebrado).handleUpdate(update('/vincular X'))).toBe(
        TelegramUpdateOutcome.LinkRejected,
      );
      expect(respostaEnviada()).toBe(linkConfirmationReply(LinkConfirmationOutcome.Rejected));
    });

    it('mensagem que nao e confirmacao segue para identidade e motor', async () => {
      const confirmer = confirmador(LinkConfirmationOutcome.NotAttempted);

      await adapter(vinculado(), confirmer).handleUpdate(update('/status'));

      expect(confirmer.tryConfirm).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('a recusa e a mesma resposta para qualquer motivo (nao ensina sobre codigos)', () => {
      expect(linkConfirmationReply(LinkConfirmationOutcome.Rejected)).not.toMatch(
        /expirad|usad|inexistente|inativ/i,
      );
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
