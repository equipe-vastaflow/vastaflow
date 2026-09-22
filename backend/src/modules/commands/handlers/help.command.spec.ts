import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { PermissionCode } from '../../permissions/permission-code.enum';
import { RoleName } from '../../roles/role-name.enum';
import { CommandCatalog } from '../command-catalog';
import { CommandRouter } from '../command-router.service';
import {
  commandOk,
  CommandChannel,
  CommandOutcome,
  type CommandContext,
  type CommandHandler,
} from '../command.types';
import { HelpCommandHandler } from './help.command';
import { StatusCommandHandler } from './status.command';

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

function context(actor: AuthenticatedUser = USUARIO): CommandContext {
  return {
    user: actor,
    conversationId: 'conversa-1',
    channel: CommandChannel.Test,
    text: '/ajuda',
  };
}

/** Auditoria nunca e exercitada por estes comandos; basta um duplo inerte. */
function auditService(): AuditService {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function handler(name: string, permission?: PermissionCode): CommandHandler {
  return {
    name,
    description: `descricao de ${name}`,
    permission,
    handle: () => commandOk('ok'),
  };
}

describe('HelpCommandHandler', () => {
  let catalog: CommandCatalog;
  let help: HelpCommandHandler;

  beforeEach(() => {
    catalog = new CommandCatalog();
    help = new HelpCommandHandler(catalog);
  });

  describe('contrato do comando', () => {
    it('atende por /ajuda', () => {
      expect(help.name).toBe('ajuda');
    });

    it('nao exige permissao - e publico dentro do contexto do bot', () => {
      catalog.register([help]);

      expect(catalog.find('ajuda')?.permission).toBeUndefined();
    });

    it('nao declara auditoria - comando tecnico nao entra na trilha', () => {
      catalog.register([help]);

      expect(catalog.find('ajuda')?.audit).toBeUndefined();
    });

    it('tem descricao para se listar', () => {
      expect(help.description).not.toBe('');
    });
  });

  describe('lista de comandos', () => {
    beforeEach(() => {
      catalog.register([help, new StatusCommandHandler(catalog)]);
    });

    it('inclui o proprio /ajuda na lista', () => {
      const { reply, success } = help.handle(context());

      expect(success).toBe(true);
      expect(reply).toContain('/ajuda');
      expect(reply).toContain(help.description);
    });

    it('inclui /status na lista', () => {
      expect(help.handle(context()).reply).toContain('/status');
    });

    it('lista um comando por linha', () => {
      const linhas = help.handle(context()).reply.split('\n');

      // Cabecalho + um comando por linha.
      expect(linhas).toHaveLength(3);
      expect(linhas[1]).toBe('/ajuda - Lista os comandos disponiveis');
    });

    it('sai do catalogo: um comando novo aparece sem alterar o /ajuda', () => {
      catalog.register([handler('novo')]);

      expect(help.handle(context()).reply).toContain('/novo - descricao de novo');
    });
  });

  describe('comandos restritos', () => {
    beforeEach(() => {
      catalog.register([help, handler('restrito', PermissionCode.UsersRead)]);
    });

    it('omite comandos que o usuario nao pode executar', () => {
      const { reply } = help.handle(context(USUARIO));

      expect(reply).toContain('/ajuda');
      expect(reply).not.toContain('/restrito');
    });

    it('mostra o comando a quem tem a permissao', () => {
      const gestor = user(RoleName.Gestor, [PermissionCode.UsersRead]);

      expect(help.handle(context(gestor)).reply).toContain('/restrito');
    });

    it('mostra tudo para ADMIN', () => {
      expect(help.handle(context(ADMIN)).reply).toContain('/restrito');
    });
  });

  describe('catalogo sem comandos disponiveis', () => {
    it('responde com sucesso, sem lista vazia sem sentido', () => {
      catalog.register([handler('restrito', PermissionCode.AuditRead)]);

      const { success, reply } = help.handle(context(USUARIO));

      expect(success).toBe(true);
      expect(reply).toBe('Nenhum comando disponivel para o seu perfil.');
    });
  });

  describe('pelo router', () => {
    it('/ajuda e resolvido e executado pelo motor', async () => {
      catalog.register([help, new StatusCommandHandler(catalog)]);
      const router = new CommandRouter(catalog, auditService());

      const result = await router.execute({ ...context(), text: '/ajuda' });

      expect(result.outcome).toBe(CommandOutcome.Ok);
      expect(result.reply).toContain('/ajuda');
      expect(result.reply).toContain('/status');
    });
  });
});
