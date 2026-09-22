import { Injectable } from '@nestjs/common';
import { CommandCatalog } from '../command-catalog';
import {
  commandOk,
  type CommandContext,
  type CommandHandler,
  type CommandResult,
} from '../command.types';

/**
 * `/status` - confirma que o motor esta operacional.
 *
 * Comando tecnico de diagnostico. Responde apenas com o que e seguro trafegar
 * por um canal de mensageria: nada de variaveis de ambiente, segredos, tokens,
 * credenciais, host de banco ou versao de dependencia. Se um dia este comando
 * precisar reportar o estado de componentes (banco, integracoes), o lugar e o
 * `HealthService`, que ja agrega indicadores - nao uma consulta nova aqui.
 */
@Injectable()
export class StatusCommandHandler implements CommandHandler {
  readonly name = 'status';
  readonly description = 'Mostra o estado do motor de comandos';

  constructor(private readonly catalog: CommandCatalog) {}

  handle(context: CommandContext): CommandResult {
    return commandOk(
      [
        'Motor de comandos operacional.',
        `Comandos registrados: ${this.catalog.all().length}`,
        `Canal: ${context.channel}`,
        `Tempo de atividade: ${formatUptime(process.uptime())}`,
      ].join('\n'),
    );
  }
}

/** Segundos desde o boot em `HHh MMm SSs`. */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  return `${horas}h ${minutos}m ${total % 60}s`;
}
