import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCommand } from '../../commands/command-parser';
import { TelegramAdapter, TelegramUpdateOutcome, describeFailure } from './telegram.adapter';
import { TelegramApiClient } from './telegram-api.client';
import {
  signEnvelope,
  verifyReply,
  type SignedReply,
  type TelegramEnvelope,
} from './telegram-envelope';
import { TelegramN8nClient } from './telegram-n8n.client';
import { isAcceptableSigningKey } from './telegram-n8n-settings';
import { isRecord } from './telegram-json';
import { toIncomingMessage, toTelegramEnvelope } from './telegram-update.mapper';
import type { TelegramUpdateHandler } from './telegram-update-handler';

const SIGNING_KEY = 'TELEGRAM_INGEST_SIGNING_KEY';

/**
 * Aviso padrao quando o fluxo n8n -> backend nao devolve uma resposta valida
 * (n8n fora do ar, workflow inativo, tempo esgotado, assinatura que nao confere).
 * Texto FIXO escrito aqui: nunca algo que veio do n8n. Nao diz se o comando rodou.
 */
export const TELEGRAM_RELAY_UNAVAILABLE_REPLY =
  'O VastaFlow nao conseguiu processar sua mensagem agora. Tente novamente em instantes.';

const OUTCOMES = new Set([
  'EXECUTED',
  'DENIED',
  'UNLINKED',
  'UNKNOWN_COMMAND',
  'FAILED',
  'DUPLICATE',
]);

interface IngestAnswer extends SignedReply {
  readonly duplicate: boolean;
  readonly correlationId: string;
}

/**
 * Transporte do modo `n8n`: recebe do polling cada update, reduz a um envelope,
 * ASSINA, entrega ao workflow do n8n e responde ao usuario com o que o backend
 * devolveu - depois de conferir a assinatura da resposta.
 *
 * O que ESTA classe nao faz: nao identifica usuario, nao avalia permissao, nao
 * executa comando e nao consulta nada. Isso e do backend (`telegram-ingest`). Ela
 * so assina, entrega e repassa.
 *
 * Por que o token do bot NAO vai ao n8n: quem envia a mensagem ao Telegram e este
 * transporte, com o token que ja mora so no backend. O n8n devolve a resposta, e o
 * destino e sempre o chat do PROPRIO envelope assinado - o n8n nao consegue
 * redirecionar a resposta para outro chat nem alterar o texto (a assinatura da
 * resposta e amarrada ao envelope).
 *
 * `/vincular <codigo>` e a unica excecao e e tratada AQUI, pelo adaptador direto:
 * o codigo e uma prova de posse da conta e nao deve passar pelo n8n.
 *
 * Nunca lanca (o polling depende disso). Nao registra texto, resposta, id do
 * remetente nem token: so o desfecho e, quando houver, o id de correlacao.
 */
@Injectable()
export class TelegramRelayService implements TelegramUpdateHandler {
  private readonly logger = new Logger(TelegramRelayService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly client: TelegramApiClient,
    private readonly n8n: TelegramN8nClient,
    private readonly adapter: TelegramAdapter,
  ) {}

  async handleUpdate(raw: unknown): Promise<TelegramUpdateOutcome> {
    const message = toIncomingMessage(raw);
    if (!message) {
      return TelegramUpdateOutcome.Ignored;
    }
    if (isLinkCommand(message.text)) {
      return this.adapter.handleUpdate(raw);
    }

    const key = this.signingKey();
    const botId = this.client.botId();
    const envelope =
      key !== null && botId !== null ? toTelegramEnvelope(raw, botId, Date.now()) : null;
    if (key === null || envelope === null) {
      // Configuracao incompleta: o `validateEnv` barra isto no boot. Se chegar aqui,
      // nao ha como assinar - descarta, sem inventar identidade.
      this.logger.warn('Telegram: relay sem chave de assinatura ou id do bot; mensagem descartada');
      return TelegramUpdateOutcome.RelayFailed;
    }

    const answer = await this.exchange(envelope, signEnvelope(envelope, key), key);
    if (answer === 'DUPLICATE') {
      return TelegramUpdateOutcome.Duplicate;
    }
    return this.reply(message.conversationId, answer);
  }

  /** Entrega ao n8n e valida a resposta. Devolve a resposta autentica, `DUPLICATE` ou `null`. */
  private async exchange(
    envelope: TelegramEnvelope,
    signature: string,
    key: string,
  ): Promise<IngestAnswer | 'DUPLICATE' | null> {
    let body: unknown;
    try {
      body = await this.n8n.deliver(envelope, signature);
    } catch (error) {
      this.logger.warn(`Telegram: entrega ao n8n falhou (${describeFailure(error)})`);
      return null;
    }

    const answer = parseAnswer(body);
    if (answer === null) {
      this.logger.warn('Telegram: resposta do n8n fora do contrato');
      return null;
    }
    if (answer.duplicate) {
      this.logger.warn(`Telegram: mensagem ja processada (correlacao ${answer.correlationId})`);
      return 'DUPLICATE';
    }
    if (!verifyReply(envelope, answer, key)) {
      // Resposta alterada no caminho (ou chave diferente): nunca e repassada.
      this.logger.warn(
        `Telegram: assinatura da resposta invalida (correlacao ${answer.correlationId})`,
      );
      return null;
    }
    this.logger.debug(`Telegram: mensagem processada via n8n (${answer.outcome})`);
    return answer;
  }

  private async reply(chatId: string, answer: IngestAnswer | null): Promise<TelegramUpdateOutcome> {
    const text = answer === null ? TELEGRAM_RELAY_UNAVAILABLE_REPLY : answer.reply;
    try {
      await this.client.sendMessage(chatId, text);
    } catch (error) {
      this.logger.warn(`Telegram: resposta nao enviada (${describeFailure(error)})`);
      return TelegramUpdateOutcome.ReplyFailed;
    }
    return answer === null ? TelegramUpdateOutcome.RelayFailed : TelegramUpdateOutcome.Relayed;
  }

  private signingKey(): string | null {
    const raw = this.config.get<string>(SIGNING_KEY);
    return typeof raw === 'string' && isAcceptableSigningKey(raw) ? raw : null;
  }
}

/**
 * `/vincular` em qualquer grafia que o Telegram produz, inclusive `/vincular@NomeDoBot`
 * (que o parser classifica como malformado). O codigo e prova de posse da conta e,
 * na duvida, fica DENTRO do backend: nunca segue para o n8n.
 */
function isLinkCommand(text: string): boolean {
  const parsed = parseCommand(text);
  if (parsed.kind === 'command') {
    return parsed.command.name === 'vincular';
  }
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return first === '/vincular' || first.startsWith('/vincular@');
}

/** Valida o formato da resposta. Qualquer desvio e `null` (aviso padrao ao usuario). */
function parseAnswer(body: unknown): IngestAnswer | null {
  if (!isRecord(body)) {
    return null;
  }
  const { correlationId, outcome, duplicate, reply, signature } = body;
  if (
    typeof correlationId !== 'string' ||
    typeof outcome !== 'string' ||
    !OUTCOMES.has(outcome) ||
    typeof duplicate !== 'boolean'
  ) {
    return null;
  }
  if (duplicate) {
    return { correlationId, outcome, duplicate, reply: '', signature: '' };
  }
  if (typeof reply !== 'string' || reply === '' || typeof signature !== 'string') {
    return null;
  }
  return { correlationId, outcome, duplicate, reply, signature };
}
