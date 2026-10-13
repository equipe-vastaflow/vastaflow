/**
 * Sistemas que podem chamar a API como SERVICO.
 *
 * Um principal de servico NAO e uma pessoa e NAO e uma linha da tabela de
 * usuarios. Responde "qual SISTEMA esta chamando", que e uma pergunta diferente
 * de "qual PESSOA originou a acao" (o ator de negocio, resolvido pelo backend a
 * partir de `external_identity_links` numa etapa futura).
 * Ver docs/autenticacao-servico-a-servico.md.
 */
export enum ServicePrincipalId {
  N8n = 'n8n',
  /**
   * O workflow de entrada do Telegram no n8n. Principal PROPRIO, e nao um escopo
   * a mais em `n8n`, para que a credencial do fluxo de mensagens seja outra: um
   * vazamento dela nao abre `service:identity`, e a identidade tecnica de
   * `n8n` nao ganha poder de ingestao. Credenciais proprias, rotacao propria.
   */
  N8nTelegram = 'n8n-telegram',
}

/**
 * Escopos de servico.
 *
 * Deliberadamente SEPARADOS de `PermissionCode`: aquelas sao permissoes de
 * perfil humano (RBAC), e misturar os dois vocabularios faria um escopo de
 * servico parecer capaz de abrir uma permissao administrativa, ou o contrario.
 */
export enum ServiceScope {
  /** Consultar a propria identidade de servico. Endpoint tecnico, sem dado de negocio. */
  Identity = 'service:identity',
  /**
   * Entregar ao backend um envelope de mensagem do Telegram JA ASSINADO por ele.
   *
   * Nao autoriza nada de negocio: o backend so age se a assinatura do envelope
   * confere, e age como a PESSOA vinculada ao remetente (RBAC dela), nunca como o
   * servico. Ter este escopo nao permite escolher quem fala.
   */
  TelegramIngest = 'service:telegram:ingest',
}

export interface ServicePrincipalDefinition {
  readonly description: string;
  readonly scopes: readonly ServiceScope[];
}

/**
 * O que cada principal PODE fazer.
 *
 * Fica em CODIGO, e nao no arquivo de credenciais, de proposito: um escopo novo
 * passa por revisao e por Git, em vez de ser concedido editando um arquivo no
 * servidor. O arquivo diz QUEM e a credencial; o codigo diz O QUE ela pode.
 *
 * Menor escopo possivel: hoje o n8n so consegue consultar a propria identidade.
 * NENHUM escopo de negocio existe - nem financeiro, nem documentos, nem usuarios.
 * Cada escopo novo nasce junto com o primeiro workflow que precisa dele.
 */
export const SERVICE_PRINCIPALS: Readonly<Record<ServicePrincipalId, ServicePrincipalDefinition>> =
  {
    [ServicePrincipalId.N8n]: {
      description: 'n8n (orquestrador de integracoes e automacoes)',
      scopes: [ServiceScope.Identity],
    },
    [ServicePrincipalId.N8nTelegram]: {
      description: 'n8n - workflow de entrada de mensagens do Telegram',
      scopes: [ServiceScope.TelegramIngest],
    },
  };

/** `true` quando o texto e um principal conhecido. */
export function isServicePrincipalId(value: unknown): value is ServicePrincipalId {
  return (
    typeof value === 'string' && (Object.values(ServicePrincipalId) as string[]).includes(value)
  );
}

/** A identidade de servico anexada a requisicao depois de autenticada. */
export interface AuthenticatedService {
  readonly principal: ServicePrincipalId;
  /** Qual credencial autenticou - permite ver, numa rotacao, qual delas esta em uso. */
  readonly credentialId: string;
  readonly scopes: readonly ServiceScope[];
}
