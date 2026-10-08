import { isServicePrincipalId, ServicePrincipalId } from './service-principals';

/**
 * Formato do arquivo de credenciais de servico.
 *
 * Guarda HASHES, nunca o token: quem le o arquivo nao consegue se passar pelo
 * servico. Ainda assim ele e tratado como sensivel (fora do Git, montado
 * somente-leitura no backend).
 *
 * O ARQUIVO diz QUEM e cada credencial; quais ESCOPOS um principal tem fica em
 * codigo (`service-principals.ts`), para que conceder poder passe por revisao.
 */

export type ServiceCredentialStatus = 'active' | 'revoked';

export interface ServiceCredentialRecord {
  /** Identificador estavel e legivel. Aparece em log e na resposta; nao e segredo. */
  readonly id: string;
  readonly principal: ServicePrincipalId;
  /** SHA-256 do token, hexadecimal minusculo. */
  readonly sha256: string;
  readonly status: ServiceCredentialStatus;
  readonly createdAt: string;
  /** Depois desta data a credencial deixa de valer sozinha (fecha a janela de rotacao). */
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface ServiceCredentialsFile {
  readonly version: 1;
  readonly credentials: readonly ServiceCredentialRecord[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_RECORD_KEYS = new Set([
  'id',
  'principal',
  'sha256',
  'status',
  'createdAt',
  'expiresAt',
  'revokedAt',
]);

/** Arquivo vazio e valido e significa "nenhuma credencial": todo acesso e negado. */
export const EMPTY_CREDENTIALS_FILE: ServiceCredentialsFile = { version: 1, credentials: [] };

/**
 * Le e VALIDA o conteudo do arquivo.
 *
 * Estrito de proposito: campo desconhecido, status invalido ou hash mal formado
 * derruba o arquivo inteiro em vez de ser ignorado. Um arquivo que o operador
 * editou errado - por exemplo um `status` digitado com erro - precisa NEGAR, e
 * nao seguir valendo com o que sobrou.
 *
 * As mensagens de erro apontam a posicao e o campo, e NUNCA reproduzem valores
 * do arquivo.
 *
 * @throws Error com mensagem segura para log.
 */
export function parseCredentialsFile(text: string): ServiceCredentialsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSON invalido');
  }

  if (!isRecord(raw)) {
    throw new Error('a raiz deve ser um objeto');
  }
  if (raw.version !== 1) {
    throw new Error("'version' deve ser 1");
  }
  if (!Array.isArray(raw.credentials)) {
    throw new Error("'credentials' deve ser uma lista");
  }

  const ids = new Set<string>();
  const hashes = new Set<string>();
  const credentials = (raw.credentials as unknown[]).map((item, index) => {
    const record = parseRecord(item, index + 1);
    if (ids.has(record.id)) {
      throw new Error(`credencial #${index + 1}: 'id' repetido`);
    }
    if (hashes.has(record.sha256)) {
      throw new Error(`credencial #${index + 1}: 'sha256' repetido`);
    }
    ids.add(record.id);
    hashes.add(record.sha256);
    return record;
  });

  return { version: 1, credentials };
}

function parseRecord(item: unknown, position: number): ServiceCredentialRecord {
  const where = `credencial #${position}`;
  if (!isRecord(item)) {
    throw new Error(`${where}: deve ser um objeto`);
  }
  for (const key of Object.keys(item)) {
    if (!ALLOWED_RECORD_KEYS.has(key)) {
      throw new Error(`${where}: campo desconhecido '${key}'`);
    }
  }

  const { id, principal, sha256, status, createdAt, expiresAt, revokedAt } = item;

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`${where}: 'id' invalido`);
  }
  if (!isServicePrincipalId(principal)) {
    throw new Error(`${where}: 'principal' desconhecido`);
  }
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    throw new Error(`${where}: 'sha256' invalido`);
  }
  if (status !== 'active' && status !== 'revoked') {
    throw new Error(`${where}: 'status' deve ser 'active' ou 'revoked'`);
  }
  assertDate(createdAt, 'createdAt', where, true);
  assertDate(expiresAt, 'expiresAt', where, false);
  assertDate(revokedAt, 'revokedAt', where, false);

  return {
    id,
    principal,
    sha256,
    status,
    createdAt: createdAt as string,
    ...(typeof expiresAt === 'string' ? { expiresAt } : {}),
    ...(typeof revokedAt === 'string' ? { revokedAt } : {}),
  };
}

function assertDate(value: unknown, field: string, where: string, required: boolean): void {
  if (value === undefined && !required) {
    return;
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${where}: '${field}' deve ser uma data ISO valida`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Serializacao estavel, legivel por pessoa e com quebra de linha final. */
export function serializeCredentialsFile(file: ServiceCredentialsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
