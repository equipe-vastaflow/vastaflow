import type { AuditMetadata } from './entities/audit-log.entity';

/**
 * Tamanho maximo dos metadados serializados, em caracteres.
 *
 * Fica bem abaixo do limite da coluna `text` do MySQL (65.535 bytes, contando
 * que um caractere UTF-8 pode ocupar ate 4 bytes) - o CLOB do Oracle comporta
 * muito mais, entao o MySQL e o fator limitante.
 */
export const AUDIT_METADATA_MAX_LENGTH = 8_000;

export const REDACTED = '[REMOVIDO]';

/**
 * Chaves cujo valor nunca vai para a trilha de auditoria, em qualquer nivel de
 * aninhamento. A comparacao ignora maiusculas, `_` e `-`.
 */
const SENSITIVE_KEY =
  /senha|password|passwd|secret|segredo|token|authorization|cookie|apikey|credencial|credential/i;

/**
 * Prepara os metadados para persistencia, garantindo que eles nunca quebrem a
 * gravacao da auditoria:
 *
 * - remove valores de chaves sensiveis (senha, token, segredo...);
 * - converte o que o JSON nao representa (BigInt, Error, referencia circular);
 * - substitui o conteudo por um aviso quando excede `AUDIT_METADATA_MAX_LENGTH`
 *   (truncar o texto produziria JSON invalido).
 *
 * @returns objeto pronto para gravar, ou `null` quando nao ha metadados.
 */
export function sanitizeAuditMetadata(metadata: AuditMetadata | undefined): AuditMetadata | null {
  if (metadata === undefined || metadata === null) {
    return null;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(metadata, createReplacer());
  } catch {
    return { _aviso: 'metadados nao serializaveis' };
  }

  if (serialized.length > AUDIT_METADATA_MAX_LENGTH) {
    return {
      _aviso: 'metadados excederam o tamanho maximo e foram descartados',
      _tamanhoOriginal: serialized.length,
    };
  }

  return JSON.parse(serialized) as AuditMetadata;
}

function createReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();

  return (key, value) => {
    if (key !== '' && SENSITIVE_KEY.test(key.replace(/[_-]/g, ''))) {
      return REDACTED;
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (value instanceof Error) {
      // Nome e mensagem bastam; a stack pode expor caminhos do servidor.
      return { name: value.name, message: value.message };
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };
}
