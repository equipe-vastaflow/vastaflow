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
import type { PlantaeEnvironment } from './plantae.constants';
import { PlantaeApiError, PlantaeInputError } from './plantae-errors';
import { resolvePlantaeSettings } from './plantae-settings';
import type { PlantaeService } from './plantae.service';
import type { PlantaeEntry } from './plantae.types';

export const PLANTAE_CHAT_COMMANDS_KEY = 'PLANTAE_CHAT_COMMANDS_ENABLED';
/** Atestado do operador: a organizacao da chave foi conferida com referencia independente. */
export const PLANTAE_ORGANIZATION_CONFIRMED_KEY = 'PLANTAE_ORGANIZATION_CONFIRMED';
/** Politica: mostrar o nome do favorecido no chat? Padrao NAO. */
export const PLANTAE_CHAT_SHOW_PAYEE_KEY = 'PLANTAE_CHAT_SHOW_PAYEE_NAME';

/** Primeira linha de TODA resposta com dados: o ambiente e de TESTE. */
export const HOMOLOGATION_BANNER =
  'HOMOLOGACAO - dados de teste do Plantae, nao sao os dados definitivos da empresa.';

/**
 * Producao (`web.plantae.agr.br`): dados REAIS. NUNCA e rotulada de homologacao. O aviso diz so o que e verdade: sao
 * dados reais da empresa e o comando apenas consulta. (A classificacao do host como producao ainda depende de
 * confirmacao escrita do fornecedor - docs/integracao-plantae.md, secao 11.)
 */
export const PRODUCTION_BANNER = 'PRODUCAO - dados reais da empresa no Plantae. Somente consulta.';

/** Ambiente nao identificado (nao deveria chegar a uma resposta): nao afirma homologacao nem producao. */
export const UNKNOWN_ENVIRONMENT_BANNER = 'Plantae - ambiente nao identificado. Somente consulta.';

/** Aviso da primeira linha de TODA resposta, conforme o ambiente do host configurado. */
export function bannerFor(environment: PlantaeEnvironment | null): string {
  switch (environment) {
    case 'homologation':
      return HOMOLOGATION_BANNER;
    case 'production':
      return PRODUCTION_BANNER;
    default:
      return UNKNOWN_ENVIRONMENT_BANNER;
  }
}

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

export const CONTAS_RECEBER_USAGE =
  'Uso: /contas_receber  (vencimentos de hoje ate 7 dias)  ou  ' +
  `/contas_receber AAAA-MM-DD AAAA-MM-DD  (periodo de ate ${String(MAX_CHAT_WINDOW_DAYS)} dias).`;

/** Mensagens de um comando de parcelas. Fixas: nada do Plantae e repetido. */
export interface EntriesCommandMessages {
  readonly chatDisabled: string;
  readonly integrationDisabled: string;
  readonly organizationNotConfirmed: string;
  readonly notConfigured: string;
  readonly credentialRefused: string;
  readonly rateLimited: string;
  readonly rejected: string;
  readonly unavailable: string;
  readonly throttled: string;
  readonly empty: string;
}

/** Comuns aos dois comandos: falhas da integracao nao dependem de pagar ou receber. */
const SHARED_MESSAGES = {
  integrationDisabled: 'A integracao com o Plantae esta desativada neste ambiente.',
  organizationNotConfirmed:
    'Consulta bloqueada: a organizacao do Plantae ainda nao foi confirmada. Avise quem administra o sistema.',
  notConfigured: 'A integracao com o Plantae nao esta configurada neste ambiente.',
  credentialRefused:
    'O Plantae recusou a credencial da integracao. Avise quem administra o sistema.',
  rateLimited: 'Limite de consultas ao Plantae atingido. Tente novamente em instantes.',
  rejected: 'O Plantae rejeitou os parametros da consulta.',
  unavailable: 'O Plantae esta indisponivel no momento. Tente novamente mais tarde.',
} as const;

/** Mensagens de indisponibilidade. Fixas: nada do Plantae e repetido. */
export const CONTAS_PAGAR_MESSAGES = {
  ...SHARED_MESSAGES,
  chatDisabled: 'A consulta de contas a pagar por este canal esta desativada neste ambiente.',
  throttled: 'Muitas consultas de contas a pagar em pouco tempo. Tente novamente em instantes.',
  empty: 'Nenhuma conta a pagar pendente com vencimento no periodo.',
} as const satisfies EntriesCommandMessages;

export const CONTAS_RECEBER_MESSAGES = {
  ...SHARED_MESSAGES,
  chatDisabled: 'A consulta de contas a receber por este canal esta desativada neste ambiente.',
  throttled: 'Muitas consultas de contas a receber em pouco tempo. Tente novamente em instantes.',
  empty: 'Nenhuma conta a receber pendente com vencimento no periodo.',
} as const satisfies EntriesCommandMessages;

