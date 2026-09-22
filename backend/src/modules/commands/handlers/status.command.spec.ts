import type { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { RoleName } from '../../roles/role-name.enum';
import { CommandCatalog } from '../command-catalog';
import { CommandRouter } from '../command-router.service';
import { CommandChannel, CommandOutcome, type CommandContext } from '../command.types';
import { HelpCommandHandler } from './help.command';
import { formatUptime, StatusCommandHandler } from './status.command';

const USUARIO: AuthenticatedUser = {
  id: 'user-1',
  nome: 'Quem Enviou',
  email: 'quem@example.com',
  role: RoleName.Usuario,
  permissions: [],
  ativo: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function context(): CommandContext {
  return {
    user: USUARIO,
    conversationId: 'conversa-1',
    channel: CommandChannel.Test,
    text: '/status',
  };
}

describe('StatusCommandHandler', () => {
  let catalog: CommandCatalog;
  let status: StatusCommandHandler;

  beforeEach(() => {
    catalog = new CommandCatalog();
    status = new StatusCommandHandler(catalog);
    catalog.register([status, new HelpCommandHandler(catalog)]);
  });

  describe('contrato do comando', () => {
    it('atende por /status', () => {
      expect(status.name).toBe('status');
    });

    it('nao exige permissao - e um comando tecnico basico', () => {
      expect(catalog.find('status')?.permission).toBeUndefined();
    });

    it('nao declara auditoria - comando tecnico nao entra na trilha', () => {
      expect(catalog.find('status')?.audit).toBeUndefined();
    });
  });

  describe('resposta', () => {
    it('confirma que o motor esta operacional', () => {
      const { success, outcome, reply } = status.handle(context());

      expect(success).toBe(true);
      expect(outcome).toBe(CommandOutcome.Ok);
      expect(reply).toContain('Motor de comandos operacional');
    });

    it('informa quantos comandos estao registrados', () => {
      expect(status.handle(context()).reply).toContain('Comandos registrados: 2');
    });

    it('acompanha o catalogo quando um comando e acrescentado', () => {
      catalog.register([
        { name: 'novo', description: 'novo', handle: () => status.handle(context()) },
      ]);

      expect(status.handle(context()).reply).toContain('Comandos registrados: 3');
    });

    it('informa o canal de origem da mensagem', () => {
      expect(status.handle(context()).reply).toContain(`Canal: ${CommandChannel.Test}`);
    });

    it('informa o tempo de atividade', () => {
      expect(status.handle(context()).reply).toMatch(/Tempo de atividade: \d+h \d+m \d+s/);
    });
  });

  describe('dados sensiveis', () => {
    const { reply } = new StatusCommandHandler(new CommandCatalog()).handle(context());

    it('nao expoe secrets, tokens nem credenciais', () => {
      expect(reply).not.toMatch(/secret|segredo|token|senha|password|credencial|jwt|bearer/i);
    });

    it('nao expoe variaveis de ambiente', () => {
      // O motor nao le o ambiente; esta checagem impede que alguem passe a ler.
      // Valores curtos ficam de fora para nao gerar falso positivo: `NODE_ENV`
      // vale `test` sob o Jest, e a resposta legitimamente traz `Canal: test`.
      for (const value of Object.values(process.env)) {
        if (value !== undefined && value.length >= 8) {
          expect(reply).not.toContain(value);
        }
      }
      expect(reply).not.toMatch(/NODE_ENV|DB_|JWT_|SEED_|_HOST|_PASSWORD|_USER/);
    });

    it('nao expoe conexao de banco, host, porta nem caminho do servidor', () => {
      expect(reply).not.toMatch(/mysql|oracle|localhost|127\.0\.0\.1|:\d{4}|[A-Za-z]:\\|\/home\//i);
    });

    it('nao expoe dados do usuario que enviou a mensagem', () => {
      expect(reply).not.toContain(USUARIO.email);
      expect(reply).not.toContain(USUARIO.id);
      expect(reply).not.toContain(USUARIO.nome);
    });

    it('nao expoe versao de dependencia nem do Node', () => {
      expect(reply).not.toContain(process.version);
      expect(reply).not.toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('pelo router', () => {
    it('/status e resolvido e executado pelo motor', async () => {
      const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

      const result = await new CommandRouter(catalog, audit).execute(context());

      expect(result.outcome).toBe(CommandOutcome.Ok);
      expect(result.reply).toContain('Motor de comandos operacional');
    });
  });
});

describe('formatUptime', () => {
  it.each([
    [0, '0h 0m 0s'],
    [45, '0h 0m 45s'],
    [90, '0h 1m 30s'],
    [3661, '1h 1m 1s'],
    [90061, '25h 1m 1s'],
  ])('%is vira %s', (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
  });

  it('arredonda para baixo os milissegundos', () => {
    expect(formatUptime(59.9)).toBe('0h 0m 59s');
  });

  it('nao produz valor negativo', () => {
    expect(formatUptime(-5)).toBe('0h 0m 0s');
  });
});
