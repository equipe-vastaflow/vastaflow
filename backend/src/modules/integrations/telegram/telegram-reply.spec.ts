import { ROUTER_MESSAGES } from '../../commands/command-router.service';
import { commandFailure, commandOk, CommandOutcome } from '../../commands/command.types';
import { TELEGRAM_MESSAGE_LIMIT, TELEGRAM_UNLINKED_REPLY, toTelegramText } from './telegram-reply';

describe('toTelegramText', () => {
  it.each([
    ['sucesso', commandOk('Comandos disponiveis:\n/ajuda')],
    [
      'comando desconhecido',
      commandFailure(CommandOutcome.UnknownCommand, ROUTER_MESSAGES.unknown('x')),
    ],
    [
      'sem permissao',
      commandFailure(CommandOutcome.PermissionDenied, ROUTER_MESSAGES.permissionDenied),
    ],
    ['nao e comando', commandFailure(CommandOutcome.NotACommand, ROUTER_MESSAGES.notACommand)],
    ['falha do handler', commandFailure(CommandOutcome.HandlerError, ROUTER_MESSAGES.handlerError)],
  ])('%s: usa o texto do Command Engine, sem reescrever', (_caso, result) => {
    expect(toTelegramText(result)).toBe(result.reply);
  });

  it('respeita o limite de tamanho da mensagem do Telegram', () => {
    const texto = toTelegramText(commandOk('x'.repeat(TELEGRAM_MESSAGE_LIMIT + 500)));

    expect(texto).toHaveLength(TELEGRAM_MESSAGE_LIMIT);
    expect(texto.endsWith('[...]')).toBe(true);
  });

  it('texto no limite exato passa inteiro', () => {
    const reply = 'y'.repeat(TELEGRAM_MESSAGE_LIMIT);

    expect(toTelegramText(commandOk(reply))).toBe(reply);
  });
});

describe('TELEGRAM_UNLINKED_REPLY', () => {
  it('nao revela comandos nem detalhes do sistema', () => {
    for (const revelacao of ['/ajuda', '/status', 'ADMIN', 'GESTOR', 'OPERADOR']) {
      expect(TELEGRAM_UNLINKED_REPLY).not.toContain(revelacao);
    }
  });
});