/**
 * O que diferencia `/contas_pagar` de `/contas_receber`. TODO o resto - portoes,
 * periodo, limite por pessoa, prazo, filtro de pendentes, formatacao, auditoria e
 * minimizacao de dados - e o MESMO codigo (`PendingEntriesCommandHandler`).
 */
export interface EntriesCommandSpec {
  readonly name: string;
  readonly description: string;
  /** Filtro `tipo` do Plantae. */
  readonly tipo: 'despesa' | 'receita';
  /** Segunda linha da resposta. */
  readonly title: string;
  readonly usage: string;
  readonly messages: EntriesCommandMessages;
  /** Aviso de parcela que ja teve `total_pago` diferente de zero. */
  readonly partialNotice: string;
  /**
   * Se `PLANTAE_CHAT_SHOW_PAYEE_NAME` pode mostrar o nome da contraparte. So o
   * favorecido de contas a pagar; em contas a receber o nome do CLIENTE nunca sai.
   */
  readonly counterpartNameAllowed: boolean;
}

export const CONTAS_PAGAR_SPEC: EntriesCommandSpec = {
  name: 'contas_pagar',
  description: 'Contas a pagar pendentes no Plantae (somente consulta)',
  tipo: 'despesa',
  title: 'Contas a pagar pendentes (Plantae)',
  usage: CONTAS_PAGAR_USAGE,
  messages: CONTAS_PAGAR_MESSAGES,
  partialNotice: 'JA TEVE PAGAMENTO PARCIAL (confira no Plantae)',
  counterpartNameAllowed: true,
};

export const CONTAS_RECEBER_SPEC: EntriesCommandSpec = {
  name: 'contas_receber',
  description: 'Contas a receber pendentes no Plantae (somente consulta)',
  tipo: 'receita',
  title: 'Contas a receber pendentes (Plantae)',
  usage: CONTAS_RECEBER_USAGE,
  messages: CONTAS_RECEBER_MESSAGES,
  partialNotice: 'JA TEVE RECEBIMENTO PARCIAL (confira no Plantae)',
  counterpartNameAllowed: false,
};

/**
 * Limite de consultas por pessoa COMPARTILHADO pelos comandos de parcelas: pagar e
 * receber gastam a mesma cota (3/min), para que ter dois comandos nao dobre o
 * volume que uma identidade pode tirar do Plantae.
 */
export function createPlantaeChatLimiter(): SlidingWindowLimiter {
  return new SlidingWindowLimiter(CHAT_QUERIES_PER_MINUTE, 60_000);
}

/** Token de injecao do limitador compartilhado (`createPlantaeChatLimiter`). */
export const PLANTAE_CHAT_LIMITER = 'PLANTAE_CHAT_LIMITER';

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
 * 4. `PLANTAE_ORGANIZATION_CONFIRMED` (desligado por padrao) e o atestado de que a organizacao
 *    da chave foi conferida com referencia INDEPENDENTE; sem ele nao ha consulta (e o boot
 *    recusa ligar o comando com a integracao ativa).
 *
 * REGRAS DE DADOS (documentadas porque sao decisoes):
 * - sem argumentos: vencimentos de HOJE (fuso de Brasilia) ate hoje + 7 dias, so
 *   status 0 (pendente). Nada e inferido alem disso;
 * - com datas: `AAAA-MM-DD AAAA-MM-DD`, ate 31 dias;
 * - toda resposta comeca com o aviso de HOMOLOGACAO; so entram parcelas com status 0 (pendente)
 *   - o filtro e conferido AQUI tambem, nao so no Plantae (quitada/substituida nunca aparecem);
 * - cada linha mostra vencimento, valor na MOEDA DO TITULO, parcela e a referencia curta
 *   (`parcela_id`). O NOME do favorecido so aparece com `PLANTAE_CHAT_SHOW_PAYEE_NAME=true`
 *   (padrao: nao). Parcela com pagamento parcial e SINALIZADA (nao se calcula saldo: a semantica
 *   de `saldo_atual` nao e documentada). CPF/CNPJ, observacao, descricao e rateio NUNCA saem;
 * - dinheiro e formatado a partir do TEXTO decimal exato: sem `float`, sem
 *   arredondar, sem somar - nao ha total, entao nao ha mistura de moedas;
 * - falha do Plantae vira uma frase fixa. Nao ha dado de substituicao.
 *
 * ATENCAO DE CONFIDENCIALIDADE: o Telegram NAO e ponta a ponta nas conversas
 * comuns; o texto fica nos servidores dele. Por isso este comando e opt-in e
 * restrito a permissao propria.
 *
 * `/contas_receber` e o MESMO handler com `CONTAS_RECEBER_SPEC` (tipo `receita`): mesmos
 * portoes, flags, periodo, limite, prazo e auditoria. A unica diferenca de dados: o nome
 * do CLIENTE nunca sai, nem com `PLANTAE_CHAT_SHOW_PAYEE_NAME` ligado.
 */
