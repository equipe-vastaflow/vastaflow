/**
 * Canais cuja identidade externa pode ser vinculada a um usuario interno.
 *
 * So o Telegram, o unico canal que existe. O valor e o mesmo que o adaptador
 * usa em `ExternalIdentity.channel`, entao o resolvedor casa os dois sem
 * traducao. Canal novo entra aqui junto com o adaptador dele.
 */
export enum IdentityChannel {
  Telegram = 'telegram',
  /** Numero de WhatsApp (`wa_id`, so digitos) recebido pela Cloud API oficial da Meta. */
  Whatsapp = 'whatsapp',
}

/**
 * Estado de uma solicitacao de vinculo.
 *
 * - `PENDENTE`: aguardando a conta externa enviar o codigo (ate `expira_em`);
 * - `CONFIRMADA`: o codigo foi usado e o vinculo ativo foi criado. Terminal;
 * - `CANCELADA`: cancelada por quem administra o usuario. Terminal;
 * - `EXPIRADA`: vencida e substituida por uma solicitacao nova. Terminal.
 *
 * Vencimento nao depende de job: uma `PENDENTE` depois de `expira_em` ja e
 * recusada na confirmacao, e so muda para `EXPIRADA` quando uma nova e pedida.
 */
export enum LinkRequestStatus {
  Pendente = 'PENDENTE',
  Confirmada = 'CONFIRMADA',
  Cancelada = 'CANCELADA',
  Expirada = 'EXPIRADA',
}

/** Validade do codigo de vinculacao. */
export const LINK_REQUEST_TTL_MS = 15 * 60 * 1000;
