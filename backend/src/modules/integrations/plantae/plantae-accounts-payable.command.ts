import { SlidingWindowLimiter } from '../../../common/rate-limit/sliding-window-limiter';
import { AuditAction, AuditModuleName } from '../../audit/audit-action.enum';
import { parseCommand } from '../../commands/command-parser';
import {
  commandFailure,
  commandOk,
  CommandOutcome,
  type CommandAuditConfig,
  type CommandContext,
  type CommandHandler,
  type CommandResult,
} from '../../commands/command.types';
import { PermissionCode } from '../../permissions/permission-code.enum';
import type { ConfigReader } from '../integration-config';
import {
  addDaysToCalendarDate,
  parseCalendarDate,
  todayInTimeZone,
  validatePeriod,
} from './plantae-dates';
import { PlantaeApiError, PlantaeInputError } from './plantae-errors';
import { resolvePlantaeSettings } from './plantae-settings';
import type { PlantaeService } from './plantae.service';
import type { PlantaeEntry } from './plantae.types';

export const PLANTAE_CHAT_COMMANDS_KEY = 'PLANTAE_CHAT_COMMANDS_ENABLED';

/** Janela padrao de `/contas_pagar` sem argumentos: hoje + 7 dias (8 dias, extremos incluidos). */
export const DEFAULT_WINDOW_DAYS = 7;
/** Janela maxima por chat. O Plantae aceita 366; uma conversa nao precisa disso. */
export const MAX_CHAT_WINDOW_DAYS = 31;
/** Itens por resposta: uma conversa nao e um relatorio. */
export const CHAT_PAGE_SIZE = 5;
/** Consultas por minuto por PESSOA. Protege a API do Plantae de uma identidade insistente. */
export const CHAT_QUERIES_PER_MINUTE = 3;
/** Prazo da consulta ao Plantae dentro de um comando de chat. */
export const CHAT_DEADLINE_MS = 20_000;

const NAME_MAX = 28;
const SYMBOL_MAX = 4;

export const CONTAS_PAGAR_USAGE =
  'Uso: /contas_pagar  (vencimentos de hoje ate 7 dias)  ou  ' +
  `/contas_pagar AAAA-MM-DD AAAA-MM-DD  (periodo de ate ${String(MAX_CHAT_WINDOW_DAYS)} dias).`;

/** Mensagens de indisponibilidade. Fixas: nada do Plantae e repetido. */
export const CONTAS_PAGAR_MESSAGES = {
  chatDisabled: 'A consulta de contas a pagar por este canal esta desativada neste ambiente.',
  integrationDisabled: 'A integracao com o Plantae esta desativada neste ambiente.',
  notConfigured: 'A integracao com o Plantae nao esta configurada neste ambiente.',
  credentialRefused:
    'O Plantae recusou a credencial da integracao. Avise quem administra o sistema.',
  rateLimited: 'Limite de consultas ao Plantae atingido. Tente novamente em instantes.',
  rejected: 'O Plantae rejeitou os parametros da consulta.',
  unavailable: 'O Plantae esta indisponivel no momento. Tente novamente mais tarde.',
  throttled: 'Muitas consultas de contas a pagar em pouco tempo. Tente novamente em instantes.',
  empty: 'Nenhuma conta a pagar pendente com vencimento no periodo.',
} as const;

