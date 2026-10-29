import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { WhatsappApiClient, WhatsappApiError } from './whatsapp-api.client';
import { parseWhatsappPayload } from './whatsapp-payload';
import { resolveGraphBase, validateWhatsappSettings } from './whatsapp-settings';
import { verifyChallenge, verifyMetaSignature } from './whatsapp-signature';

const SECRET = 'app-secret-de-teste-0123456789abcdef';
const assinar = (corpo: Buffer, segredo = SECRET): string =>
  `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;

describe('verifyMetaSignature', () => {
  const corpo = Buffer.from('{"object":"whatsapp_business_account"}');

  it('assinatura correta sobre o corpo bruto', () => {
    expect(verifyMetaSignature(corpo, assinar(corpo), SECRET)).toBe(true);
  });

  it('corpo alterado em 1 byte, outro segredo ou sem prefixo: recusada', () => {
    expect(verifyMetaSignature(Buffer.from('{"object":"x"}'), assinar(corpo), SECRET)).toBe(false);
    expect(verifyMetaSignature(corpo, assinar(corpo, 'outro-segredo-qualquer-123'), SECRET)).toBe(
      false,
    );
    expect(verifyMetaSignature(corpo, assinar(corpo).replace('sha256=', ''), SECRET)).toBe(false);
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['sha1 (outro algoritmo)', `sha1=${'a'.repeat(40)}`],
    ['maiuscula', assinar(Buffer.from('x')).toUpperCase()],
    ['curta', 'sha256=abcd'],
  ])('cabecalho %s: recusado sem lancar', (_nome, header) => {
    expect(verifyMetaSignature(corpo, header, SECRET)).toBe(false);
  });

  it('assinatura valida SEGUIDA DE LIXO: recusada (hex estrito)', () => {
    expect(verifyMetaSignature(corpo, `${assinar(corpo)}zz`, SECRET)).toBe(false);
    expect(verifyMetaSignature(corpo, `${assinar(corpo)}00`, SECRET)).toBe(false);
  });

  it('sem corpo bruto ou sem segredo configurado: recusada (fail-closed)', () => {
    expect(verifyMetaSignature(undefined, assinar(corpo), SECRET)).toBe(false);
    expect(verifyMetaSignature(corpo, assinar(corpo, ''), '')).toBe(false);
  });
});

describe('verifyChallenge', () => {
  const ok = {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'token-de-verificacao-123',
    'hub.challenge': '1158201444',
  };

  it('devolve o desafio com o token certo', () => {
    expect(verifyChallenge(ok, 'token-de-verificacao-123')).toBe('1158201444');
  });

  it.each([
    ['token errado', { ...ok, 'hub.verify_token': 'errado-errado-errado' }],
    ['modo errado', { ...ok, 'hub.mode': 'unsubscribe' }],
    ['sem token', { 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
    ['desafio com HTML (nada refletido)', { ...ok, 'hub.challenge': '<script>alert(1)</script>' }],
    ['desafio vazio', { ...ok, 'hub.challenge': '' }],
    ['token como lista', { ...ok, 'hub.verify_token': ['token-de-verificacao-123'] }],
  ])('%s: recusado', (_nome, query) => {
    expect(verifyChallenge(query, 'token-de-verificacao-123')).toBeNull();
  });

  it('sem token configurado nunca verifica', () => {
    expect(verifyChallenge({ ...ok, 'hub.verify_token': '' }, '')).toBeNull();
  });
});

function payload(mensagens: unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: { metadata: { phone_number_id: '1234567890' }, messages: mensagens, ...extra },
          },
        ],
      },
    ],
  };
}
const texto = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'wamid.HBgLABC123=',
  from: '5511999990000',
  timestamp: '1790000000',
  type: 'text',
  text: { body: '/ajuda' },
  ...over,
});

describe('parseWhatsappPayload', () => {
  it('texto individual vira a mensagem minima (sem nome de perfil nem contatos)', () => {
    const r = parseWhatsappPayload(
      payload([texto()], { contacts: [{ profile: { name: 'Nome Ficticio' } }] }),
    );

    expect(r.messages).toEqual([
      {
        phoneNumberId: '1234567890',
        messageId: 'wamid.HBgLABC123=',
        from: '5511999990000',
        text: '/ajuda',
        timestamp: 1790000000,
      },
    ]);
    expect(JSON.stringify(r)).not.toContain('Nome Ficticio');
  });

  it.each([
    ['imagem', { type: 'image', image: { id: 'x' } }],
    ['documento', { type: 'document', document: { id: 'x' } }],
    ['audio', { type: 'audio' }],
    ['botao', { type: 'button' }],
    ['encaminhada', { context: { forwarded: true } }],
    ['muito encaminhada', { context: { frequently_forwarded: true } }],
    ['sem texto', { text: {} }],
    ['texto vazio', { text: { body: '' } }],
    ['texto enorme', { text: { body: 'x'.repeat(4097) } }],
    ['remetente nao numerico', { from: 'abc' }],
    ['id malformado', { id: 'wamid com espaco' }],
    ['timestamp invalido', { timestamp: 'ontem' }],
  ])('%s: ignorada e contada', (_nome, over) => {
    const r = parseWhatsappPayload(payload([texto(over)]));

    expect(r.messages).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it('respondida (reply) NAO e encaminhada: segue aceita', () => {
    expect(
      parseWhatsappPayload(payload([texto({ context: { id: 'wamid.X' } })])).messages,
    ).toHaveLength(1);
  });

  it('eventos de status de entrega nao sao mensagens', () => {
    const r = parseWhatsappPayload(payload([], { statuses: [{ id: 'x', status: 'delivered' }] }));

    expect(r.messages).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it.each([
    null,
    undefined,
    'x',
    42,
    [],
    {},
    { object: 'page', entry: [] },
    { object: 'whatsapp_business_account' },
  ])('payload fora do formato (%p): nada e processado, nao lanca', (entrada) => {
    expect(parseWhatsappPayload(entrada).messages).toEqual([]);
  });

  it('varias mensagens e varias entradas', () => {
    const r = parseWhatsappPayload(payload([texto({ id: 'wamid.A' }), texto({ id: 'wamid.B' })]));

    expect(r.messages.map((m) => m.messageId)).toEqual(['wamid.A', 'wamid.B']);
  });
});

describe('configuracao do WhatsApp', () => {
  it('base: vazio = Graph oficial; so hosts de teste em http', () => {
    expect(resolveGraphBase('')).toEqual({
      ok: true,
      base: 'https://graph.facebook.com',
      testServer: false,
    });
    expect(resolveGraphBase('http://whatsapp-fake:8082')).toEqual({
      ok: true,
      base: 'http://whatsapp-fake:8082',
      testServer: true,
    });
    for (const ruim of [
      'http://evil.example',
      'https://graph.facebook.com',
      'http://u:p@whatsapp-fake',
      'http://whatsapp-fake/x',
    ]) {
      expect(resolveGraphBase(ruim).ok).toBe(false);
    }
  });

  it('valores implausiveis sao recusados sem repetir o valor', () => {
    const problemas = validateWhatsappSettings({
      WHATSAPP_WEBHOOK_TOKEN: 'curto',
      WHATSAPP_APP_SECRET: 'tem espaco no meio do segredo',
      WHATSAPP_ACCESS_TOKEN: 'x',
      WHATSAPP_PHONE_NUMBER_ID: 'abc',
      WHATSAPP_GRAPH_API_VERSION: '21',
      WHATSAPP_API_BASE_URL: 'http://u:SEGREDO@evil.example',
    });

    expect(problemas).toHaveLength(6);
    expect(JSON.stringify(problemas)).not.toContain('SEGREDO');
    expect(JSON.stringify(problemas)).not.toContain('curto');
  });

  it('verify token igual ao app secret e recusado; configuracao boa passa', () => {
    const igual = 'mesmo-valor-0123456789abcdef';
    expect(
      validateWhatsappSettings({ WHATSAPP_WEBHOOK_TOKEN: igual, WHATSAPP_APP_SECRET: igual }),
    ).toHaveLength(1);
    expect(
      validateWhatsappSettings({
        WHATSAPP_WEBHOOK_TOKEN: 'token-de-verificacao-123',
        WHATSAPP_APP_SECRET: SECRET,
        WHATSAPP_ACCESS_TOKEN: 'EAAG-token-de-teste-0123456789',
        WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        WHATSAPP_GRAPH_API_VERSION: 'v21.0',
      }),
    ).toEqual([]);
  });
});

describe('WhatsappApiClient', () => {
  const config = (over: Record<string, string> = {}): ConfigService =>
    new ConfigService({
      WHATSAPP_ACCESS_TOKEN: 'EAAG-token-FALSO-0123456789',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_GRAPH_API_VERSION: 'v21.0',
      ...over,
    });
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POST de texto simples na Graph oficial, token so no cabecalho', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await new WhatsappApiClient(config()).sendText('5511999990000', 'ola');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(url).not.toContain('EAAG');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer EAAG-token-FALSO-0123456789',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511999990000',
      type: 'text',
      text: { preview_url: false, body: 'ola' },
    });
  });

  it.each([
    ['sem token', { WHATSAPP_ACCESS_TOKEN: '' }],
    ['sem id do numero', { WHATSAPP_PHONE_NUMBER_ID: '' }],
    ['versao invalida', { WHATSAPP_GRAPH_API_VERSION: 'latest' }],
    ['base nao permitida', { WHATSAPP_API_BASE_URL: 'http://evil.example' }],
  ])('%s: falha antes da rede', async (_nome, over) => {
    await expect(
      new WhatsappApiClient(config(over)).sendText('5511999990000', 'x'),
    ).rejects.toMatchObject({ kind: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['destino invalido', 'abc', 'x'],
    ['texto vazio', '5511999990000', ''],
    ['texto enorme', '5511999990000', 'x'.repeat(4097)],
  ])('%s: recusado', async (_nome, to, text) => {
    await expect(new WhatsappApiClient(config()).sendText(to, text)).rejects.toMatchObject({
      kind: 'invalid-request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falhas viram categoria fixa, sem token, URL nem corpo da Meta', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"SEGREDO-META"}}', { status: 401 }),
    );
    const erro = await new WhatsappApiClient(config())
      .sendText('5511999990000', 'x')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(WhatsappApiError);
    expect((erro as WhatsappApiError).kind).toBe('http');
    expect(`${(erro as Error).message} ${JSON.stringify(erro)}`).not.toMatch(
      /SEGREDO-META|EAAG|graph\.facebook/,
    );

    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED https://graph.facebook.com/EAAG'));
    const rede = await new WhatsappApiClient(config())
      .sendText('5511999990000', 'x')
      .catch((e: unknown) => e);
    expect((rede as WhatsappApiError).kind).toBe('network');
    expect(`${(rede as Error).message}`).not.toMatch(/EAAG|graph/);
  });

  it.each([
    ['codigo numerico', '{"error":{"message":"SEGREDO-META","code":190,"fbtrace_id":"ABC"}}', 190],
    ['codigo como texto', '{"error":{"code":"190"}}', undefined],
    ['codigo fracionado', '{"error":{"code":1.5}}', undefined],
    ['codigo negativo', '{"error":{"code":-1}}', undefined],
    ['sem error', '{"outro":1}', undefined],
    ['corpo nao e JSON', '<html>SEGREDO-META</html>', undefined],
    ['corpo vazio', '', undefined],
  ])('HTTP 400 (%s): guarda so o status e o codigo inteiro', async (_nome, corpo, codigo) => {
    fetchMock.mockResolvedValue(new Response(corpo, { status: 400 }));
    const erro = (await new WhatsappApiClient(config())
      .sendText('5511999990000', 'x')
      .catch((e: unknown) => e)) as WhatsappApiError;

    expect(erro.kind).toBe('http');
    expect(erro.httpStatus).toBe(400);
    expect(erro.graphCode).toBe(codigo);
    expect(`${erro.message} ${JSON.stringify(erro)}`).not.toMatch(
      /SEGREDO-META|fbtrace|ABC|EAAG|graph\.facebook|5511999990000/,
    );
  });

  it.each([
    [
      'codigo, subcodigo e tipo conhecido',
      '{"error":{"message":"SEGREDO-META","type":"OAuthException","code":10,"error_subcode":2018,"fbtrace_id":"ABC"}}',
      { code: 10, subcode: 2018, type: 'OAuthException' },
    ],
    [
      'sem subcodigo',
      '{"error":{"type":"OAuthException","code":10}}',
      { code: 10, subcode: undefined, type: 'OAuthException' },
    ],
    [
      'subcodigo como texto',
      '{"error":{"code":10,"error_subcode":"2018"}}',
      { code: 10, subcode: undefined, type: undefined },
    ],
    [
      'subcodigo fracionado',
      '{"error":{"code":10,"error_subcode":1.5}}',
      { code: 10, subcode: undefined, type: undefined },
    ],
    [
      'subcodigo negativo',
      '{"error":{"code":10,"error_subcode":-1}}',
      { code: 10, subcode: undefined, type: undefined },
    ],
    [
      'subcodigo gigante',
      '{"error":{"code":10,"error_subcode":1e300}}',
      { code: 10, subcode: undefined, type: undefined },
    ],
    [
      'tipo desconhecido vira outro (texto livre nao passa)',
      '{"error":{"code":10,"type":"SEGREDO-META 5511999990000"}}',
      { code: 10, subcode: undefined, type: 'outro' },
    ],
    [
      'tipo nao e texto',
      '{"error":{"code":10,"type":{"a":"SEGREDO-META"}}}',
      { code: 10, subcode: undefined, type: undefined },
    ],
    [
      'error nao e objeto',
      '{"error":"SEGREDO-META"}',
      { code: undefined, subcode: undefined, type: undefined },
    ],
  ])(
    'HTTP 400 (%s): guarda so inteiros e tipo da lista fechada',
    async (_nome, corpo, esperado) => {
      fetchMock.mockResolvedValue(new Response(corpo, { status: 400 }));
      const erro = (await new WhatsappApiClient(config())
        .sendText('5511999990000', 'x')
        .catch((e: unknown) => e)) as WhatsappApiError;

      expect(erro.httpStatus).toBe(400);
      expect(erro.graphCode).toBe(esperado.code);
      expect(erro.graphSubcode).toBe(esperado.subcode);
      expect(erro.graphType).toBe(esperado.type);
      expect(`${erro.message} ${JSON.stringify(erro)}`).not.toMatch(
        /SEGREDO-META|fbtrace|ABC|EAAG|graph\.facebook|5511999990000/,
      );
    },
  );

  it('redirect nao e seguido', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'http://evil.example' } }),
    );

    await expect(
      new WhatsappApiClient(config()).sendText('5511999990000', 'x'),
    ).rejects.toMatchObject({ kind: 'redirect' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
