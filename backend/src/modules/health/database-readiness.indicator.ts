import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { HealthIndicator, HealthIndicatorResult } from './health.types';

/**
 * Quanto tempo esperar o banco responder antes de considera-lo indisponivel.
 *
 * Curto de proposito: readiness e consultado por quem decide se manda trafego
 * para o processo. Um banco que demora 5 s para responder `SELECT 1` nao esta
 * em condicoes de atender, e esperar mais apenas atrasa a conclusao.
 */
export const READINESS_TIMEOUT_MS = 2_000;

/** Mensagens fixas: nunca derivadas do erro, que poderia trazer host ou usuario. */
const DETAIL_OK = 'conexao respondendo';
const DETAIL_DOWN = 'banco indisponivel';

/**
 * Verifica se a aplicacao consegue falar com o banco.
 *
 * `SELECT 1` de proposito: nao le tabela, nao depende de schema e nao depende
 * de migration aplicada - responde exatamente a pergunta "a conexao serve?".
 *
 * O `detail` e uma de duas frases fixas. A mensagem do erro original NUNCA e
 * repassada: ela costuma conter host, porta, usuario e, em alguns drivers, a
 * string de conexao inteira. Quem precisa da causa a encontra no log.
 */
@Injectable()
export class DatabaseReadinessIndicator implements HealthIndicator {
  readonly name = 'database';

  constructor(private readonly dataSource: DataSource) {}

  async check(): Promise<HealthIndicatorResult> {
    try {
      await withTimeout(this.dataSource.query('SELECT 1'), READINESS_TIMEOUT_MS);
      return { status: 'ok', detail: DETAIL_OK };
    } catch {
      return { status: 'down', detail: DETAIL_DOWN };
    }
  }
}

/**
 * Resolve com a promessa, ou rejeita ao estourar o prazo.
 *
 * O timer e sempre limpo: um `setTimeout` pendurado manteria o processo (e o
 * Jest) vivo depois de a consulta responder.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
