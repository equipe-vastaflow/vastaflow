import { SIGNING_KEY_MIN_LENGTH } from './telegram-envelope';

/**
 * Como o transporte do Telegram entrega cada mensagem.
 *
 * - `direct` (PADRAO): o proprio backend avalia a mensagem (`TelegramAdapter`),
 *   como sempre foi. Nada muda para quem nao ativa o n8n.
 * - `n8n`: o transporte assina um envelope e o entrega a um workflow do n8n; o
 *   backend so executa o que voltar assinado por ele (ver `telegram-envelope.ts`).
 *
 * O polling (`getUpdates`) e o MESMO nos dois modos e continua sendo o unico
 * consumidor do bot: o modo so escolhe quem trata cada update.
 */
export type TelegramDeliveryMode = 'direct' | 'n8n';
export const TELEGRAM_DELIVERY_MODES: readonly TelegramDeliveryMode[] = ['direct', 'n8n'];

/** Caminho dos webhooks de PRODUCAO do n8n (workflow ativo). */
export const N8N_WEBHOOK_PATH_PREFIX = '/webhook/';

/**
 * Hosts aceitos para o webhook. O texto das mensagens dos usuarios vai para esta
 * URL, entao um erro de digitacao nao pode mandar isso para fora da rede do
 * Compose: `n8n` e o nome do servico; o loopback serve ao desenvolvimento local.
 * Qualquer outro host e recusado no boot.
 */
export const N8N_WEBHOOK_ALLOWED_HOSTS: readonly string[] = ['n8n', 'localhost', '127.0.0.1'];

export type WebhookUrlResult =
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly problem: string };

/**
 * Valida a URL do webhook do n8n. Mensagens fixas: a URL informada nunca e
 * repetida no erro.
 */
export function parseN8nWebhookUrl(raw: string): WebhookUrlResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, problem: 'nao e uma URL valida' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, problem: 'deve usar http ou https' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, problem: 'nao pode conter usuario ou senha' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, problem: 'nao pode conter query string nem fragmento' };
  }
  if (!N8N_WEBHOOK_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) {
    return {
      ok: false,
      problem: `o host deve ser um de: ${N8N_WEBHOOK_ALLOWED_HOSTS.join(', ')}`,
    };
  }
  if (!url.pathname.startsWith(N8N_WEBHOOK_PATH_PREFIX) || url.pathname.length <= 9) {
    return { ok: false, problem: `o caminho deve comecar com ${N8N_WEBHOOK_PATH_PREFIX}` };
  }
  return { ok: true, url: url.toString() };
}

/** A chave de assinatura tem o tamanho minimo? (O valor nunca e repetido.) */
export function isAcceptableSigningKey(key: string): boolean {
  return key.length >= SIGNING_KEY_MIN_LENGTH && !/\s/.test(key);
}