export class PendingEntriesCommandHandler implements CommandHandler {
  readonly name: string;
  readonly description: string;
  readonly permission = PermissionCode.PlantaeRead;
  // Auditoria opt-in do motor: grava QUEM executou e o desfecho, sem texto nem dado
  // de negocio (ver `CommandRouter.recordAudit`).
  readonly audit: CommandAuditConfig = {
    acao: AuditAction.PlantaeQueried,
    modulo: AuditModuleName.Plantae,
  };

  constructor(
    private readonly spec: EntriesCommandSpec,
    private readonly service: PlantaeService,
    private readonly config: ConfigReader,
    private readonly now: () => Date = (): Date => new Date(),
    private readonly limiter: SlidingWindowLimiter = createPlantaeChatLimiter(),
  ) {
    this.name = spec.name;
    this.description = spec.description;
  }

  async handle(context: CommandContext): Promise<CommandResult> {
    const messages = this.spec.messages;
    if (this.config.get<unknown>(PLANTAE_CHAT_COMMANDS_KEY) !== true) {
      return unavailable(messages.chatDisabled, 'comando_desligado');
    }
    // FAIL-CLOSED: sem o atestado da organizacao nao se consulta o Plantae.
    if (this.config.get<unknown>(PLANTAE_ORGANIZATION_CONFIRMED_KEY) !== true) {
      return unavailable(messages.organizationNotConfirmed, 'organizacao_nao_confirmada');
    }
    if (!resolvePlantaeSettings(this.config).enabled) {
      return unavailable(messages.integrationDisabled, 'integracao_desligada');
    }

    const period = this.resolvePeriod(context.text);
    if (period === null) {
      return commandFailure(CommandOutcome.MalformedCommand, this.spec.usage, 'periodo_invalido');
    }

    // Por PESSOA (nao global): quem insiste so se limita a si. So conta consulta valida.
    if (!this.limiter.take(context.user.id).allowed) {
      return unavailable(messages.throttled, 'limite_pessoa');
    }

    try {
      const page = await withDeadline(
        this.service.listEntries({
          tipo: this.spec.tipo,
          status: [0],
          dataInicio: period.from,
          dataFim: period.to,
          perPage: CHAT_PAGE_SIZE,
        }),
        CHAT_DEADLINE_MS,
      );
      // Defesa em profundidade: so parcela PENDENTE (status 0) e no maximo `CHAT_PAGE_SIZE`,
      // mesmo que o Plantae devolva mais ou ignore o filtro.
      const pending = page.items.filter((entry) => entry.status.codigo === PENDING_STATUS);
      const shown = pending.slice(0, CHAT_PAGE_SIZE);
      const ignored = page.items.length - pending.length;
      const hasMore = pending.length > shown.length ? true : page.pagination.hasMore;
      // Nome da contraparte: so onde a especificacao permite E com a politica ligada.
      const showPayee =
        this.spec.counterpartNameAllowed &&
        this.config.get<unknown>(PLANTAE_CHAT_SHOW_PAYEE_KEY) === true;
      return commandOk(
        formatReply(period, shown, hasMore, {
          spec: this.spec,
          showPayee,
          ignored,
          environment: resolvePlantaeSettings(this.config).environment,
        }),
        shown.length === 0 ? 'vazio' : 'ok',
      );
    } catch (error) {
      if (error instanceof PlantaeInputError) {
        return commandFailure(CommandOutcome.MalformedCommand, this.spec.usage, 'periodo_invalido');
      }
      if (error instanceof PlantaeApiError) {
        return unavailable(messageFor(error, messages), detailFor(error));
      }
      if (error instanceof DeadlineError) {
        return unavailable(messages.unavailable, 'prazo_excedido');
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

/** `/contas_pagar`: parcelas PENDENTES de despesa. */
export class AccountsPayableCommandHandler extends PendingEntriesCommandHandler {
  constructor(
    service: PlantaeService,
    config: ConfigReader,
    now?: () => Date,
    limiter?: SlidingWindowLimiter,
  ) {
    super(CONTAS_PAGAR_SPEC, service, config, now, limiter);
  }
}

/** `/contas_receber`: parcelas PENDENTES de receita. Nunca mostra o nome do cliente. */
export class AccountsReceivableCommandHandler extends PendingEntriesCommandHandler {
  constructor(
    service: PlantaeService,
    config: ConfigReader,
    now?: () => Date,
    limiter?: SlidingWindowLimiter,
  ) {
    super(CONTAS_RECEBER_SPEC, service, config, now, limiter);
  }
}

/** Status documentado do Plantae para parcela PENDENTE (1 quitada, 2 substituida). */
const PENDING_STATUS = 0;

/** Falha operacional: o comando nao pode ser atendido agora. */
function unavailable(reply: string, auditDetail: string): CommandResult {
  return commandFailure(CommandOutcome.HandlerError, reply, auditDetail);
}

/** Detalhe de auditoria (vocabulario fechado) para uma falha do Plantae. */
function detailFor(error: PlantaeApiError): string {
  switch (error.kind) {
    case 'disabled':
      return 'integracao_desligada';
    case 'not-configured':
      return 'nao_configurado';
    case 'unauthorized':
    case 'forbidden':
      return 'credencial_recusada';
    case 'rate-limited':
      return 'limite_fornecedor';
    case 'rejected-parameters':
      return 'parametros_rejeitados';
    default:
      return 'erro_fornecedor';
  }
}

function messageFor(error: PlantaeApiError, messages: EntriesCommandMessages): string {
  switch (error.kind) {
    case 'disabled':
      return messages.integrationDisabled;
    case 'not-configured':
      return messages.notConfigured;
    case 'unauthorized':
    case 'forbidden':
      return messages.credentialRefused;
    case 'rate-limited':
      return messages.rateLimited;
    case 'rejected-parameters':
      return messages.rejected;
    default:
      return messages.unavailable;
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

interface ReplyOptions {
  readonly spec: EntriesCommandSpec;
  /** Ja combina a politica com o que a especificacao permite. */
  readonly showPayee: boolean;
  /** Itens devolvidos pelo Plantae que NAO eram pendentes e foram descartados. */
  readonly ignored: number;
  /** Ambiente do host configurado: define o aviso da primeira linha. */
  readonly environment: PlantaeEnvironment | null;
}

function formatReply(
  period: { from: string; to: string },
  items: readonly PlantaeEntry[],
  hasMore: boolean | null,
  options: ReplyOptions,
): string {
  const head = `${bannerFor(options.environment)}\n${options.spec.title}\nVencimento: ${formatDate(period.from)} a ${formatDate(period.to)}`;
  const note =
    options.ignored > 0
      ? [`Obs.: ${String(options.ignored)} item(ns) fora do status pendente foram ignorados.`]
      : [];
  if (items.length === 0) {
    return [head, options.spec.messages.empty, ...note].join('\n');
  }
  const lines = items.map(
    (entry, index) =>
      `${String(index + 1)}) ${formatLine(entry, options.showPayee, options.spec.partialNotice)}`,
  );
  const tail =
    hasMore === true
      ? `Mostrando ${String(items.length)}. Ha mais resultados: use um periodo menor.`
      : hasMore === null
        ? `Mostrando ${String(items.length)}. Nao foi possivel confirmar se ha mais.`
        : `Total listado: ${String(items.length)}.`;
  return [head, ...lines, tail, ...note].join('\n');
}

/** `true` se o decimal-texto e diferente de zero (pagamento realmente feito). */
function isNonZeroDecimal(value: string | null): boolean {
  return value !== null && !/^-?0*(\.0*)?$/.test(value);
}

function formatLine(entry: PlantaeEntry, showPayee: boolean, partialNotice: string): string {
  const due = entry.data_vencto === null ? 'sem vencimento' : formatDate(entry.data_vencto);
  const symbol = cleanText(entry.titulo.moeda?.simbolo ?? '', SYMBOL_MAX);
  const money =
    entry.valor === null
      ? 'valor nao informado'
      : `${symbol === '' ? '' : `${symbol} `}${formatDecimal(entry.valor)}${symbol === '' ? ' (moeda nao informada)' : ''}`;
  const installment =
    entry.numero !== null && entry.total_parcelas !== null
      ? ` (parcela ${String(entry.numero)}/${String(entry.total_parcelas)})`
      : '';
  const reference = ` - ref ${String(entry.parcela_id)}`;
  const who = showPayee
    ? ` - ${cleanText(entry.pessoa?.nome ?? entry.pessoa?.razao_social ?? '', NAME_MAX) || 'sem nome'}`
    : '';
  // Nao se calcula saldo (semantica de `saldo_atual` nao documentada): so se avisa.
  const partial = isNonZeroDecimal(entry.total_pago) ? ` - ${partialNotice}` : '';
  return `${due} - ${money}${installment}${reference}${who}${partial}`;
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
