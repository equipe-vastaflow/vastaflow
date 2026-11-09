import { ApiError, NetworkError } from '../../api/client';

/**
 * Mensagem para quem usa a tela. O texto do backend NUNCA e exibido: dele so se
 * le o codigo `PLANTAE_*` (e, no limite de consultas, os segundos de espera).
 */
const PLANTAE_MESSAGES: Record<string, string> = {
  PLANTAE_DISABLED: 'A integração com o Plantae não está disponível neste ambiente.',
  PLANTAE_NOT_CONFIGURED: 'A integração com o Plantae não está disponível neste ambiente.',
  PLANTAE_AUTH_REJECTED:
    'O Plantae recusou a credencial da integração. Avise o administrador do sistema.',
  PLANTAE_FORBIDDEN:
    'A integração não tem permissão para esta consulta no Plantae. Avise o administrador do sistema.',
  PLANTAE_REJECTED_PARAMETERS: 'O Plantae recusou os filtros informados. Revise e tente novamente.',
  PLANTAE_TIMEOUT: 'O Plantae demorou para responder. Tente novamente em instantes.',
  PLANTAE_UNREACHABLE: 'O Plantae está indisponível no momento. Tente novamente em instantes.',
  PLANTAE_TLS_ERROR: 'O Plantae está indisponível no momento. Tente novamente em instantes.',
  PLANTAE_UPSTREAM_ERROR:
    'O Plantae está com problemas para responder. Tente novamente em instantes.',
  PLANTAE_INVALID_RESPONSE:
    'O Plantae respondeu em um formato inesperado; nenhum dado foi exibido. Tente novamente mais tarde.',
};

const GENERIC = 'Não foi possível consultar o Plantae. Tente novamente em instantes.';

export function describePlantaeError(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
  }
  if (!(error instanceof ApiError)) {
    return GENERIC;
  }
  switch (error.status) {
    case 400:
      return 'Filtros inválidos. Confira o período (até 366 dias) e tente novamente.';
    case 401:
      return 'Sua sessão expirou. Entre novamente.';
    case 403:
      return 'Você não tem permissão para esta consulta.';
    case 429: {
      const segundos = /em (\d{1,4}) s\b/.exec(error.message)?.[1];
      return segundos
        ? `Limite de consultas ao Plantae atingido. Tente novamente em ${segundos} s.`
        : 'Limite de consultas ao Plantae atingido. Aguarde um instante e tente novamente.';
    }
  }
  const codigo = /^(PLANTAE_[A-Z_]+)\b/.exec(error.message)?.[1];
  return (codigo && PLANTAE_MESSAGES[codigo]) ?? GENERIC;
}
