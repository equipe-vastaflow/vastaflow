import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  addCredential,
  describeCredentials,
  EMPTY_CREDENTIALS_FILE,
  revokeCredential,
} from './service-credentials.admin';
import {
  parseCredentialsFile,
  serializeCredentialsFile,
  type ServiceCredentialsFile,
} from './service-credentials.file';

/**
 * Administracao das credenciais de servico, pela linha de comando.
 *
 * Roda em qualquer lugar com Node - na maquina do operador ou dentro da imagem
 * do backend, onde ja esta compilado:
 *
 *   node dist/modules/service-auth/service-credential.cli.js create \
 *        --file credentials.json --id n8n-2026-10 --principal n8n [--expires-in-days 30]
 *   node dist/modules/service-auth/service-credential.cli.js revoke --file credentials.json --id n8n-2026-09
 *   node dist/modules/service-auth/service-credential.cli.js list   --file credentials.json
 *
 * `create` imprime o TOKEN no stdout, UMA vez, e so ele - os avisos vao para o
 * stderr, entao `TOKEN=$(... create ...)` captura limpo. O token nunca e gravado
 * em disco por esta ferramenta; o arquivo recebe so o hash.
 *
 * Revogar vale sem reiniciar o backend: ele relê o arquivo a cada segundo.
 */

const USAGE = `uso:
  create --file <arquivo> --id <id> --principal <principal> [--expires-in-days <n>]
  revoke --file <arquivo> --id <id>
  list   --file <arquivo>`;

const DAY_MS = 24 * 60 * 60 * 1000;

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function err(text: string): void {
  process.stderr.write(`${text}\n`);
}

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`argumento invalido perto de '${name ?? ''}'\n${USAGE}`);
    }
    flags.set(name.slice(2), value);
  }
  return flags;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.trim() === '') {
    throw new Error(`falta --${name}\n${USAGE}`);
  }
  return value;
}

function load(path: string): ServiceCredentialsFile {
  return existsSync(path)
    ? parseCredentialsFile(readFileSync(path, 'utf8'))
    : EMPTY_CREDENTIALS_FILE;
}

/**
 * Grava de forma ATOMICA: escreve num arquivo temporario no MESMO diretorio e
 * troca por `rename`. O backend relê o arquivo a cada segundo; sem isto ele
 * poderia pegar um arquivo pela metade, e como o arquivo corrompido nega todo
 * acesso, uma revogacao mal gravada derrubaria o n8n inteiro por um instante.
 *
 * Modo 0644: o arquivo contem so hashes e precisa ser legivel pelo usuario do
 * container (uid 1000), que em geral nao e o dono no host.
 */
function save(path: string, file: ServiceCredentialsFile): void {
  const temp = join(dirname(path), `.credentials.${process.pid}.tmp`);
  writeFileSync(temp, serializeCredentialsFile(file), { mode: 0o644 });
  renameSync(temp, path);
}

export function run(argv: readonly string[], now: Date = new Date()): number {
  try {
    const [command, ...rest] = argv;
    const flags = parseFlags(rest);
    const path = required(flags, 'file');

    switch (command) {
      case 'create': {
        const days = flags.get('expires-in-days');
        const expiresAt =
          days === undefined ? undefined : new Date(now.getTime() + Number(days) * DAY_MS);
        if (expiresAt !== undefined && Number.isNaN(expiresAt.getTime())) {
          throw new Error('--expires-in-days deve ser um numero');
        }
        const { file, token } = addCredential(load(path), {
          id: required(flags, 'id'),
          principal: required(flags, 'principal'),
          now,
          expiresAt,
        });
        save(path, file);
        err(
          `Credencial '${required(flags, 'id')}' criada. O token abaixo aparece UMA vez: ` +
            'guarde-o no cofre do n8n agora. Ele nao e gravado em lugar nenhum.',
        );
        out(token);
        return 0;
      }
      case 'revoke': {
        save(path, revokeCredential(load(path), required(flags, 'id'), now));
        err(`Credencial '${required(flags, 'id')}' revogada.`);
        return 0;
      }
      case 'list': {
        for (const line of describeCredentials(load(path), now)) {
          out(line);
        }
        return 0;
      }
      default:
        throw new Error(`comando desconhecido '${command ?? ''}'\n${USAGE}`);
    }
  } catch (error) {
    err(`erro: ${error instanceof Error ? error.message : 'falha desconhecida'}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}
