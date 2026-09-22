import { Injectable } from '@nestjs/common';
import { hasPermission } from '../../auth/has-permission';
import { CommandCatalog } from '../command-catalog';
import {
  commandOk,
  type CommandContext,
  type CommandHandler,
  type CommandResult,
} from '../command.types';

/**
 * `/ajuda` - lista os comandos que o solicitante pode executar.
 *
 * A lista sai do proprio catalogo do motor, entao um comando novo aparece aqui
 * assim que e registrado, sem ninguem precisar lembrar de atualizar um texto.
 *
 * Comandos que o usuario nao tem permissao para executar sao omitidos: a ajuda
 * nao revela a existencia de funcionalidades fora do alcance dele.
 */
@Injectable()
export class HelpCommandHandler implements CommandHandler {
  readonly name = 'ajuda';
  readonly description = 'Lista os comandos disponiveis';

  constructor(private readonly catalog: CommandCatalog) {}

  handle(context: CommandContext): CommandResult {
    const disponiveis = this.catalog
      .all()
      .filter(
        (handler) =>
          handler.permission === undefined || hasPermission(context.user, handler.permission),
      );

    if (disponiveis.length === 0) {
      return commandOk('Nenhum comando disponivel para o seu perfil.');
    }

    const linhas = disponiveis.map((handler) => `/${handler.name} - ${handler.description}`);
    return commandOk(['Comandos disponiveis:', ...linhas].join('\n'));
  }
}
