import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { PlantaeApiError, PlantaeInputError, type PlantaeFailure } from './plantae-errors';

interface PublicFailure {
  readonly status: number;
  /** Codigo estavel: o que se procura no log e se informa ao suporte. */
  readonly code: string;
  readonly text: string;
}

const FAILED = HttpStatus.FAILED_DEPENDENCY;

const UNREACHABLE: PublicFailure = {
  status: FAILED,
  code: 'PLANTAE_UNREACHABLE',
  text: 'Nao foi possivel conectar ao Plantae',
};
const INVALID_RESPONSE: PublicFailure = {
  status: FAILED,
  code: 'PLANTAE_INVALID_RESPONSE',
  text: 'O Plantae devolveu uma resposta fora do formato esperado; nenhum dado foi usado',
};

/**
 * Como cada falha vira resposta HTTP.
 *
 * 424 (Failed Dependency) e 429, de proposito, e nunca 5xx: o filtro global
 * troca QUALQUER 5xx por "Erro interno do servidor", e quem consulta precisaria
 * saber que o problema esta no Plantae. 401/403 tambem ficam de fora: seriam lidos
 * como falha do login do PROPRIO usuario no VastaFlow, quando quem foi recusado
 * foi a credencial da integracao.
 *
 * O texto e fixo e generico. Nada do que veio do Plantae (corpo, mensagem, URL,
 * CPF/CNPJ) e repetido. Em nenhum caso ha dado substituto: a resposta e a falha.
 */
const FAILURES: Readonly<Record<PlantaeFailure, PublicFailure>> = {
  disabled: {
    status: FAILED,
    code: 'PLANTAE_DISABLED',
    text: 'A integracao com o Plantae esta desabilitada neste ambiente',
  },
  'not-configured': {
    status: FAILED,
    code: 'PLANTAE_NOT_CONFIGURED',
    text: 'A integracao com o Plantae nao esta configurada neste ambiente',
  },
  unauthorized: {
    status: FAILED,
    code: 'PLANTAE_AUTH_REJECTED',
    text: 'O Plantae recusou a credencial da integracao (invalida, expirada ou revogada)',
  },
  forbidden: {
    status: FAILED,
    code: 'PLANTAE_FORBIDDEN',
    text: 'A credencial da integracao nao tem permissao para esta consulta no Plantae',
  },
  'rejected-parameters': {
    status: FAILED,
    code: 'PLANTAE_REJECTED_PARAMETERS',
    text: 'O Plantae rejeitou os parametros da consulta',
  },
  'rate-limited': {
    status: HttpStatus.TOO_MANY_REQUESTS,
    code: 'PLANTAE_RATE_LIMITED',
    text: 'Limite de consultas ao Plantae atingido',
  },
  timeout: {
    status: FAILED,
    code: 'PLANTAE_TIMEOUT',
    text: 'O Plantae nao respondeu a tempo',
  },
  dns: UNREACHABLE,
  'connection-refused': UNREACHABLE,
  tls: {
    status: FAILED,
    code: 'PLANTAE_TLS_ERROR',
    text: 'Nao foi possivel estabelecer conexao segura com o Plantae',
  },
  network: UNREACHABLE,
  redirect: INVALID_RESPONSE,
  'invalid-response': INVALID_RESPONSE,
  'response-too-large': INVALID_RESPONSE,
  'pagination-inconsistent': INVALID_RESPONSE,
  'cursor-loop': INVALID_RESPONSE,
  'server-error': {
    status: FAILED,
    code: 'PLANTAE_UPSTREAM_ERROR',
    text: 'O Plantae esta com problemas para responder',
  },
  http: {
    status: FAILED,
    code: 'PLANTAE_UPSTREAM_ERROR',
    text: 'O Plantae esta com problemas para responder',
  },
};

/** Codigo estavel da falha, para auditoria e log. */
export function failureCode(error: PlantaeApiError): string {
  return FAILURES[error.kind].code;
}

/**
 * Converte um erro da integracao na excecao HTTP. Erro que nao e da integracao
 * volta como esta (vira 500 generico, com `incidentId`, no filtro global).
 */
export function toHttpException(error: unknown): Error {
  if (error instanceof PlantaeInputError) {
    return new BadRequestException([...error.problems]);
  }
  if (!(error instanceof PlantaeApiError)) {
    return error instanceof Error ? error : new Error('Falha desconhecida na consulta ao Plantae');
  }
  const failure = FAILURES[error.kind];
  let text = `${failure.code}: ${failure.text}`;
  if (error.kind === 'rejected-parameters' && (error.detail.parameters?.length ?? 0) > 0) {
    text += ` (parametros: ${(error.detail.parameters ?? []).join(', ')})`;
  }
  if (error.detail.retryAfterSeconds !== undefined) {
    text += `. Tente novamente em ${String(error.detail.retryAfterSeconds)} s`;
  }
  return new HttpException(text, failure.status);
}
