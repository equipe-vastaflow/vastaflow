import { toTelegramEnvelope } from './telegram-update.mapper';

const BOT = '123456789';
const AGORA = 1_790_000_000_000;

function update(
  over: Record<string, unknown> = {},
  messageOver: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    update_id: 9001,
    message: {
      message_id: 77,
      date: 1_790_000_000,
      chat: { id: 555, type: 'private', first_name: 'Nome Ficticio', username: 'usuario_ficticio' },
      from: {
        id: 555,
        is_bot: false,
        first_name: 'Nome Ficticio',
        username: 'usuario_ficticio',
        language_code: 'pt-br',
      },
      text: '/ajuda',
      ...messageOver,
    },
    ...over,
  };
}

describe('toTelegramEnvelope', () => {
  it('mensagem de texto em chat privado vira envelope com os ids estaveis', () => {
    expect(toTelegramEnvelope(update(), BOT, AGORA)).toEqual({
      version: 'v1',
      platform: 'telegram',
      botId: BOT,
      updateId: 9001,
      messageId: 77,
      chatId: '555',
      userId: '555',
      chatType: 'private',
      text: '/ajuda',
      sentAt: 1_790_000_000,
      issuedAt: AGORA,
    });
  });

  it('nome, username, idioma e o resto do payload NAO chegam ao envelope (nem ao n8n)', () => {
    const texto = JSON.stringify(toTelegramEnvelope(update(), BOT, AGORA));

    expect(texto).not.toContain('Nome Ficticio');
    expect(texto).not.toContain('usuario_ficticio');
    expect(texto).not.toContain('pt-br');
    expect(texto).not.toContain('first_name');
  });

  it.each([
    ['grupo', { chat: { id: -100, type: 'group' } }],
    ['supergrupo', { chat: { id: -100, type: 'supergroup' } }],
    ['canal', { chat: { id: -100, type: 'channel' } }],
    ['chat diferente do remetente', { chat: { id: 1, type: 'private' } }],
    ['remetente bot', { from: { id: 555, is_bot: true } }],
    ['sem remetente', { from: undefined }],
    ['sem texto (foto)', { text: undefined }],
    ['texto que nao e string', { text: 42 }],
    ['sem data', { date: undefined }],
    ['mensagem encaminhada', { forward_origin: { type: 'user', date: 1 } }],
    ['mensagem via outro bot', { via_bot: { id: 8, is_bot: true } }],
  ])('ignora: %s', (_nome, over) => {
    expect(toTelegramEnvelope(update({}, over), BOT, AGORA)).toBeNull();
  });

  it.each([
    ['sem message_id', { message_id: undefined }],
    ['message_id negativo', { message_id: -1 }],
    ['message_id nao inteiro', { message_id: 1.5 }],
    ['texto vazio', { text: '' }],
    ['texto acima do limite da Bot API', { text: 'x'.repeat(4097) }],
  ])('descarta: %s', (_nome, over) => {
    expect(toTelegramEnvelope(update({}, over), BOT, AGORA)).toBeNull();
  });

  it.each([
    ['sem update_id', { update_id: undefined }],
    ['update_id negativo', { update_id: -5 }],
    ['update_id decimal', { update_id: 1.5 }],
    ['update_id em texto', { update_id: '9001' }],
  ])('descarta: %s', (_nome, over) => {
    expect(toTelegramEnvelope(update(over), BOT, AGORA)).toBeNull();
  });

  it('mensagem EDITADA e outros tipos de update ficam de fora', () => {
    const editada = { update_id: 1, edited_message: update().message };
    const callback = { update_id: 2, callback_query: { id: 'x' } };

    expect(toTelegramEnvelope(editada, BOT, AGORA)).toBeNull();
    expect(toTelegramEnvelope(callback, BOT, AGORA)).toBeNull();
  });

  it.each([null, undefined, 'texto', 42, [], {}])('entrada que nao e update (%p)', (entrada) => {
    expect(toTelegramEnvelope(entrada, BOT, AGORA)).toBeNull();
  });

  it('texto de exatamente 4096 caracteres e aceito', () => {
    expect(
      toTelegramEnvelope(update({}, { text: 'x'.repeat(4096) }), BOT, AGORA)?.text,
    ).toHaveLength(4096);
  });
});
