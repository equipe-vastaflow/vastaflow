import { Injectable } from '@nestjs/common';
import type { CommandHandler } from './command.types';

/**
 * Registro dos comandos do motor: unica fonte de verdade sobre quais comandos
 * existem.
 *
 * Nao recebe os handlers por injecao, e sim pelo `register` chamado uma vez
 * pelo `CommandsModule` no boot. Esse arranjo existe por um motivo concreto:
 * `/ajuda` precisa listar os comandos, ou seja, um handler depende do catalogo.
 * Se o catalogo tambem dependesse dos handlers, haveria dependencia circular
 * no container do Nest. Com o registro feito pelo modulo, o grafo fica
 * `modulo -> handlers -> catalogo`, sem ciclo.
 *
 * O `register` roda no `onModuleInit`, antes de qualquer requisicao ser
 * atendida, entao quem consulta o catalogo em tempo de execucao sempre o
 * encontra preenchido.
 */
@Injectable()
export class CommandCatalog {
  private readonly handlers = new Map<string, CommandHandler>();

  /**
   * @throws Error se dois handlers declararem o mesmo nome - erro de
   * programacao que derruba o boot, em vez de deixar um comando sombrear o
   * outro silenciosamente.
   */
  register(handlers: readonly CommandHandler[]): void {
    for (const handler of handlers) {
      if (this.handlers.has(handler.name)) {
        throw new Error(`Comando duplicado no motor: '${handler.name}'`);
      }
      this.handlers.set(handler.name, handler);
    }
  }

  /** `undefined` quando nenhum handler atende por esse nome. */
  find(name: string): CommandHandler | undefined {
    return this.handlers.get(name);
  }

  /** Todos os comandos registrados, ordenados por nome. */
  all(): readonly CommandHandler[] {
    return [...this.handlers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
