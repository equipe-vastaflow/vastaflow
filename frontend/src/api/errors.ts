import { ApiError, NetworkError } from './client';

/**
 * Mensagem para o usuario final a partir de um erro da API. `conflict` e
 * `badRequest` permitem mensagens especificas de cada tela.
 */
export function describeApiError(
  error: unknown,
  messages: { conflict?: string; badRequest?: string } = {},
): string {
  if (error instanceof NetworkError) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        // A mensagem de validacao do backend diz qual campo corrigir.
        return messages.badRequest ?? `Dados inválidos: ${error.message}`;
      case 403:
        return 'Você não tem permissão para esta ação.';
      case 404:
        return 'Usuário não encontrado.';
      case 409:
        return messages.conflict ?? error.message;
    }
  }
  return 'Algo deu errado. Tente novamente em instantes.';
}

/** 401: token expirado ou usuario desativado - a sessao deve ser encerrada. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
