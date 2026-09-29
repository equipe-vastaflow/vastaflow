/**
 * Quem enviou a mensagem, NO CANAL de origem.
 *
 * E uma identidade EXTERNA: o id do remetente no Telegram (ou, no futuro, o
 * numero no WhatsApp) nao e um usuario do VastaFlow e nunca e usado como se
 * fosse. A passagem de identidade externa para usuario interno e trabalho
 * exclusivo de um `ChannelIdentityResolver`.
 */
export interface ExternalIdentity {
  /** Canal de origem, ex.: `telegram`. */
  readonly channel: string;
  /** Id do remetente no canal, sempre como texto. */
  readonly externalId: string;
}

/**
 * Mensagem recebida de um canal de mensageria, ja reduzida ao minimo.
 *
 * Independente de fornecedor: nenhum campo do payload original (nome, username,
 * telefone, anexos, ids de mensagem) entra aqui. E tudo o que o sistema precisa
 * para identificar o remetente, executar o comando e saber onde responder.
 */
export interface IncomingMessage {
  readonly channel: string;
  /** Onde responder - no Telegram, o id do chat. */
  readonly conversationId: string;
  readonly sender: ExternalIdentity;
  readonly text: string;
  readonly receivedAt: Date;
}
