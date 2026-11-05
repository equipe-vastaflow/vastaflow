/**
 * Log do gateway: JSON de uma linha, com VOCABULARIO FIXO. Nao existe forma de logar texto de mensagem, numero, JID,
 * QR, token ou o corpo de um erro: os eventos sao nomes fechados e os campos sao filtrados.
 */
export type LogEvent =
  | 'iniciando'
  | 'conectando'
  | 'conexao-aberta'
  | 'conexao-fechada'
  | 'reconexao-agendada'
  | 'parado'
  | 'mensagem-ignorada'
  | 'mensagem-encaminhada'
  | 'resposta-enviada'
  | 'resposta-descartada'
  | 'falha-encaminhar'
  | 'falha-enviar'
  | 'fila-cheia'
  | 'config-invalida'
  | 'sessao-indisponivel'
  | 'sessao-verificada'
  | 'conexao-desabilitada';

export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface GatewayLogger {
  event(name: LogEvent, fields?: LogFields): void;
}

/** Texto curto e "de codigo": letras, digitos, `_`, `.`, `:`, `-`, no maximo 32 caracteres (um segredo/token e mais longo). */
const SAFE = /^[A-Za-z0-9_.:-]{0,32}$/;
/** Prefixo das credenciais de servico do VastaFlow: nunca sai, qualquer que seja o tamanho. */
const SECRET_PREFIX = /^vfs_/;
/** 7 digitos seguidos ou mais lembram numero de telefone/LID: nunca saem. */
const LOOKS_LIKE_NUMBER = /\d{7,}/;

export function sanitizeFields(fields: LogFields | undefined): LogFields {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!/^[a-z][A-Za-z0-9]{0,31}$/.test(key)) {
      continue;
    }
    if (typeof value === 'string') {
      clean[key] =
        SAFE.test(value) && !LOOKS_LIKE_NUMBER.test(value) && !SECRET_PREFIX.test(value)
          ? value
          : '[omitido]';
    } else if (typeof value === 'number') {
      clean[key] = Number.isFinite(value) ? value : null;
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export class JsonLogger implements GatewayLogger {
  constructor(
    private readonly write: (line: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  event(name: LogEvent, fields?: LogFields): void {
    this.write(
      JSON.stringify({
        t: new Date(this.now()).toISOString(),
        ev: name,
        ...sanitizeFields(fields),
      }),
    );
  }
}

/** Para testes: guarda os eventos. */
export class MemoryLogger implements GatewayLogger {
  readonly events: { name: LogEvent; fields: LogFields }[] = [];

  event(name: LogEvent, fields?: LogFields): void {
    this.events.push({ name, fields: sanitizeFields(fields) });
  }
}
