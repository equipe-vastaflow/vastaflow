/**
 * Estado operacional de uma integracao, do ponto de vista do VastaFlow.
 *
 * Quatro valores, cada um com uma acao diferente para quem opera o sistema:
 *
 * - `DISABLED`: desligada de proposito. Nada a fazer;
 * - `NOT_CONFIGURED`: falta configuracao obrigatoria. Preencher o ambiente;
 * - `READY`: configurada e apta a ser usada. So neste estado o health check roda;
 * - `ERROR`: configurada, mas em estado invalido (ou a propria verificacao de
 *   estado falhou). Investigar.
 *
 * "Conectado" nao e um estado: conectividade e disponibilidade do servico
 * externo sao respostas do health check (`ok`/`degraded`/`down`), que ja tem
 * vocabulario proprio em `health.types.ts`.
 */
export enum IntegrationStatus {
  Disabled = 'DISABLED',
  NotConfigured = 'NOT_CONFIGURED',
  Ready = 'READY',
  Error = 'ERROR',
}

/**
 * Categoria da integracao, para agrupar e descrever - nunca para decidir
 * comportamento.
 *
 * Somente as categorias das integracoes ja previstas (`integrations/README.md`):
 * mensageria (WhatsApp, Telegram), e-mail e fiscal (NFS-e). `OTHER` cobre o que
 * ainda nao tem natureza definida - o Plantae, sem documentacao de API ate aqui.
 * Categoria nova entra quando houver uma integracao real que precise dela.
 */
export enum IntegrationCategory {
  Messaging = 'MESSAGING',
  Email = 'EMAIL',
  Fiscal = 'FISCAL',
  Other = 'OTHER',
}