/**
 * `/contas_pagar` - contas a pagar PENDENTES do Plantae, por vencimento.
 *
 * SOMENTE LEITURA, e so homologacao (o host do Plantae e fixo no codigo). Usa o
 * `PlantaeService` existente - uma pagina, no maximo 5 itens - e nao mistura nada
 * com o financeiro local (`/financeiro`).
 *
 * SEGURANCA, em camadas:
 * 1. o router so chama este handler para uma PESSOA identificada que tenha
 *    `plantae:read` (so o ADMIN, por padrao). O n8n/servico nunca chega aqui sem
 *    essa pessoa;
 * 2. `PLANTAE_CHAT_COMMANDS_ENABLED` (desligado por padrao) e um opt-in proprio:
 *    ligar a integracao para a API nao leva dado da cliente para uma conversa;
 * 3. `PLANTAE_ENABLED` precisa estar ligado; do contrario nao ha consulta e a
 *    resposta diz exatamente isso - nunca finge ter consultado.
 *
 * REGRAS DE DADOS (documentadas porque sao decisoes):
 * - sem argumentos: vencimentos de HOJE (fuso de Brasilia) ate hoje + 7 dias, so
 *   status 0 (pendente). Nada e inferido alem disso;
 * - com datas: `AAAA-MM-DD AAAA-MM-DD`, ate 31 dias;
 * - cada linha mostra vencimento, valor na MOEDA DO TITULO, parcela e o nome da
 *   pessoa (truncado). CPF/CNPJ, observacao, descricao e rateio NUNCA saem;
 * - dinheiro e formatado a partir do TEXTO decimal exato: sem `float`, sem
 *   arredondar, sem somar - nao ha total, entao nao ha mistura de moedas;
 * - falha do Plantae vira uma frase fixa. Nao ha dado de substituicao.
 *
 * ATENCAO DE CONFIDENCIALIDADE: o Telegram NAO e ponta a ponta nas conversas
 * comuns; o texto fica nos servidores dele. Por isso este comando e opt-in e
 * restrito a permissao propria.
 */
export class AccountsPayableCommandHandler implements CommandHandler {
  readonly name = 'contas_pagar';
  readonly description = 'Contas a pagar pendentes no Plantae (consulta, homologacao)';
  readonly permission = PermissionCode.PlantaeRead;
  // Auditoria opt-in do motor: grava QUEM executou e o desfecho, sem texto nem dado
  // de negocio (ver `CommandRouter.recordAudit`).
  readonly audit: CommandAuditConfig = {
    acao: AuditAction.PlantaeQueried,
    modulo: AuditModuleName.Plantae,
  };

  constructor(
    private readonly service: PlantaeService,
    private readonly config: ConfigReader,
    private readonly now: () => Date = (): Date => new Date(),
    private readonly limiter: SlidingWindowLimiter = new SlidingWindowLimiter(
      CHAT_QUERIES_PER_MINUTE,
      60_000,
    ),
  ) {}

  async handle(context: CommandContext): Promise<CommandResult> {
    if (this.config.get<unknown>(PLANTAE_CHAT_COMMANDS_KEY) !== true) {
      return unavailable(CONTAS_PAGAR_MESSAGES.chatDisabled);
    }
    if (!resolvePlantaeSettings(this.config).enabled) {
      return unavailable(CONTAS_PAGAR_MESSAGES.integrationDisabled);
    }

    const period = this.resolvePeriod(context.text);
    if (period === null) {
      return commandFailure(CommandOutcome.MalformedCommand, CONTAS_PAGAR_USAGE);
    }

    // Por PESSOA (nao global): quem insiste so se limita a si. So conta consulta valida.
    if (!this.limiter.take(context.user.id).allowed) {
      return unavailable(CONTAS_PAGAR_MESSAGES.throttled);
    }

    try {
      const page = await withDeadline(
        this.service.listEntries({
          tipo: 'despesa',
          status: [0],
          dataInicio: period.from,
          dataFim: period.to,
          perPage: CHAT_PAGE_SIZE,
        }),
        CHAT_DEADLINE_MS,
      );
      return commandOk(formatReply(period, page.items, page.pagination.hasMore));
    } catch (error) {
      if (error instanceof PlantaeInputError) {
        return commandFailure(CommandOutcome.MalformedCommand, CONTAS_PAGAR_USAGE);
      }
      if (error instanceof PlantaeApiError) {
        return unavailable(messageFor(error));
      }
      if (error instanceof DeadlineError) {
        return unavailable(CONTAS_PAGAR_MESSAGES.unavailable);
      }
      throw error; // bug de programacao: o router responde com o texto generico
    }
  }

  /** `null` = argumentos invalidos. */
  private resolvePeriod(text: string): { from: string; to: string } | null {
    const parsed = parseCommand(text);
    const args = parsed.kind === 'command' ? parsed.command.args : [];

    if (args.length === 0) {
      const from = todayInTimeZone(this.now());
      const to = addDaysToCalendarDate(from, DEFAULT_WINDOW_DAYS);
      return to === null ? null : { from, to };
    }
    const [from, to] = args;
    if (args.length !== 2 || from === undefined || to === undefined) {
      return null;
    }
    if (parseCalendarDate(from) === null || parseCalendarDate(to) === null) {
      return null;
    }
    if (validatePeriod(from, to).length > 0) {
      return null;
    }
    const limit = addDaysToCalendarDate(from, MAX_CHAT_WINDOW_DAYS - 1);
    return limit !== null && to <= limit ? { from, to } : null;
  }
}

