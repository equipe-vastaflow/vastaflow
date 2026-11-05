import { Logger } from '@nestjs/common';
import { WhatsappApiError } from './whatsapp-api.client';
import { sendMetaReply } from './whatsapp-meta-reply';

/** Entrega da resposta pelo transporte antigo (Meta): so repassa ao remetente e nunca lanca. */
describe('sendMetaReply', () => {
  const sendText = jest.fn<Promise<void>, [string, string]>();
  const sender = { sendText };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    sendText.mockReset();
    sendText.mockResolvedValue(undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const linhas = (): string[] => warn.mock.calls.map(([texto]) => String(texto));

  it('envia o texto ao numero informado', async () => {
    await sendMetaReply(sender, '5511999990000', 'Comandos disponiveis');

    expect(sendText).toHaveBeenCalledWith('5511999990000', 'Comandos disponiveis');
  });

  it('sem resposta (null): nada e enviado', async () => {
    await sendMetaReply(sender, '5511999990000', null);

    expect(sendText).not.toHaveBeenCalled();
  });

  it('envio falha: segue sem lancar (log so com a categoria)', async () => {
    sendText.mockRejectedValue(new WhatsappApiError('http', 500));

    await expect(sendMetaReply(sender, '5511999990000', 'x')).resolves.toBeUndefined();
    expect(linhas()).toContain('WhatsApp: resposta nao enviada (http, status 500)');
  });

  it('envio falha: o log traz so categoria, status e codigo numerico da Graph API', async () => {
    sendText.mockRejectedValue(
      Object.assign(new WhatsappApiError('http', 401, 190), { message: 'SEGREDO-EAAG' }),
    );

    await sendMetaReply(sender, '5511999990000', '/ajuda CODIGO-SECRETO');

    expect(linhas()).toContain('WhatsApp: resposta nao enviada (http, status 401, codigo 190)');
    expect(linhas().join(' ')).not.toMatch(/SEGREDO|EAAG|5511999990000|CODIGO-SECRETO|\/ajuda/);
  });

  it('envio falha: o log inclui subcodigo e tipo, sem dados pessoais', async () => {
    sendText.mockRejectedValue(
      Object.assign(new WhatsappApiError('http', 400, 10, 2018, 'OAuthException'), {
        message: 'SEGREDO-EAAG',
      }),
    );

    await sendMetaReply(sender, '5511999990000', '/ajuda CODIGO-SECRETO');

    expect(linhas()).toContain(
      'WhatsApp: resposta nao enviada (http, status 400, codigo 10, subcodigo 2018, tipo OAuthException)',
    );
    expect(linhas().join(' ')).not.toMatch(/SEGREDO|EAAG|5511999990000|CODIGO-SECRETO|\/ajuda/);
  });

  it('erro que nao e da Graph API: motivo generico', async () => {
    sendText.mockRejectedValue(new Error('SEGREDO'));

    await sendMetaReply(sender, '5511999990000', 'x');

    expect(linhas()).toEqual(['WhatsApp: resposta nao enviada (desconhecido)']);
  });
});
