import type { ExternalIdentity } from './incoming-message';

/** Desfecho de uma mensagem oferecida ao confirmador de vinculo. */
export enum LinkConfirmationOutcome {
  /** Nao e uma confirmacao de vinculo: a mensagem segue o fluxo normal. */
  NotAttempted = 'NOT_ATTEMPTED',
  /** Codigo valido: o vinculo ativo foi criado para este remetente. */
  Confirmed = 'CONFIRMED',
  /**
   * Codigo inexistente, expirado, ja usado, mal formado, ou usuario inativo.
   * Deliberadamente UM so desfecho: a resposta nao ensina nada sobre codigos.
   */
  Rejected = 'REJECTED',
  /** Esta conta externa ja tem vinculo ativo; nada foi alterado. */
  AlreadyLinked = 'ALREADY_LINKED',
}

/**
 * Confirma a POSSE de uma conta externa: o remetente envia, pela propria
 * conversa, o codigo de uma solicitacao criada antes pela API interna.
 *
 * Recebe so a identidade do remetente e o texto. O usuario interno vem da
 * solicitacao pendente - nunca da mensagem. E a identidade externa vem do
 * remetente - nunca de um argumento.
 *
 * Roda ANTES da resolucao de identidade, porque quem confirma ainda nao esta
 * vinculado e o Command Engine exige um usuario autenticado.
 */
export interface ChannelLinkConfirmer {
  tryConfirm(sender: ExternalIdentity, text: string): Promise<LinkConfirmationOutcome>;
}

/** Token de injecao do confirmador usado pelos adaptadores de canal. */
export const CHANNEL_LINK_CONFIRMER = Symbol('CHANNEL_LINK_CONFIRMER');