/** Falha operacional: o comando nao pode ser atendido agora. */
function unavailable(reply: string): CommandResult {
  return commandFailure(CommandOutcome.HandlerError, reply);
}

function messageFor(error: PlantaeApiError): string {
  switch (error.kind) {
    case 'disabled':
      return CONTAS_PAGAR_MESSAGES.integrationDisabled;
    case 'not-configured':
      return CONTAS_PAGAR_MESSAGES.notConfigured;
    case 'unauthorized':
    case 'forbidden':
      return CONTAS_PAGAR_MESSAGES.credentialRefused;
    case 'rate-limited':
      return CONTAS_PAGAR_MESSAGES.rateLimited;
    case 'rejected-parameters':
      return CONTAS_PAGAR_MESSAGES.rejected;
    default:
      return CONTAS_PAGAR_MESSAGES.unavailable;
  }
}

// --- prazo -------------------------------------------------------------------

class DeadlineError extends Error {}

/**
 * Limita a espera de um comando de chat. Estourado o prazo, o usuario recebe a
 * frase de indisponibilidade; a consulta em curso termina sozinha em segundo plano
 * (somente leitura, ocupa so uma vaga do limitador).
 */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DeadlineError());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('falha'));
      },
    );
  });
}

// --- formatacao --------------------------------------------------------------

function formatReply(
  period: { from: string; to: string },
  items: readonly PlantaeEntry[],
  hasMore: boolean | null,
): string {
  const head = `Contas a pagar pendentes (Plantae, homologacao)\nVencimento: ${formatDate(period.from)} a ${formatDate(period.to)}`;
  if (items.length === 0) {
    return `${head}\n${CONTAS_PAGAR_MESSAGES.empty}`;
  }
  const lines = items.map((entry, index) => `${String(index + 1)}) ${formatLine(entry)}`);
  const tail =
    hasMore === true
      ? `Mostrando ${String(items.length)}. Ha mais resultados: use um periodo menor.`
      : hasMore === null
        ? `Mostrando ${String(items.length)}. Nao foi possivel confirmar se ha mais.`
        : `Total listado: ${String(items.length)}.`;
  return [head, ...lines, tail].join('\n');
}

function formatLine(entry: PlantaeEntry): string {
  const due = entry.data_vencto === null ? 'sem vencimento' : formatDate(entry.data_vencto);
  const symbol = cleanText(entry.titulo.moeda?.simbolo ?? '', SYMBOL_MAX);
  const money =
    entry.valor === null
      ? 'valor nao informado'
      : `${symbol === '' ? '' : `${symbol} `}${formatDecimal(entry.valor)}${symbol === '' ? ' (moeda nao informada)' : ''}`;
  const who =
    cleanText(entry.pessoa?.nome ?? entry.pessoa?.razao_social ?? '', NAME_MAX) || 'sem nome';
  const installment =
    entry.numero !== null && entry.total_parcelas !== null
      ? ` (parcela ${String(entry.numero)}/${String(entry.total_parcelas)})`
      : '';
  return `${due} - ${money} - ${who}${installment}`;
}

/** `2026-10-15` -> `15/10/2026`. */
export function formatDate(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Decimal exato (texto) -> `1.234,56`, SEM `number`: separa por texto, agrupa os
 * milhares e usa virgula. Ate 2 casas completa com zeros; MAIS de 2 casas e
 * mostrado como veio (nunca arredondado). Entrada fora do formato volta como esta.
 */
export function formatDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    return value;
  }
  const [, sign = '', integer = '0', fraction = ''] = match;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = fraction.length < 2 ? fraction.padEnd(2, '0') : fraction;
  return `${sign}${grouped},${cents}`;
}

/** Texto de dado externo: sem controle/quebra de linha e com tamanho limitado. */
function cleanText(value: string, max: number): string {
  const flat = [...value]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? ' ' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}
