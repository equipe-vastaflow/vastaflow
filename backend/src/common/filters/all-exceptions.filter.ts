import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorResponseDto } from '../dto/error-response.dto';

/** Codigo a partir do qual a falha e tratada como erro do servidor. */
const SERVER_ERROR_THRESHOLD = 500;

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

    const status =
      exception instanceof HttpException ? exception.getStatus() : SERVER_ERROR_THRESHOLD;

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
