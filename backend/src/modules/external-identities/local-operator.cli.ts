import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { type EnvironmentVariables, validateEnv } from '../../config/env.validation';
import { buildDataSourceOptions } from '../../database/database.config';
import { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Role } from '../roles/entities/role.entity';
import { RoleName } from '../roles/role-name.enum';
import { RolesRepository } from '../roles/roles.repository';
import { RolesService } from '../roles/roles.service';
import { User } from '../users/entities/user.entity';
import { isPasswordValid, PASSWORD_POLICY_MESSAGE } from '../users/password.policy';
import { PasswordService } from '../users/password.service';
import { UsersRepository } from '../users/users.repository';
import { normalizeEmail, UsersService } from '../users/users.service';
import { IdentityLinkRequest } from './entities/identity-link-request.entity';
import { IdentityChannel, LINK_REQUEST_TTL_MS, LinkRequestStatus } from './external-identity.enums';
import { IdentityLinkRequestsRepository } from './identity-link-requests.repository';
import { generateLinkCode, hashLinkCode, normalizeLinkCode } from './link-code';

/**
 * Preparacao LOCAL de um usuario de teste e do codigo de vinculo, para quem tem acesso ao
 * SERVIDOR (o mesmo nivel de quem le o `.env`). Roda dentro da imagem do backend:
 *
 *   docker compose exec backend node dist/modules/external-identities/local-operator.cli.js create-operator
 *   docker compose exec backend node dist/modules/external-identities/local-operator.cli.js link-code --email <email>
 *
 * REGRAS (cada uma tem teste):
 * - exige TERMINAL interativo: e-mail, nome e SENHA sao digitados no prompt (a senha sem eco).
 *   Nada de senha por argumento, variavel de ambiente ou pipe - nem em historico de shell;
 * - o perfil criado e SEMPRE `OPERADOR`. Nao ha opcao de perfil e nunca cria ADMIN;
 * - `link-code` recusa ADMIN, usuario inativo e usuario inexistente. O codigo aparece UMA vez,
 *   so no terminal de quem rodou, vale 15 min e e uso unico; so o hash vai ao banco e nada do
 *   codigo vai para log ou auditoria;
 * - NAO sobe a aplicacao Nest (nada de segundo polling): fala so com o banco;
 * - deixa auditoria (`USER_CREATED`/`IDENTITY_LINK_REQUESTED`) com origem `cli-local`, SEM ator
 *   (`usuarioId` nulo) e com o usuario atingido em `alvoId`.
 *
 * O Telegram so vira identidade depois que a PESSOA envia `/vincular <codigo>` ao bot - a prova
 * de posse acontece no chat, nao aqui.
 */

const USAGE = `uso:
  create-operator
  link-code --email <email>`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class UsageError extends Error {}

export interface Prompter {
  readonly interactive: boolean;
  ask(label: string): Promise<string>;
  askSecret(label: string): Promise<string>;
}

export interface OperatorPorts {
  findByEmail(email: string): Promise<{ id: string; ativo: boolean; role: string } | null>;
  createOperator(input: { nome: string; email: string; senha: string }): Promise<{ id: string }>;
  createLinkRequest(userId: string): Promise<{ id: string; codigo: string; expiraEm: Date }>;
  audit(acao: AuditAction, userId: string, metadados: Record<string, string>): Promise<void>;
}

export interface OperatorCliDeps {
  readonly ports: OperatorPorts;
  readonly prompt: Prompter;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export async function run(argv: readonly string[], deps: OperatorCliDeps): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (!deps.prompt.interactive) {
      throw new UsageError(
        'exige terminal interativo (use `docker compose exec`, sem redirecionar a entrada): ' +
          'senhas e codigos nao passam por pipe nem argumento',
      );
    }
    switch (command) {
      case 'create-operator':
        return await createOperator(rest, deps);
      case 'link-code':
        return await linkCode(rest, deps);
      default:
        throw new UsageError(`comando desconhecido '${command ?? ''}'\n${USAGE}`);
    }
  } catch (error) {
    deps.err(
      error instanceof UsageError
        ? `erro: ${error.message}`
        : 'erro: falha ao executar a operacao (veja o log do servidor)',
    );
    return 1;
  }
}

async function createOperator(args: readonly string[], deps: OperatorCliDeps): Promise<number> {
  if (args.length > 0) {
    throw new UsageError(
      `create-operator nao aceita argumentos (tudo e digitado no prompt)\n${USAGE}`,
    );
  }
  const email = normalizeEmail(await deps.prompt.ask('E-mail do usuario de teste: '));
  if (!EMAIL.test(email)) {
    throw new UsageError('e-mail invalido');
  }
  const nome = (await deps.prompt.ask('Nome: ')).trim();
  if (nome.length < 2 || nome.length > 120) {
    throw new UsageError('nome deve ter de 2 a 120 caracteres');
  }
  if ((await deps.ports.findByEmail(email)) !== null) {
    throw new UsageError('ja existe um usuario com este e-mail');
  }
  const senha = await deps.prompt.askSecret('Senha (nao aparece): ');
  if (!isPasswordValid(senha)) {
    throw new UsageError(PASSWORD_POLICY_MESSAGE);
  }
  if ((await deps.prompt.askSecret('Repita a senha: ')) !== senha) {
    throw new UsageError('as senhas nao conferem');
  }
  const user = await deps.ports.createOperator({ nome, email, senha });
  await deps.ports.audit(AuditAction.UserCreated, user.id, {
    origem: 'cli-local',
    perfil: RoleName.Operador,
  });
  deps.out(`usuario OPERADOR criado (id ${user.id}). Proximo passo: link-code --email <email>`);
  return 0;
}

