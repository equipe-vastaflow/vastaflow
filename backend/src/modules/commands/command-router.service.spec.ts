import { Logger } from '@nestjs/common';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PermissionCode } from '../permissions/permission-code.enum';
import { RoleName } from '../roles/role-name.enum';
import { CommandCatalog } from './command-catalog';
import { CommandRouter, ROUTER_MESSAGES } from './command-router.service';
import {
  commandOk,
  CommandChannel,
  CommandOutcome,
  type CommandContext,
  type CommandHandler,
} from './command.types';

function user(role: RoleName, permissions: PermissionCode[] = []): AuthenticatedUser {
  return {
    id: 'user-1',
    nome: 'Quem Enviou',
    email: 'quem@example.com',
    role,
    permissions,
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const USUARIO = user(RoleName.Usuario);
const ADMIN = user(RoleName.Admin);

function context(text: string, actor: AuthenticatedUser = USUARIO): CommandContext {
  return {
    user: actor,
    conversationId: 'conversa-1',
    channel: CommandChannel.Test,
    text,
  };
}

/** Handler minimo e configuravel, sem dependencia de nenhum comando real. */
function handler(overrides: Partial<CommandHandler> & { name: string }): CommandHandler {
  return {
    description: `descricao de ${overrides.name}`,
    handle: () => commandOk(`executou ${overrides.name}`),
    ...overrides,
  };
}

describe('CommandRouter', () => {
  let catalog: CommandCatalog;
  let auditService: jest.Mocked<Pick<AuditService, 'record'>>;
  let router: CommandRouter;

  beforeEach(() => {
    // O router loga falhas de handler; silenciar mantem a saida do teste limpa.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    catalog = new CommandCatalog();
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    router = new CommandRouter(catalog, auditService as unknown as AuditService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('encontra e executa o handler', () => {
    it('executa o handler do comando pedido', async () => {
      const handle = jest.fn().mockReturnValue(commandOk('pronto'));
      catalog.register([handler({ name: 'teste', handle })]);

      const result = await router.execute(context('/teste'));

      expect(handle).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, outcome: CommandOutcome.Ok, reply: 'pronto' });
    });

    it('entrega ao handler o contexto ja normalizado', async () => {
      const handle = jest.fn().mockReturnValue(commandOk('pronto'));
      catalog.register([handler({ name: 'teste', handle })]);
      const ctx = context('/teste arg1');

      await router.execute(ctx);

      expect(handle).toHaveBeenCalledWith(ctx);
    });

    it('aceita handler assincrono', async () => {
      catalog.register([
        handler({ name: 'lento', handle: () => Promise.resolve(commandOk('demorou')) }),
      ]);

      expect((await router.execute(context('/lento'))).reply).toBe('demorou');
    });

    it('localiza o handler ignorando maiusculas', async () => {
      catalog.register([handler({ name: 'teste' })]);

      expect((await router.execute(context('/TESTE'))).success).toBe(true);
    });

    it('escolhe o handler certo entre varios registrados', async () => {
      catalog.register([handler({ name: 'um' }), handler({ name: 'dois' })]);

      expect((await router.execute(context('/dois'))).reply).toBe('executou dois');
    });
  });

  describe('comando inexistente', () => {
    it('devolve UNKNOWN_COMMAND sem executar nada', async () => {
      const handle = jest.fn();
      catalog.register([handler({ name: 'teste', handle })]);

      const result = await router.execute(context('/naoexiste'));

      expect(handle).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        outcome: CommandOutcome.UnknownCommand,
        reply: ROUTER_MESSAGES.unknown('naoexiste'),
      });
    });

    it('com o catalogo vazio, todo comando e desconhecido', async () => {
      expect((await router.execute(context('/ajuda'))).outcome).toBe(CommandOutcome.UnknownCommand);
    });
  });

  describe('mensagens que nao chegam a um handler', () => {
    beforeEach(() => {
      catalog.register([handler({ name: 'teste' })]);
    });

    it.each([
      ['', CommandOutcome.EmptyMessage, ROUTER_MESSAGES.empty],
      ['   ', CommandOutcome.EmptyMessage, ROUTER_MESSAGES.empty],
      ['bom dia', CommandOutcome.NotACommand, ROUTER_MESSAGES.notACommand],
      ['/', CommandOutcome.MalformedCommand, ROUTER_MESSAGES.malformed],
      ['/aju-da', CommandOutcome.MalformedCommand, ROUTER_MESSAGES.malformed],
    ])('%j resulta em %s', async (text, outcome, reply) => {
      expect(await router.execute(context(text))).toEqual({ success: false, outcome, reply });
    });
  });

  describe('permissao', () => {
    it('comando sem permissao declarada roda para qualquer usuario identificado', async () => {
      catalog.register([handler({ name: 'publico' })]);

      expect((await router.execute(context('/publico', USUARIO))).success).toBe(true);
    });

    it('comando com permissao e negado a quem nao a tem, sem executar o handler', async () => {
      const handle = jest.fn();
      catalog.register([
        handler({ name: 'restrito', permission: PermissionCode.UsersRead, handle }),
      ]);

      const result = await router.execute(context('/restrito', USUARIO));

      expect(handle).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        outcome: CommandOutcome.PermissionDenied,
        reply: ROUTER_MESSAGES.permissionDenied,
      });
    });

    it('comando com permissao roda para quem a possui', async () => {
      catalog.register([handler({ name: 'restrito', permission: PermissionCode.UsersRead })]);

      const autorizado = user(RoleName.Gestor, [PermissionCode.UsersRead]);
      expect((await router.execute(context('/restrito', autorizado))).success).toBe(true);
    });

    it('ADMIN executa qualquer comando, como no PermissionsGuard', async () => {
      catalog.register([handler({ name: 'restrito', permission: PermissionCode.AuditRead })]);

      expect((await router.execute(context('/restrito', ADMIN))).success).toBe(true);
    });
  });

  describe('handler com erro', () => {
    it('devolve HANDLER_ERROR em vez de propagar a excecao', async () => {
      catalog.register([
        handler({
          name: 'quebrado',
          handle: () => {
            throw new Error('falha interna com C:\\caminho\\secreto');
          },
        }),
      ]);

      const result = await router.execute(context('/quebrado'));

      expect(result).toEqual({
        success: false,
        outcome: CommandOutcome.HandlerError,
        reply: ROUTER_MESSAGES.handlerError,
      });
    });

    it('trata promise rejeitada do mesmo jeito', async () => {
      catalog.register([
        handler({ name: 'quebrado', handle: () => Promise.reject(new Error('falhou')) }),
      ]);

      expect((await router.execute(context('/quebrado'))).outcome).toBe(
        CommandOutcome.HandlerError,
      );
    });

    it('nao expoe mensagem de excecao nem stack trace ao usuario', async () => {
      catalog.register([
        handler({
          name: 'quebrado',
          handle: () => {
            throw new Error('SENHA=segredo123 em C:\\app\\src\\arquivo.ts');
          },
        }),
      ]);

      const { reply } = await router.execute(context('/quebrado'));

      expect(reply).not.toMatch(/segredo123|SENHA|\.ts|Error|at /i);
    });

    it('registra a falha no log do servidor', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error');
      catalog.register([
        handler({
          name: 'quebrado',
          handle: () => {
            throw new Error('falhou');
          },
        }),
      ]);

      await router.execute(context('/quebrado'));

      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('um handler quebrado nao impede os outros de funcionarem', async () => {
      catalog.register([
        handler({
          name: 'quebrado',
          handle: () => {
            throw new Error('falhou');
          },
        }),
        handler({ name: 'saudavel' }),
      ]);

      await router.execute(context('/quebrado'));

      expect((await router.execute(context('/saudavel'))).success).toBe(true);
    });
  });

  describe('auditoria opt-in', () => {
    // Usa acao/modulo que ja existem no catalogo de auditoria: o motor nao
    // inventa vocabulario de negocio - quem o cria e o modulo de negocio.
    const AUDIT = { acao: AuditAction.UserUpdated, modulo: AuditModuleName.Users };

    it('comando sem `audit` declarado nao gera evento', async () => {
      catalog.register([handler({ name: 'tecnico' })]);

      await router.execute(context('/tecnico'));

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('comando com `audit` grava um evento com a acao e o modulo declarados', async () => {
      catalog.register([handler({ name: 'negocio', audit: AUDIT })]);

      await router.execute(context('/negocio'));

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ acao: AUDIT.acao, modulo: AUDIT.modulo }),
      );
    });

    it('atribui o evento ao usuario do contexto', async () => {
      catalog.register([handler({ name: 'negocio', audit: AUDIT })]);

      await router.execute(context('/negocio', ADMIN));

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: ADMIN.id }),
      );
    });

    it('registra o comando, o canal e a conversa nos metadados', async () => {
      catalog.register([handler({ name: 'negocio', audit: AUDIT })]);

      await router.execute(context('/negocio'));

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadados: {
            comando: 'negocio',
            canal: CommandChannel.Test,
            conversationId: 'conversa-1',
            outcome: CommandOutcome.Ok,
          },
        }),
      );
    });

    it('grava tambem quando o handler falha, marcando o desfecho', async () => {
      catalog.register([
        handler({
          name: 'negocio',
          audit: AUDIT,
          handle: () => {
            throw new Error('falhou');
          },
        }),
      ]);

      await router.execute(context('/negocio'));

      const [event] = auditService.record.mock.calls[0];
      expect(event.descricao).toContain('falhou');
      expect(event.metadados?.outcome).toBe(CommandOutcome.HandlerError);
    });

    it('nao grava quando o comando e barrado por permissao - o handler nao rodou', async () => {
      catalog.register([
        handler({ name: 'negocio', audit: AUDIT, permission: PermissionCode.UsersRead }),
      ]);

      await router.execute(context('/negocio', USUARIO));

      expect(auditService.record).not.toHaveBeenCalled();
    });

    it.each(['', 'bom dia', '/', '/naoexiste'])(
      'nao grava evento para %j, que nao chega a um handler',
      async (text) => {
        catalog.register([handler({ name: 'negocio', audit: AUDIT })]);

        await router.execute(context(text));

        expect(auditService.record).not.toHaveBeenCalled();
      },
    );

    it('uma falha ao gravar a auditoria nao derruba o comando', async () => {
      auditService.record.mockRejectedValueOnce(new Error('banco indisponivel'));
      catalog.register([handler({ name: 'negocio', audit: AUDIT })]);

      const result = await router.execute(context('/negocio'));

      expect(result).toEqual({
        success: true,
        outcome: CommandOutcome.Ok,
        reply: 'executou negocio',
      });
    });
  });

  describe('auditoria nao recebe dado sensivel', () => {
    const AUDIT = { acao: AuditAction.UserUpdated, modulo: AuditModuleName.Users };
    const SEGREDO = 'SenhaSuperSecreta123';

    async function recordedEventFor(text: string): Promise<string> {
      catalog.register([handler({ name: 'negocio', audit: AUDIT })]);
      await router.execute(context(text));
      return JSON.stringify(auditService.record.mock.calls[0][0]);
    }

    it('nao envia o texto cru da mensagem nem os argumentos', async () => {
      // O usuario digita livremente: os argumentos podem conter senha, token ou
      // documento. A higienizacao do AuditService remove por NOME de chave e
      // nao teria como saber que o valor dentro de `args` e sensivel.
      const event = await recordedEventFor(`/negocio ${SEGREDO}`);

      expect(event).not.toContain(SEGREDO);
      expect(event).not.toContain('args');
    });

    it('nao envia a resposta do comando, que pode conter dados de negocio', async () => {
      catalog.register([
        handler({ name: 'sigiloso', audit: AUDIT, handle: () => commandOk(SEGREDO) }),
      ]);

      await router.execute(context('/sigiloso'));

      expect(JSON.stringify(auditService.record.mock.calls[0][0])).not.toContain(SEGREDO);
    });

    it('nao envia dados pessoais de quem executou, alem do id', async () => {
      const event = await recordedEventFor('/negocio');

      expect(event).not.toContain(USUARIO.email);
      expect(event).not.toContain(USUARIO.nome);
      expect(event).toContain(USUARIO.id);
    });

    it('envia apenas a lista fechada de campos previstos', async () => {
      await recordedEventFor('/negocio arg1');
      const [event] = auditService.record.mock.calls[0];

      expect(Object.keys(event).sort()).toEqual([
        'acao',
        'descricao',
        'metadados',
        'modulo',
        'usuarioId',
      ]);
      expect(Object.keys(event.metadados ?? {}).sort()).toEqual([
        'canal',
        'comando',
        'conversationId',
        'outcome',
      ]);
    });
  });

  it('nunca lanca excecao - o adaptador sempre recebe um resultado', async () => {
    auditService.record.mockRejectedValue(new Error('auditoria indisponivel'));
    catalog.register([
      handler({
        name: 'quebrado',
        handle: () => {
          throw new Error('falhou');
        },
      }),
      handler({
        name: 'auditado',
        audit: { acao: AuditAction.UserUpdated, modulo: AuditModuleName.Users },
      }),
    ]);

    for (const text of ['', 'oi', '/', '/naoexiste', '/quebrado', '/auditado']) {
      await expect(router.execute(context(text))).resolves.toHaveProperty('reply');
    }
  });
});

describe('CommandCatalog', () => {
  it('encontra o handler registrado pelo nome', () => {
    const catalog = new CommandCatalog();
    const teste = handler({ name: 'teste' });
    catalog.register([teste]);

    expect(catalog.find('teste')).toBe(teste);
  });

  it('devolve undefined para nome nao registrado', () => {
    expect(new CommandCatalog().find('teste')).toBeUndefined();
  });

  it('lista os comandos ordenados por nome', () => {
    const catalog = new CommandCatalog();
    catalog.register([handler({ name: 'status' }), handler({ name: 'ajuda' })]);

    expect(catalog.all().map((h) => h.name)).toEqual(['ajuda', 'status']);
  });

  it('acumula registros de chamadas diferentes', () => {
    const catalog = new CommandCatalog();
    catalog.register([handler({ name: 'um' })]);
    catalog.register([handler({ name: 'dois' })]);

    expect(catalog.all()).toHaveLength(2);
  });

  it('rejeita nome duplicado em vez de sombrear o comando existente', () => {
    const catalog = new CommandCatalog();
    catalog.register([handler({ name: 'teste' })]);

    expect(() => catalog.register([handler({ name: 'teste' })])).toThrow(/duplicado/i);
  });
});
