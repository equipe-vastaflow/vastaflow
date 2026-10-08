import {
  EMPTY_CREDENTIALS_FILE,
  type ServiceCredentialRecord,
  type ServiceCredentialsFile,
} from './service-credentials.file';
import { isServicePrincipalId, type ServicePrincipalId } from './service-principals';
import { generateServiceToken, hashServiceToken } from './service-token';

/**
 * Operacoes sobre o arquivo de credenciais: criar e revogar.
 *
 * LOGICA PURA - recebe e devolve o conteudo do arquivo, sem tocar o disco. A
 * casca de I/O esta em `service-credential.cli.ts`. A separacao existe para que
 * o que importa - hash, unicidade, estado - seja testavel sem filesystem.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export interface AddCredentialInput {
  readonly id: string;
  readonly principal: string;
  readonly now: Date;
  /** Depois desta data a credencial deixa de valer sozinha. */
  readonly expiresAt?: Date;
  /** Geracao do token. Injetavel para teste; em producao e a de `service-token.ts`. */
  readonly generate?: () => string;
}

export interface AddCredentialResult {
  readonly file: ServiceCredentialsFile;
  /**
   * O token em TEXTO PURO. Existe so aqui, uma unica vez: o arquivo guarda o
   * hash. Quem chama precisa entrega-lo ao cofre do n8n e descarta-lo.
   */
  readonly token: string;
}

/**
 * Acrescenta uma credencial ativa.
 *
 * Ja ha credencial ativa para o principal? Tudo bem: e exatamente a JANELA DE
 * ROTACAO - as duas valem ao mesmo tempo ate a antiga ser revogada ou expirar.
 *
 * @throws Error se o id for invalido ou ja existir, ou se o principal for desconhecido.
 */
export function addCredential(
  file: ServiceCredentialsFile,
  input: AddCredentialInput,
): AddCredentialResult {
  if (!ID_PATTERN.test(input.id)) {
    throw new Error(
      "id invalido: use 3 a 64 caracteres entre letras minusculas, digitos, '.', '_' e '-', comecando por letra ou digito",
    );
  }
  if (!isServicePrincipalId(input.principal)) {
    throw new Error(`principal desconhecido: '${input.principal}'`);
  }
  if (file.credentials.some((c) => c.id === input.id)) {
    throw new Error(`ja existe uma credencial com o id '${input.id}'`);
  }
  if (input.expiresAt !== undefined && input.expiresAt.getTime() <= input.now.getTime()) {
    throw new Error('a data de expiracao precisa ser futura');
  }

  const token = (input.generate ?? generateServiceToken)();
  const record: ServiceCredentialRecord = {
    id: input.id,
    principal: input.principal,
    sha256: hashServiceToken(token),
    status: 'active',
    createdAt: input.now.toISOString(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
  };

  return { file: { version: 1, credentials: [...file.credentials, record] }, token };
}

/**
 * Revoga uma credencial.
 *
 * Idempotente: revogar uma ja revogada mantem a data ORIGINAL de revogacao, que
 * e o que importa para o registro do que aconteceu.
 *
 * O registro NAO e apagado: fica com `status: revoked`, preservando o rastro de
 * que aquela credencial existiu. Apagar tambem revoga na pratica (um hash
 * desconhecido e recusado), mas perde a historia.
 *
 * @throws Error se o id nao existir.
 */
export function revokeCredential(
  file: ServiceCredentialsFile,
  id: string,
  now: Date,
): ServiceCredentialsFile {
  if (!file.credentials.some((c) => c.id === id)) {
    throw new Error(`nao existe credencial com o id '${id}'`);
  }

  return {
    version: 1,
    credentials: file.credentials.map((c) =>
      c.id === id && c.status !== 'revoked'
        ? { ...c, status: 'revoked' as const, revokedAt: now.toISOString() }
        : c,
    ),
  };
}

/** Uma linha por credencial, SEM o hash: so o que ajuda a operar. */
export function describeCredentials(file: ServiceCredentialsFile, now: Date): string[] {
  if (file.credentials.length === 0) {
    return ['(nenhuma credencial)'];
  }
  return file.credentials.map((c) => {
    const expired = c.expiresAt !== undefined && Date.parse(c.expiresAt) <= now.getTime();
    const state = c.status === 'revoked' ? 'REVOGADA' : expired ? 'EXPIRADA' : 'ATIVA';
    const extra = [
      `criada=${c.createdAt}`,
      c.expiresAt ? `expira=${c.expiresAt}` : undefined,
      c.revokedAt ? `revogada=${c.revokedAt}` : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' ');
    return `${state.padEnd(9)} ${c.id.padEnd(24)} ${(c.principal as ServicePrincipalId).padEnd(6)} ${extra}`;
  });
}

export { EMPTY_CREDENTIALS_FILE };