async function linkCode(args: readonly string[], deps: OperatorCliDeps): Promise<number> {
  if (args.length !== 2 || args[0] !== '--email' || args[1] === undefined) {
    throw new UsageError(USAGE);
  }
  const user = await deps.ports.findByEmail(normalizeEmail(args[1]));
  if (user === null) {
    throw new UsageError('usuario nao encontrado');
  }
  if (!user.ativo) {
    throw new UsageError('usuario inativo nao pode receber vinculo');
  }
  if (user.role === String(RoleName.Admin)) {
    throw new UsageError('este procedimento local nao vincula ADMIN');
  }
  const request = await deps.ports.createLinkRequest(user.id);
  await deps.ports.audit(AuditAction.ExternalIdentityLinkRequested, user.id, {
    origem: 'cli-local',
    canal: IdentityChannel.Telegram,
    solicitacaoId: request.id,
  });
  deps.out('Envie ao bot, em CONVERSA PRIVADA, exatamente:');
  deps.out(`  /vincular ${request.codigo}`);
  deps.out(
    `O codigo vale ate ${request.expiraEm.toISOString()} (15 min), e de uso unico e NAO sera mostrado de novo.`,
  );
  return 0;
}

// --- ligacao com o banco ------------------------------------------------------

async function main(): Promise<number> {
  const env = validateEnv(process.env);
  const dataSource = new DataSource({ ...buildDataSourceOptions(env), synchronize: false });
  await dataSource.initialize();
  try {
    const users = new UsersRepository(dataSource.getRepository(User));
    const roles = new RolesService(new RolesRepository(dataSource.getRepository(Role)));
    const usersService = new UsersService(
      users,
      roles,
      new PasswordService(new ConfigService<EnvironmentVariables, true>(env)),
    );
    const requests = new IdentityLinkRequestsRepository(
      dataSource.getRepository(IdentityLinkRequest),
    );
    const audit = dataSource.getRepository(AuditLog);

    const ports: OperatorPorts = {
      findByEmail: async (email) => {
        const found = await users.findByEmail(email);
        return found === null ? null : { id: found.id, ativo: found.ativo, role: found.role.nome };
      },
      createOperator: async (input) => {
        const created = await usersService.create({ ...input, role: RoleName.Operador });
        return { id: created.id };
      },
      createLinkRequest: async (userId) => {
        const anterior = await requests.findPending(userId, IdentityChannel.Telegram);
        if (anterior !== null) {
          if (anterior.expiraEm.getTime() > Date.now()) {
            throw new UsageError('ja existe uma solicitacao pendente para este usuario');
          }
          await requests.close(anterior.id, userId, LinkRequestStatus.Expirada);
        }
        const codigo = generateLinkCode();
        const expiraEm = new Date(Date.now() + LINK_REQUEST_TTL_MS);
        const created = await requests.create({
          canal: IdentityChannel.Telegram,
          usuarioId: userId,
          codigoHash: hashLinkCode(normalizeLinkCode(codigo) as string),
          expiraEm,
          // Procedimento local de quem opera o servidor: o proprio alvo consta como autor.
          criadoPorId: userId,
        });
        return { id: created.id, codigo, expiraEm };
      },
      audit: async (acao, userId, metadados) => {
        await audit.save(
          audit.create({
            // Sem ATOR de aplicacao: quem operou foi alguem com acesso ao servidor. O usuario
            // atingido consta como `alvoId` (o `usuarioId` da trilha e sempre o ator).
            usuarioId: null,
            acao,
            modulo: AuditModuleName.Users,
            descricao: 'Procedimento local de preparacao de usuario de teste',
            ip: null,
            metadados: { ...metadados, alvoId: userId },
          }),
        );
      },
    };
    return await run(process.argv.slice(2), {
      ports,
      prompt: terminalPrompter(),
      out: (text) => process.stdout.write(`${text}\n`),
      err: (text) => process.stderr.write(`${text}\n`),
    });
  } finally {
    await dataSource.destroy();
  }
}

/** Prompt de terminal; a senha e lida em modo raw, sem eco. */
function terminalPrompter(): Prompter {
  const input = process.stdin;
  const interactive = input.isTTY && process.stdout.isTTY;

  const read = (label: string, secret: boolean): Promise<string> =>
    new Promise((resolve, reject) => {
      process.stdout.write(label);
      let buffer = '';
      if (secret) {
        input.setRawMode(true);
      }
      input.resume();
      input.setEncoding('utf8');
      const finish = (error?: Error): void => {
        input.removeListener('data', onData);
        if (secret) {
          input.setRawMode(false);
        }
        input.pause();
        process.stdout.write('\n');
        if (error) {
          reject(error);
        } else {
          resolve(buffer);
        }
      };
      const onData = (chunk: string): void => {
        for (const char of chunk) {
          if (char === '\r' || char === '\n') {
            finish();
            return;
          }
          if (char === '\u0003') {
            finish(new UsageError('cancelado'));
            return;
          }
          if (char === '\u007f' || char === '\b') {
            buffer = buffer.slice(0, -1);
          } else {
            // Modo normal: o proprio terminal ja faz o eco. Modo secreto: raw, sem eco.
            buffer += char;
          }
        }
      };
      input.on('data', onData);
    });

  return {
    interactive,
    ask: (label) => read(label, false),
    askSecret: (label) => read(label, true),
  };
}

if (require.main === module) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write('erro: falha ao executar (verifique o ambiente do banco)\n');
      process.exitCode = 1;
    },
  );
}
