import type { AuditAction, AuditModuleName } from '../audit/audit-action.enum';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { PermissionCode } from '../permissions/permission-code.enum';

/**
 * Origem da mensagem.
 *
 * E apenas um rotulo: o motor nao muda de comportamento por causa dele, e
 * nenhum tipo especifico de canal (mensagem do Telegram, do WhatsApp...) entra
 * aqui. Canais futuros acrescentam um valor a este enum e um adaptador proprio
 * que traduz a mensagem recebida para um `CommandContext`.
 */
export enum CommandChannel {
  /** Endpoint interno de teste (`POST /commands/execute`). */
  Test = 'test',
  /** Adaptador do Telegram (`modules/integrations/telegram`). */
  Telegram = 'telegram',
  /** Adaptador do WhatsApp (`modules/integrations/whatsapp`), Cloud API oficial da Meta. */
  Whatsapp = 'whatsapp',
}

/**
 * Mensagem ja normalizada, pronta para o motor.
 *
 * O adaptador do canal e responsavel por montar este objeto - inclusive por
 * resolver a identidade externa (chat do Telegram, numero do WhatsApp) para um
 * usuario interno. O motor nunca vai ao banco procurar quem enviou a mensagem
 * e nao tem um cadastro proprio de usuarios.
 */
export interface CommandContext {
  /**
   * Quem enviou a mensagem, ja resolvido pelo adaptador. E o mesmo objeto que
   * o `JwtAuthGuard` anexa a requisicao HTTP, entao o perfil e as permissoes
   * vem junto e a autorizacao usa exatamente a mesma regra do RBAC existente
   * (`hasPermission`). O identificador do usuario e `user.id`.
   */
  readonly user: AuthenticatedUser;

  /** Conversa/thread de origem, para o adaptador saber onde responder. */
  readonly conversationId: string;

  readonly channel: CommandChannel;

  /** Texto cru recebido, antes de qualquer interpretacao. */
  readonly text: string;
}

/**
 * Desfecho da execucao, em formato estavel para o adaptador decidir o que
 * fazer sem interpretar a mensagem de texto.
 *
 * A distincao importa na pratica: um bot em grupo deve ignorar em silencio uma
 * mensagem `NotACommand`, mas responder a um `UnknownCommand`.
 */
export enum CommandOutcome {
  Ok = 'OK',
  /** Mensagem vazia ou so com espacos. */
  EmptyMessage = 'EMPTY_MESSAGE',
  /** Texto comum, nao comeca com `/`. */
  NotACommand = 'NOT_A_COMMAND',
  /** Comeca com `/`, mas o nome do comando e invalido. */
  MalformedCommand = 'MALFORMED_COMMAND',
  /** Nome valido, mas nenhum handler registrado atende por ele. */
  UnknownCommand = 'UNKNOWN_COMMAND',
  /** O comando existe, mas o usuario nao tem a permissao exigida. */
  PermissionDenied = 'PERMISSION_DENIED',
  /** O handler lancou excecao. O detalhe fica no log do servidor. */
  HandlerError = 'HANDLER_ERROR',
}

/** Resultado padronizado de uma execucao. */
export interface CommandResult {
  readonly success: boolean;
  readonly outcome: CommandOutcome;
  /** Texto a ser devolvido ao usuario. Nunca contem stack trace. */
  readonly reply: string;
  /**
   * Detalhe do desfecho para a AUDITORIA, em vocabulario fechado (`[a-z_]`, ate 40
   * caracteres): distingue, por exemplo, "consulta vazia" de "erro do fornecedor" quando o
   * `outcome` e o mesmo. Nunca conteudo, valor, nome ou dado de negocio. O router descarta
   * qualquer valor fora do formato.
   */
  readonly auditDetail?: string;
}

/**
 * Declara que as execucoes de um comando entram na trilha de auditoria.
 *
 * A acao e o modulo saem dos enums que a auditoria ja usa - o comando nao
 * inventa vocabulario proprio. Um comando de negocio futuro (`/financeiro`,
 * `/nfe`) declara aqui a acao e o modulo do proprio dominio, criados junto com
 * o modulo correspondente.
 */
export interface CommandAuditConfig {
  readonly acao: AuditAction;
  readonly modulo: AuditModuleName;
}

/**
 * Um comando do motor.
 *
 * Toda a logica de negocio mora aqui: o parser so interpreta texto e o router
 * so localiza e executa. Handlers nao acessam o banco diretamente - dependem
 * dos services dos modulos correspondentes, como qualquer controller.
 */
export interface CommandHandler {
  /** Nome sem a barra, em minusculas. Ex.: `ajuda`. */
  readonly name: string;

  /** Uma linha, exibida por `/ajuda`. */
  readonly description: string;

  /**
   * Permissao exigida para executar. Ausente = basta ser um usuario
   * identificado pelo adaptador.
   *
   * A verificacao e feita pelo router com `hasPermission`, a mesma funcao que
   * o `PermissionsGuard` usa - o RBAC nao e duplicado, e nenhum comando
   * precisa de uma permissao propria no banco.
   */
  readonly permission?: PermissionCode;

  /**
   * Auditoria e opt-in: ausente = a execucao NAO entra na trilha.
   *
   * Comandos tecnicos (`/ajuda`, `/status`) ficam de fora de proposito - eles
   * nao alteram nada e inundariam a trilha, competindo com os eventos de
   * seguranca que realmente importam. Comandos que tocam o negocio declaram
   * este campo e o router grava o evento pelo `AuditService` existente.
   */
  readonly audit?: CommandAuditConfig;

  handle(context: CommandContext): Promise<CommandResult> | CommandResult;
}

export function commandOk(reply: string, auditDetail?: string): CommandResult {
  return {
    success: true,
    outcome: CommandOutcome.Ok,
    reply,
    ...(auditDetail === undefined ? {} : { auditDetail }),
  };
}

export function commandFailure(
  outcome: CommandOutcome,
  reply: string,
  auditDetail?: string,
): CommandResult {
  return {
    success: false,
    outcome,
    reply,
    ...(auditDetail === undefined ? {} : { auditDetail }),
  };
}
