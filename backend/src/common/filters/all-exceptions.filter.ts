import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorResponseDto } from '../dto/error-response.dto';

/** Codigo a partir do qual a falha e tratada como erro do servidor. */
const SERVER_ERROR_THRESHOLD = 500;

/**
 * Tipo do erro que o `body-parser` lanca quando o corpo passa do limite.
 *
 * Nao e uma `HttpException`, entao sem este tratamento viraria 500: o cliente
 * nao conseguiria distinguir "mandei corpo grande demais" de "o servidor
 * quebrou", e cada tentativa geraria um `incidentId` e um stack trace no log -
 * incidente falso para algo que e pedido invalido.
 */
const BODY_TOO_LARGE_TYPE = 'entity.too.large';

/**
 * Codigo do erro que o `multer` lanca quando o ARQUIVO passa do limite.
 *
 * Mesmo raciocinio do anterior, em outra camada: o limite de corpo e do
 * `body-parser` e vale para JSON; o limite de arquivo e do interceptor de
 * upload. Os dois chegam aqui como erro comum, e os dois descrevem um pedido
 * grande demais - logo, 413 nos dois casos.
 */
const FILE_TOO_LARGE_CODE = 'LIMIT_FILE_SIZE';

/**
 * Filtro global de excecoes.
 *
 * Garante duas coisas exigidas pelo briefing:
 *
 * 1. Toda resposta de erro tem o mesmo formato (`ErrorResponseDto`);
 * 2. Detalhe interno nao vaza para o cliente. Erros 5xx respondem com uma
 *    mensagem generica e um `incidentId`; a causa real fica apenas no log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = resolveStatus(exception);

    const isServerError = status >= SERVER_ERROR_THRESHOLD;
    const incidentId = isServerError ? randomUUID() : undefined;

    const body: ErrorResponseDto = {
      statusCode: status,
      error: httpStatusName(status),
      message: isServerError ? 'Erro interno do servidor' : extractMessage(exception, status),
      path: request.url,
      timestamp: new Date().toISOString(),
      ...(incidentId ? { incidentId } : {}),
    };

    this.log(exception, status, request, incidentId);

    response.status(status).json(body);
  }

  private log(exception: unknown, status: number, request: Request, incidentId?: string): void {
    const prefix = incidentId ? `[${incidentId}] ` : '';
    const context = `${prefix}${request.method} ${request.url} -> ${status}`;

    if (status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(context, exception instanceof Error ? exception.stack : String(exception));
      return;
    }

    this.logger.warn(`${context} ${describe(exception)}`);
  }
}

/**
 * Status HTTP da falha.
 *
 * `HttpException` traz o proprio. Fora dela, a unica excecao reconhecida e o
 * corpo acima do limite (`entity.too.large`), que e pedido invalido do cliente
 * e nao falha do servidor. Qualquer outra coisa segue sendo 500 - alargar isto
 * para "qualquer erro com campo status" faria o filtro confiar em propriedade
 * de erro desconhecido para decidir o que responder.
 */
function resolveStatus(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (isTooLarge(exception)) {
    return HttpStatus.PAYLOAD_TOO_LARGE;
  }
  return SERVER_ERROR_THRESHOLD;
}

/**
 * Reconhece "pedido grande demais" nas duas camadas que podem recusa-lo.
 *
 * Deliberadamente por marcador especifico (`type` do `body-parser`, `code` do
 * `multer`), e nao por "qualquer erro com campo status": alargar isto faria o
 * filtro confiar em propriedade de erro desconhecido para decidir a resposta.
 */
function isTooLarge(exception: unknown): boolean {
  if (!(exception instanceof Error)) {
    return false;
  }
  const { type, code } = exception as { type?: unknown; code?: unknown };
  return type === BODY_TOO_LARGE_TYPE || code === FILE_TOO_LARGE_CODE;
}

/**
 * Extrai a mensagem de uma `HttpException` preservando o array de mensagens
 * produzido pelo `ValidationPipe`.
 */
function extractMessage(exception: unknown, status: number): string | string[] {
  if (!(exception instanceof HttpException)) {
    return httpStatusName(status);
  }

  const payload: unknown = exception.getResponse();

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload;

    if (typeof message === 'string') {
      return message;
    }
    if (isStringArray(message)) {
      return message;
    }
  }

  return exception.message || httpStatusName(status);
}

/** O `ValidationPipe` devolve `message` como lista de mensagens de validacao. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function describe(exception: unknown): string {
  if (exception instanceof HttpException) {
    return exception.message;
  }
  return exception instanceof Error ? exception.message : String(exception);
}

/**
 * Nome canonico do status HTTP (ex.: 404 -> 'Not Found').
 *
 * Usa a tabela do proprio Node em vez de percorrer o enum `HttpStatus`,
 * que possui mapeamento reverso e tornaria a busca ambigua.
 */
function httpStatusName(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}
