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

  /**
   * Fase 5: mensagem encaminhada nao e digitada por quem a enviou ao bot - nunca vira
   * comando (nem `/vincular`), em nenhum modo de entrega.
   */
  describe('mensagem encaminhada ou enviada via outro bot: nunca vira comando', () => {
    it.each([
      ['forward_origin (formato atual)', { forward_origin: { type: 'user', date: 1 } }],
      ['forward_from (legado)', { forward_from: { id: 7, is_bot: false } }],
      ['forward_from_chat', { forward_from_chat: { id: -100, type: 'channel' } }],
      ['forward_from_message_id', { forward_from_message_id: 3 }],
      ['forward_signature', { forward_signature: 'x' }],
      ['forward_sender_name', { forward_sender_name: 'Oculto' }],
      ['forward_date', { forward_date: 1_790_000_000 }],
      ['encaminhamento automatico', { is_automatic_forward: true }],
      ['via outro bot', { via_bot: { id: 8, is_bot: true } }],
    ])('%s: fora do fluxo, mesmo que o texto seja um comando valido', (_caso, marcador) => {
      expect(toIncomingMessage(update({ text: '/contas_pagar', ...marcador }))).toBeNull();
      expect(
        toIncomingMessage(update({ text: '/vincular ABCD-EFGH-IJKL', ...marcador })),
      ).toBeNull();
    });

    it('controle positivo: a mesma mensagem, sem o marcador, e aceita', () => {
      expect(toIncomingMessage(update({ text: '/contas_pagar' }))?.text).toBe('/contas_pagar');
    });

    it('mensagem que RESPONDE a outra (reply) nao e encaminhada: segue aceita', () => {
      expect(
        toIncomingMessage(update({ text: '/ajuda', reply_to_message: { message_id: 1 } }))?.text,
      ).toBe('/ajuda');
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
