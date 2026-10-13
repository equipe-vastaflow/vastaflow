import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { validateEnv } from '../../../config/env.validation';
import { buildDataSourceOptions } from '../../../database/database.config';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { EVENT_RETENTION_MIN_DAYS, STUCK_AFTER_MS } from './telegram-events.policy';
import { TelegramInboundEvent } from './telegram-inbound-event.entity';
import { TelegramInboundEventsRepository } from './telegram-inbound-events.repository';

/**
 * Operacao tecnica da tabela `telegram_inbound_events` (idempotencia do Telegram).
 * Roda no servidor, dentro da imagem do backend, com o mesmo ambiente dela:
 *
 *   node dist/modules/integrations/telegram-ingest/telegram-events.cli.js report
 *   node dist/modules/integrations/telegram-ingest/telegram-events.cli.js abandon --id <uuid>
 *   node dist/modules/integrations/telegram-ingest/telegram-events.cli.js purge --older-than-days 30 [--yes]
 *
 * Nao e uma rota HTTP (nenhuma superficie nova), nunca imprime conteudo de mensagem
 * (a tabela nao tem), e NUNCA reexecuta um comando:
 *
 * - `report`: contagem por status e os eventos PRESOS (`PROCESSANDO` ha mais de
 *   `STUCK_AFTER_MS`). So leitura;
 * - `abandon`: encerra um evento preso como `ABANDONADO`. A reserva permanece, entao o
 *   update nao e executado depois. Recusa evento que nao esteja preso;
 * - `purge`: apaga eventos TERMINAIS antigos (retencao), com piso de
 *   `EVENT_RETENTION_MIN_DAYS`. Sem `--yes` so conta (simulacao). Nunca apaga preso.
 *
 * `abandon` e `purge --yes` deixam uma linha de auditoria (`TELEGRAM_EVENT_ADMIN`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** O que a CLI precisa do armazenamento (faz de conta nos testes). */
export interface EventsStore {
  countByStatus(): Promise<Record<string, number>>;
  findStuck(olderThan: Date, limit?: number): Promise<TelegramInboundEvent[]>;
  abandon(id: string, olderThan: Date): Promise<boolean>;
  purgeTerminalBefore(before: Date): Promise<number>;
  /** Conta o que `purgeTerminalBefore` apagaria (simulacao). */
  countTerminalBefore(before: Date): Promise<number>;
}

export interface EventsCliDeps {
  readonly store: EventsStore;
  readonly audit: (metadados: Record<string, string | number>) => Promise<void>;
  readonly now: () => Date;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Erro de uso: a mensagem e nossa e pode ser mostrada. Qualquer outro erro vira texto fixo. */
class UsageError extends Error {}

const USAGE = `uso:
  report
  abandon --id <uuid-do-evento>
  purge --older-than-days <n (>= ${String(EVENT_RETENTION_MIN_DAYS)})> [--yes]`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i] ?? '';
    if (raw === '--yes') {
      flags.set('yes', 'true');
    } else if (raw === '--id' || raw === '--older-than-days') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`falta o valor de ${raw}\n${USAGE}`);
      }
      flags.set(raw.slice(2), value);
      i += 1;
    } else {
      throw new UsageError(`argumento desconhecido '${raw}'\n${USAGE}`);
    }
  }
  return flags;
}

