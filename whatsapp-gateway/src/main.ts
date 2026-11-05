import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { baileysAuthCodec } from './baileys-auth-codec.js';
import { createBaileysSocketFactory } from './baileys-socket.js';
import { ConfigError, loadConfig, type GatewayConfig } from './config.js';
import { EncryptedSessionStore } from './encrypted-session-store.js';
import { Gateway } from './gateway.js';
import { HttpIngestClient } from './ingest-client.js';
import { JsonLogger, type GatewayLogger } from './logger.js';
import { MysqlSessionRepository } from './mysql-session-repository.js';
import { SessionUnavailableError, type Scheduler } from './ports.js';
import { SessionCipher } from './session-crypto.js';

const scheduler: Scheduler = {
  after: (delayMs, task) => {
    const timer = setTimeout(task, delayMs);
    return () => {
      clearTimeout(timer);
    };
  },
};

function readConfig(logger: GatewayLogger): GatewayConfig | null {
  try {
    return loadConfig(process.env, (path) => readFileSync(path, 'utf8'));
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
    return null;
  }
}

/**
 * Ponto de entrada.
 *
 * Sem `GATEWAY_CONNECT_ENABLED=true` o processo so VERIFICA: valida a configuracao, toma a trava da sessao, confere que
 * a chave de cifra decifra o estado gravado (ou que a sessao ainda nao existe), solta a trava e sai. NAO abre socket e
 * NAO fala com o WhatsApp. E a verificacao a usar no Docker antes de qualquer pareamento.
 *
 * Com `GATEWAY_CONNECT_ENABLED=true` conecta (so quando houver pareamento/teste autorizados).
 */
async function main(): Promise<void> {
  const logger = new JsonLogger((line) => process.stdout.write(`${line}\n`));
  const config = readConfig(logger);
  if (config === null) {
    process.exitCode = 1;
    return;
  }

  const repository = new MysqlSessionRepository(config.db);
  const store = new EncryptedSessionStore({
    repository,
    cipher: new SessionCipher(config.encryptionKey),
    codec: baileysAuthCodec,
    scheduler,
    sessionId: config.sessionId,
    owner: randomUUID(),
  });

  try {
    if (!config.connectEnabled) {
      const state = await store.verify();
      logger.event('sessao-verificada', { estado: state });
      logger.event('conexao-desabilitada');
      return;
    }

    const gateway = new Gateway({
      socketFactory: createBaileysSocketFactory(),
      sessions: store,
      ingest: new HttpIngestClient({
        baseUrl: config.backendUrl,
        token: config.serviceToken,
        timeoutMs: config.ingestTimeoutMs,
      }),
      config,
      clock: { now: () => Date.now() },
      scheduler,
      logger,
    });
    const shutdown = (): void => {
      gateway.stop();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);

    await gateway.start();
    const reason = await gateway.waitUntilStopped();
    process.exitCode = reason === 'parado' ? 0 : 1;
  } catch (error) {
    // Nunca o erro original (pode citar host, usuario ou SQL do banco): so o motivo fixo.
    logger.event('sessao-indisponivel', {
      motivo: error instanceof SessionUnavailableError ? error.reason : 'sessao-indisponivel',
    });
    process.exitCode = 1;
  } finally {
    await store.close().catch(() => undefined);
    await repository.close().catch(() => undefined);
  }
}

void main();
