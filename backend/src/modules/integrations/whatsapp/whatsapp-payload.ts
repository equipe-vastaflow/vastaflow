/** Mensagem de TEXTO de uma conversa individual, ja reduzida ao que o VastaFlow usa. */
export interface InboundWhatsappText {
  readonly phoneNumberId: string;
  /** `wamid...`: identificador unico da mensagem (chave de idempotencia). */
  readonly messageId: string;
  /** `wa_id` do remetente (so digitos, sem `+`). E a identidade externa. */
  readonly from: string;
  readonly text: string;
  /** Segundos Unix, como a Meta envia. */
  readonly timestamp: number;
}

export interface ParsedWebhook {
  readonly messages: readonly InboundWhatsappText[];
  /** Itens recebidos e deliberadamente ignorados (nao-texto, encaminhada, malformado, status...). */
  readonly skipped: number;
}

export const WHATSAPP_TEXT_MAX = 4096;
const MESSAGE_ID = /^[\w.=+/-]{1,200}$/;
const DIGITS = /^\d{5,20}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reduz o payload do webhook (`object: whatsapp_business_account`) as mensagens de TEXTO.
 *
 * Aceita somente: texto simples (1 a 4096 caracteres), de um remetente com `wa_id` numerico, com
 * `id` bem formado. Ignora e CONTA: status de entrega, midia/documento/audio/localizacao/botao etc.
 * (anexos NAO sao suportados), mensagens ENCAMINHADAS (`context.forwarded`), e qualquer item fora
 * do formato. Nunca lanca. Nome do perfil, contatos e demais campos nao saem daqui.
 */
export function parseWhatsappPayload(body: unknown): ParsedWebhook {
  const messages: InboundWhatsappText[] = [];
  let skipped = 0;
  if (
    !isRecord(body) ||
    body.object !== 'whatsapp_business_account' ||
    !Array.isArray(body.entry)
  ) {
    return { messages, skipped: 1 };
  }
  for (const entry of body.entry as unknown[]) {
    const changes =
      isRecord(entry) && Array.isArray(entry.changes) ? (entry.changes as unknown[]) : [];
    for (const change of changes) {
      const value = isRecord(change) && change.field === 'messages' ? change.value : undefined;
      if (!isRecord(value)) {
        skipped += 1;
        continue;
      }
      const phoneNumberId = isRecord(value.metadata) ? value.metadata.phone_number_id : undefined;
      if (typeof phoneNumberId !== 'string' || !DIGITS.test(phoneNumberId)) {
        skipped += 1;
        continue;
      }
      // Eventos de status de entrega (`statuses`) nao sao mensagens.
      skipped += Array.isArray(value.statuses) ? (value.statuses as unknown[]).length : 0;
      for (const raw of Array.isArray(value.messages) ? (value.messages as unknown[]) : []) {
        const parsed = parseMessage(raw, phoneNumberId);
        if (parsed === null) {
          skipped += 1;
        } else {
          messages.push(parsed);
        }
      }
    }
  }
  return { messages, skipped };
}

function parseMessage(raw: unknown, phoneNumberId: string): InboundWhatsappText | null {
  if (!isRecord(raw) || raw.type !== 'text' || !isRecord(raw.text)) {
    return null;
  }
  const { id, from, timestamp } = raw;
  const text = raw.text.body;
  if (
    typeof id !== 'string' ||
    !MESSAGE_ID.test(id) ||
    typeof from !== 'string' ||
    !DIGITS.test(from) ||
    typeof text !== 'string' ||
    text.length < 1 ||
    text.length > WHATSAPP_TEXT_MAX
  ) {
    return null;
  }
  const seconds = typeof timestamp === 'string' ? Number(timestamp) : timestamp;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 0) {
    return null;
  }
  // Encaminhada (ou muito encaminhada): o texto nao foi digitado por quem enviou ao bot.
  if (
    isRecord(raw.context) &&
    (raw.context.forwarded === true || raw.context.frequently_forwarded === true)
  ) {
    return null;
  }
  return { phoneNumberId, messageId: id, from, text, timestamp: seconds };
}
