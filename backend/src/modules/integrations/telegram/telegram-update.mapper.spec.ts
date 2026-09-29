import { readUpdateId, TELEGRAM_CHANNEL, toIncomingMessage } from './telegram-update.mapper';

/** Update no formato da Bot API, com campos que NAO devem passar adiante. */
function update(
  message: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): unknown {
  return {
    update_id: 10,
    message: {
      message_id: 5,
      date: 1_790_000_000,
      chat: { id: 4242, type: 'private', first_name: 'Ana', username: 'ana_teste' },
      from: {
        id: 4242,
        is_bot: false,
        first_name: 'Ana',
        username: 'ana_teste',
        language_code: 'pt-br',
      },
      text: '/ajuda',
      ...message,
    },
    ...extra,
  };
}

describe('toIncomingMessage', () => {
  it('reduz a mensagem privada de texto a estrutura neutra', () => {
    expect(toIncomingMessage(update())).toEqual({
      channel: TELEGRAM_CHANNEL,
      conversationId: '4242',
      sender: { channel: TELEGRAM_CHANNEL, externalId: '4242' },
      text: '/ajuda',
      receivedAt: new Date(1_790_000_000 * 1000),
    });
  });

  it('nao carrega nenhum outro campo do payload', () => {
    const mensagem = toIncomingMessage(
      update({ contact: { phone_number: '+5511999999999' }, entities: [] }, { extra: 1 }),
    );

    expect(Object.keys(mensagem ?? {}).sort()).toEqual(
      ['channel', 'conversationId', 'receivedAt', 'sender', 'text'].sort(),
    );
    const serializada = JSON.stringify(mensagem);
    for (const dado of ['ana_teste', 'Ana', 'pt-br', '+5511999999999', 'message_id']) {
      expect(serializada).not.toContain(dado);
    }
  });

  it('a identidade e a do remetente, nunca um campo do texto ou do payload', () => {
    const mensagem = toIncomingMessage(
      update(
        { text: '/ajuda {"userId":"admin-interno"}', userId: 'admin-interno' },
        {
          userId: 'admin-interno',
        },
      ),
    );

    expect(mensagem?.sender).toEqual({ channel: TELEGRAM_CHANNEL, externalId: '4242' });
    expect(JSON.stringify(mensagem?.sender)).not.toContain('admin-interno');
  });

  it.each([
    ['nao e objeto', null],
    ['sem message', { update_id: 1 }],
    ['mensagem editada', { update_id: 1, edited_message: { text: '/ajuda' } }],
    ['sem texto (foto)', update({ text: undefined, photo: [] })],
    ['texto nao textual', update({ text: 123 })],
    ['grupo', update({ chat: { id: -100, type: 'group' } })],
    ['supergrupo', update({ chat: { id: -100, type: 'supergroup' } })],
    ['canal', update({ chat: { id: -100, type: 'channel' } })],
    ['remetente bot', update({ from: { id: 7, is_bot: true } })],
    ['sem remetente', update({ from: undefined })],
    ['id do chat invalido', update({ chat: { id: '4242', type: 'private' } })],
    ['id do remetente invalido', update({ from: { id: 1.5, is_bot: false } })],
    ['sem data', update({ date: undefined })],
  ])('ignora: %s', (_caso, cru) => {
    expect(toIncomingMessage(cru)).toBeNull();
  });

  /**
   * Regra arquitetural temporaria (nao decisao de produto): so conversa 1:1,
   * ate haver identidade e autorizacao para grupos. Ver o mapper.
   */
  describe('regra 1:1: quem recebe a resposta e quem pediu', () => {
    it.each([
      ['grupo', 'group'],
      ['supergrupo', 'supergroup'],
    ])('comando de pessoa real em %s: fora do fluxo', (_caso, type) => {
      expect(
        toIncomingMessage(update({ chat: { id: -1001234, type }, text: '/ajuda@VastaFlowBot' })),
      ).toBeNull();
      expect(
        toIncomingMessage(update({ chat: { id: -1001234, type }, text: '/ajuda' })),
      ).toBeNull();
    });

    it('chat "privado" cujo id nao e o do remetente: fora do fluxo', () => {
      expect(toIncomingMessage(update({ chat: { id: 9999, type: 'private' } }))).toBeNull();
    });

    it('conversa privada com o proprio remetente: aceita', () => {
      expect(toIncomingMessage(update())?.conversationId).toBe('4242');
    });
  });
});

describe('readUpdateId', () => {
  it('le o update_id', () => {
    expect(readUpdateId(update())).toBe(10);
  });

  it.each([
    ['ausente', { message: {} }],
    ['texto', { update_id: '10' }],
    ['fracionario', { update_id: 1.5 }],
    ['nao objeto', 'x'],
  ])('invalido (%s): null', (_caso, cru) => {
    expect(readUpdateId(cru)).toBeNull();
  });
});
