import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { hasPermission } from '../auth/has-permission';
import { CommandCatalog } from './command-catalog';
import { parseCommand } from './command-parser';
import {
  commandFailure,
  CommandChannel,
  CommandOutcome,
  type CommandAuditConfig,
  type CommandContext,
  type CommandHandler,
  type CommandResult,
} from './command.types';

/** Mensagens devolvidas ao usuario. Nenhuma delas expoe detalhe interno. */
export const ROUTER_MESSAGES = {
  empty: 'Mensagem vazia. Envie /ajuda para ver os comandos disponiveis.',
  notACommand: 'Nao entendi. Comandos comecam com "/". Envie /ajuda para ver a lista.',
  malformed: 'Comando invalido. Use o formato /comando. Envie /ajuda para ver a lista.',
  unknown: (name: string): string =>
    `Comando /${name} nao existe. Envie /ajuda para ver os comandos disponiveis.`,
  permissionDenied: 'Voce nao tem permissao para executar este comando.',
  handlerError: 'Nao foi possivel executar o comando agora. Tente novamente mais tarde.',
} as const;

/**
 * Motor de comandos: recebe um contexto ja normalizado pelo adaptador do
 * canal, descobre qual comando foi pedido, valida a permissao e executa o
 * handler.
 *
 * Nao interpreta texto (isso e do parser) e nao implementa comando nenhum
 * (isso e dos handlers). Tambem nao conhece Telegram, WhatsApp nem HTTP.
 *
 * Nunca lanca excecao: toda situacao - inclusive um handler que quebra - vira
 * um `CommandResult`, porque do outro lado ha um adaptador de mensageria que
 * precisa sempre ter o que responder.
 */
@Injectable()
export class CommandRouter {
  private readonly logger = new Logger(CommandRouter.name);

  constructor(
    private readonly catalog: CommandCatalog,
    private readonly auditService: AuditService,
  ) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const parsed = parseCommand(context.text);

    switch (parsed.kind) {
      case 'empty':
        return commandFailure(CommandOutcome.EmptyMessage, ROUTER_MESSAGES.empty);
      case 'not-a-command':
        return commandFailure(CommandOutcome.NotACommand, ROUTER_MESSAGES.notACommand);
      case 'malformed':
        return commandFailure(CommandOutcome.MalformedCommand, ROUTER_MESSAGES.malformed);
      case 'command':
        break;
    }

    const handler = this.catalog.find(parsed.command.name);
    if (!handler) {
      return commandFailure(
        CommandOutcome.UnknownCommand,
        ROUTER_MESSAGES.unknown(parsed.command.name),
      );
    }

    // Mesma regra do `PermissionsGuard`: ADMIN passa sempre, os demais
    // precisam da permissao no perfil. Comando sem `permission` declarada so
    // exige a identidade que o adaptador ja resolveu.
    if (handler.permission !== undefined && !hasPermission(context.user, handler.permission)) {
      return commandFailure(CommandOutcome.PermissionDenied, ROUTER_MESSAGES.permissionDenied);
    }

    let result: CommandResult;
    try {
      result = await handler.handle(context);
    } catch (error) {
      // O detalhe fica no log do servidor; o usuario recebe texto generico.
      this.logger.error(
        `Falha ao executar /${handler.name} (canal ${context.channel})`,
        error instanceof Error ? error.stack : String(error),
      );
      result = commandFailure(CommandOutcome.HandlerError, ROUTER_MESSAGES.handlerError);
    }

    // Auditoria e opt-in: so grava quem declarou (ver `CommandHandler.audit`).
    if (handler.audit) {
      await this.recordAudit(handler, handler.audit, context, result);
    }

    return result;
  }

  /**
   * Grava a execucao na trilha existente. Usa o `AuditService` - nao ha um
   * segundo mecanismo de auditoria nem sanitizacao propria aqui.
   *
   * O que vai para a trilha e uma lista fechada de campos tecnicos. O texto
   * cru da mensagem e os argumentos ficam de fora DE PROPOSITO: a mensagem e
   * digitada livremente pelo usuario e pode conter senha, token ou documento,
   * e a higienizacao do `AuditService` remove por nome de chave - ela nao teria
   * como saber que o valor dentro de `args` e sensivel. A resposta do comando
   * tambem nao entra: ela pode conter os dados de negocio que o comando leu.
   *
   * Uma falha ao gravar nao derruba o comando. O `AuditService` ja captura e
   * registra os proprios erros - o `catch` daqui nao repete esse tratamento
   * nem loga de novo, apenas preserva a promessa de que `execute` nunca lanca,
   * que todo adaptador de canal vai depender.
   */
  private async recordAudit(
    handler: CommandHandler,
    audit: CommandAuditConfig,
    context: CommandContext,
    result: CommandResult,
  ): Promise<void> {
    try {
      await this.auditService.record({
        usuarioId: context.user.id,
        acao: audit.acao,
        modulo: audit.modulo,
        descricao: `Comando /${handler.name} ${result.success ? 'executado' : 'falhou'}`,
        metadados: {
          comando: handler.name,
          canal: context.channel,
          // Rotulo livre do endpoint de teste. Em canal de mensageria o `conversationId`
          // E o id da conta da pessoa (ex.: chat do Telegram): identificador pessoal que a
          // auditoria nao precisa guardar - o `usuarioId` ja diz quem foi.
          ...(context.channel === CommandChannel.Test
            ? { conversationId: context.conversationId }
            : {}),
          outcome: result.outcome,
        },
      });
    } catch {
      // Ja tratado e logado pelo AuditService.
    }
  }
}
