import {
  OFFICIAL_TELEGRAM_API_BASE,
  resolveTelegramApiBase,
  TELEGRAM_TEST_SERVER_HOSTS,
} from './telegram-api-base';

describe('resolveTelegramApiBase', () => {
  it.each([undefined, null, '', '   '])(
    'sem valor (%p): a API oficial, nao e servidor de teste',
    (raw) => {
      expect(resolveTelegramApiBase(raw)).toEqual({
        ok: true,
        base: OFFICIAL_TELEGRAM_API_BASE,
        testServer: false,
      });
    },
  );

  it.each([
    ['http://telegram-fake:8081', 'http://telegram-fake:8081'],
    ['http://localhost:9000/', 'http://localhost:9000'],
    ['http://127.0.0.1:8081', 'http://127.0.0.1:8081'],
    ['  http://TELEGRAM-FAKE:8081  ', 'http://telegram-fake:8081'],
  ])('servidor de teste %s', (raw, base) => {
    expect(resolveTelegramApiBase(raw)).toEqual({ ok: true, base, testServer: true });
  });

  describe('o token do bot nunca pode ser desviado para fora', () => {
    it.each([
      ['host externo', 'http://evil.example:8081'],
      ['IP de LAN', 'http://192.168.0.5:8081'],
      ['subdominio que contem o nome', 'http://telegram-fake.evil.example'],
      ['nome com prefixo', 'http://xtelegram-fake'],
      ['a API oficial em https (nao se redireciona para ela)', 'https://api.telegram.org'],
      ['https em host de teste', 'https://telegram-fake'],
      ['usuario e senha', 'http://u:SEGREDO@telegram-fake'],
      ['caminho', 'http://telegram-fake/bot'],
      ['query', 'http://telegram-fake/?a=1'],
      ['fragmento', 'http://telegram-fake/#a'],
      ['nao e URL', 'telegram-fake'],
      ['esquema file', 'file:///etc/passwd'],
    ])('%s: recusado', (_nome, raw) => {
      expect(resolveTelegramApiBase(raw).ok).toBe(false);
    });

    it('valor que nao e texto: recusado', () => {
      expect(resolveTelegramApiBase(42).ok).toBe(false);
    });

    it('a mensagem de erro nao repete o valor informado', () => {
      const result = resolveTelegramApiBase('http://u:SEGREDO@evil.example');

      expect(JSON.stringify(result)).not.toContain('SEGREDO');
      expect(JSON.stringify(result)).not.toContain('evil.example');
    });
  });

  it('a lista de hosts de teste e fechada e curta', () => {
    expect(TELEGRAM_TEST_SERVER_HOSTS).toEqual(['telegram-fake', 'localhost', '127.0.0.1']);
  });
});