/** Codigo de saida: 0 ok, 1 uso/recusa. */
export async function run(argv: readonly string[], deps: EventsCliDeps): Promise<number> {
  try {
    const [command, ...rest] = argv;
    const flags = parseFlags(rest);
    const now = deps.now();

    switch (command) {
      case 'report': {
        const counts = await deps.store.countByStatus();
        deps.out('eventos por status:');
        for (const [status, total] of Object.entries(counts).sort()) {
          deps.out(`  ${status.padEnd(12)} ${String(total)}`);
        }
        const stuck = await deps.store.findStuck(new Date(now.getTime() - STUCK_AFTER_MS));
        deps.out(
          `presos (PROCESSANDO ha mais de ${String(STUCK_AFTER_MS / 60000)} min): ${String(stuck.length)}`,
        );
        for (const event of stuck) {
          const minutes = Math.floor((now.getTime() - event.createdAt.getTime()) / 60000);
          deps.out(`  ${event.id}  update=${String(event.updateId)}  ha ${String(minutes)} min`);
        }
        return 0;
      }
      case 'abandon': {
        const id = flags.get('id');
        if (id === undefined || !UUID.test(id)) {
          throw new UsageError(`--id deve ser um uuid\n${USAGE}`);
        }
        const done = await deps.store.abandon(id, new Date(now.getTime() - STUCK_AFTER_MS));
        if (!done) {
          deps.err(
            'nada feito: o evento nao existe, nao esta em PROCESSANDO ou nao esta preso ' +
              `(menos de ${String(STUCK_AFTER_MS / 60000)} min)`,
          );
          return 1;
        }
        await deps.audit({ operacao: 'abandonar', eventoId: id });
        deps.out(`evento ${id} marcado como ABANDONADO (o update NAO sera executado)`);
        return 0;
      }
      case 'purge': {
        const days = Number(flags.get('older-than-days'));
        if (!Number.isInteger(days) || days < EVENT_RETENTION_MIN_DAYS) {
          throw new UsageError(
            `--older-than-days deve ser um inteiro >= ${String(EVENT_RETENTION_MIN_DAYS)} ` +
              `(apagar cedo demais reabre updates ja vistos)\n${USAGE}`,
          );
        }
        const before = new Date(now.getTime() - days * DAY_MS);
        if (flags.get('yes') !== 'true') {
          const count = await deps.store.countTerminalBefore(before);
          deps.out(
            `simulacao: ${String(count)} evento(s) terminal(is) com mais de ${String(days)} dias seriam apagados. Use --yes para apagar.`,
          );
          return 0;
        }
        const count = await deps.store.purgeTerminalBefore(before);
        await deps.audit({ operacao: 'limpar', quantidade: count, dias: days });
        deps.out(`${String(count)} evento(s) apagado(s)`);
        return 0;
      }
      default:
        throw new UsageError(`comando desconhecido '${command ?? ''}'\n${USAGE}`);
    }
  } catch (error) {
    deps.err(
      error instanceof UsageError
        ? `erro: ${error.message}`
        : 'erro: falha ao executar a operacao (veja o log do servidor)',
    );
    return 1;
  }
}

async function main(): Promise<number> {
  const dataSource = new DataSource({
    ...buildDataSourceOptions(validateEnv(process.env)),
    synchronize: false,
  });
  await dataSource.initialize();
  try {
    const repository = dataSource.getRepository(TelegramInboundEvent);
    const events = new TelegramInboundEventsRepository(repository);
    const store: EventsStore = {
      countByStatus: () => events.countByStatus(),
      findStuck: (olderThan, limit) => events.findStuck(olderThan, limit),
      abandon: (id, olderThan) => events.abandon(id, olderThan),
      purgeTerminalBefore: (before) => events.purgeTerminalBefore(before),
      countTerminalBefore: (before) => events.countTerminalBefore(before),
    };
    const auditRepository = dataSource.getRepository(AuditLog);
    return await run(process.argv.slice(2), {
      store,
      now: () => new Date(),
      out: (text) => process.stdout.write(`${text}\n`),
      err: (text) => process.stderr.write(`${text}\n`),
      audit: async (metadados) => {
        await auditRepository.save(
          auditRepository.create({
            usuarioId: null,
            acao: AuditAction.TelegramEventAdmin,
            modulo: AuditModuleName.Channels,
            descricao: 'Intervencao manual em eventos do Telegram',
            ip: null,
            metadados,
          }),
        );
      },
    });
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write('erro: falha ao executar (verifique o ambiente do banco)\n');
      process.exitCode = 1;
    },
  );
}
