import { readFileSync } from 'node:fs';
import { createBaileysSocketFactory } from './baileys-socket.js';
import { ConfigError, loadConfig } from './config.js';
import { Gateway } from './gateway.js';
import { HttpIngestClient } from './ingest-client.js';
import { JsonLogger } from './logger.js';
import { NotImplementedSessionStore } from './session-store.js';

/**
 * Ponto de entrada. Etapa 2: o gateway e MONTADO e validado, mas NAO consegue conectar nenhuma conta, porque o
 * armazenamento da sessao (etapa 3) ainda nao existe: `NotImplementedSessionStore` recusa abrir, o gateway para com
 * `sessao-indisponivel` e o processo sai com codigo 1. Nada de rede com o WhatsApp acontece aqui.
 */
async function main(): Promise<void> {
  const logger = new JsonLogger((line) => process.stdout.write(`${line}\n`));
  let config;
  try {
    config = loadConfig(process.env, (path) => readFileSync(path, 'utf8'));
  } catch (error) {
    // Os problemas citam so NOMES de variaveis (nunca valores).
    logger.event('config-invalida', {
      problemas: error instanceof ConfigError ? error.problems.length : 1,
    });
    if (error instanceof ConfigError) {
      for (const problem of error.problems) {
        process.stderr.write(`${problem}\n`);
      }
    }
    process.exitCode = 1;
    return;
  }

  const gateway = new Gateway({
    socketFactory: createBaileysSocketFactory(),
    sessions: new NotImplementedSessionStore(),
    ingest: new HttpIngestClient({
      baseUrl: config.backendUrl,
      token: config.serviceToken,
      timeoutMs: config.ingestTimeoutMs,
    }),
    config,
    clock: { now: () => Date.now() },
    scheduler: {
      after: (delayMs, task) => {
        const timer = setTimeout(task, delayMs);
        return () => {
          clearTimeout(timer);
        };
      },
    },
    logger,
  });

  const shutdown = (): void => {
    gateway.stop();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await gateway.start();
  if (gateway.status().state === 'stopped') {
    process.exitCode = 1;
  }
}

void main();
