import { ConfigService } from '@nestjs/config';
import {
  ENVELOPE_PLATFORM,
  ENVELOPE_VERSION,
  signEnvelope,
  verifyReply,
  type TelegramEnvelope,
} from './telegram-envelope';
import { isRecord } from './telegram-json';
import { TelegramN8nClient, TelegramRelayError } from './telegram-n8n.client';
import { isAcceptableSigningKey } from './telegram-n8n-settings';

/**
 * Simulador de mensagens do Telegram, para testar o fluxo n8n -> backend SEM
 * Telegram: monta o envelope de uma mensagem de texto, assina com a chave de
 * ingestao, entrega ao webhook do n8n e confere a resposta assinada.
 *
 *   node dist/modules/integrations/telegram/telegram-simulate.cli.js \
 *        --user 123456789 --text "/ajuda" [--update-id 5001] [--bot-id 999000111] [--dry-run]
 *
 * Roda dentro do container do backend, que ja tem `TELEGRAM_INGEST_SIGNING_KEY` e
 * `TELEGRAM_N8N_WEBHOOK_URL`. Nao fala com o Telegram, nao usa o token do bot e nao
 * envia resposta a ninguem: so imprime no terminal de quem o executou. A chave
 * NUNCA e impressa.
 *
 * `--user` e o id do remetente NO TELEGRAM de uma identidade ja vinculada (ou nao,
 * para ver a resposta "nao vinculado"). O bot simulado tem id proprio
 * (`999000111`), para que as mensagens de teste nunca colidam, na tabela de
 * idempotencia, com updates de um bot real. Repetir o mesmo `--update-id` mostra a
 * protecao contra entrega duplicada.
 */

const USAGE = `uso:
  --user <id-do-telegram> --text <mensagem> [--update-id <n>] [--bot-id <n>] [--dry-run]

variaveis de ambiente: TELEGRAM_INGEST_SIGNING_KEY, TELEGRAM_N8N_WEBHOOK_URL`;

/** Bot de mentira: nao existe no Telegram. */
export const SIMULATED_BOT_ID = '999000111';

const DIGITS = /^\d{1,20}$/;
const VALUE_FLAGS = new Set(['user', 'text', 'update-id', 'bot-id']);
const BOOLEAN_FLAGS = new Set(['dry-run']);

export interface SimulatorIo {
  out(text: string): void;
  err(text: string): void;
}

export interface SimulatorDeps {
  readonly io?: SimulatorIo;
  readonly now?: () => number;
  /** Entrega ao n8n. Padrao: o cliente real, com a URL do ambiente. */
  readonly deliver?: (envelope: TelegramEnvelope, signature: string) => Promise<unknown>;
}

const DEFAULT_IO: SimulatorIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i] ?? '';
    const name = raw.startsWith('--') ? raw.slice(2) : '';
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, 'true');
    } else if (VALUE_FLAGS.has(name)) {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error(`falta o valor de --${name}\n${USAGE}`);
      }
      flags.set(name, value);
      i += 1;
    } else {
      throw new Error(`argumento desconhecido '${raw}'\n${USAGE}`);
    }
  }
  return flags;
}

function digits(flags: Map<string, string>, name: string, fallback?: string): string {
  const value = flags.get(name) ?? fallback;
  if (value === undefined || !DIGITS.test(value)) {
    throw new Error(`--${name} deve ser numerico\n${USAGE}`);
  }
  return value;
}

/** Retorna o codigo de saida: 0 resposta valida, 1 uso, 2 entrega, 3 resposta invalida. */
export async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  deps: SimulatorDeps = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const now = deps.now ?? ((): number => Date.now());

  let envelope: TelegramEnvelope;
  let key: string;
  try {
    const flags = parseFlags(argv);
    const text = flags.get('text');
    if (text === undefined || text.trim() === '' || text.length > 4096) {
      throw new Error(`--text deve ter de 1 a 4096 caracteres\n${USAGE}`);
    }
    const user = digits(flags, 'user');
    const issuedAt = now();
    envelope = {
      version: ENVELOPE_VERSION,
      platform: ENVELOPE_PLATFORM,
      botId: digits(flags, 'bot-id', SIMULATED_BOT_ID),
      updateId: Number(digits(flags, 'update-id', String(issuedAt))),
      messageId: 1,
      chatId: user,
      userId: user,
      chatType: 'private',
      text,
      sentAt: Math.floor(issuedAt / 1000),
      issuedAt,
    };
    const rawKey = env.TELEGRAM_INGEST_SIGNING_KEY ?? '';
    if (!isAcceptableSigningKey(rawKey)) {
      throw new Error('TELEGRAM_INGEST_SIGNING_KEY ausente ou curta demais');
    }
    key = rawKey;
    if (flags.get('dry-run') === 'true') {
      io.out(`envelope (sem chave, sem assinatura): ${JSON.stringify(envelope)}`);
      return 0;
    }
  } catch (error) {
    io.err(`erro: ${error instanceof Error ? error.message : 'falha desconhecida'}`);
    return 1;
  }

  const signature = signEnvelope(envelope, key);
  const deliver =
    deps.deliver ??
    ((e: TelegramEnvelope, s: string): Promise<unknown> =>
      new TelegramN8nClient(
        new ConfigService({ TELEGRAM_N8N_WEBHOOK_URL: env.TELEGRAM_N8N_WEBHOOK_URL ?? '' }),
      ).deliver(e, s));

  let body: unknown;
  try {
    body = await deliver(envelope, signature);
  } catch (error) {
    io.err(
      `entrega ao n8n falhou: ${error instanceof TelegramRelayError ? error.kind : 'erro desconhecido'}`,
    );
    return 2;
  }

  if (!isRecord(body) || typeof body.outcome !== 'string') {
    io.err('resposta do n8n fora do contrato');
    return 3;
  }
  io.out(`resultado: ${body.outcome}`);
  if (body.duplicate === true) {
    io.out('duplicada: sim (nada foi executado e nao ha resposta)');
    return 0;
  }
  io.out('duplicada: nao');
  const reply = typeof body.reply === 'string' ? body.reply : '';
  const authentic =
    typeof body.signature === 'string' &&
    verifyReply(envelope, { outcome: body.outcome, reply, signature: body.signature }, key);
  io.out(`assinatura da resposta: ${authentic ? 'valida' : 'INVALIDA'}`);
  if (!authentic) {
    return 3;
  }
  io.out('--- resposta ---');
  io.out(reply);
  return 0;
}

if (require.main === module) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
