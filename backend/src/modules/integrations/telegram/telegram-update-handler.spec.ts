import { selectUpdateHandler, type TelegramUpdateHandler } from './telegram-update-handler';

const direto: TelegramUpdateHandler = { handleUpdate: () => Promise.resolve('direto') };
const relay: TelegramUpdateHandler = { handleUpdate: () => Promise.resolve('relay') };

describe('selectUpdateHandler', () => {
  it("so o modo exato 'n8n' liga o relay", () => {
    expect(selectUpdateHandler('n8n', direto, relay)).toBe(relay);
  });

  it.each(['direct', '', undefined, null, 'N8N', ' n8n', 'n8n ', 'webhook', 1, true])(
    'qualquer outro valor (%p) fica no modo direto, o padrao',
    (modo) => {
      expect(selectUpdateHandler(modo, direto, relay)).toBe(direto);
    },
  );
});
