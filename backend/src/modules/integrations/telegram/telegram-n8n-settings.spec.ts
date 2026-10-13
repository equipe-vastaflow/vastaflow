import { isAcceptableSigningKey, parseN8nWebhookUrl } from './telegram-n8n-settings';

describe('parseN8nWebhookUrl', () => {
  it.each([
    'http://n8n:5678/webhook/vastaflow-telegram',
    'http://localhost:5678/webhook/vastaflow-telegram',
    'http://127.0.0.1:5678/webhook/x',
    'https://n8n/webhook/vastaflow-telegram',
    '  http://n8n:5678/webhook/vastaflow-telegram  ',
  ])('aceita %s', (url) => {
    expect(parseN8nWebhookUrl(url).ok).toBe(true);
  });

  it.each([
    ['host externo', 'http://exemplo.com/webhook/x', 'host'],
    ['IP de LAN', 'http://192.168.0.10:5678/webhook/x', 'host'],
    ['subdominio parecido', 'http://n8n.evil.com/webhook/x', 'host'],
    ['host com prefixo parecido', 'http://xn8n/webhook/x', 'host'],
    ['sem caminho de webhook', 'http://n8n:5678/', 'caminho'],
    ['caminho do editor', 'http://n8n:5678/rest/login', 'caminho'],
    ['caminho de teste (nao producao)', 'http://n8n:5678/webhook-test/x', 'caminho'],
    ['webhook vazio', 'http://n8n:5678/webhook/', 'caminho'],
    ['usuario e senha', 'http://u:p@n8n:5678/webhook/x', 'usuario'],
    ['query string', 'http://n8n:5678/webhook/x?token=1', 'query'],
    ['fragmento', 'http://n8n:5678/webhook/x#a', 'fragmento'],
    ['esquema ftp', 'ftp://n8n/webhook/x', 'http'],
    ['esquema file', 'file:///etc/passwd', 'http'],
    ['nao e URL', 'isto nao e uma url', 'URL'],
    ['vazio', '', 'URL'],
  ])('recusa %s', (_nome, url, trecho) => {
    const result = parseN8nWebhookUrl(url);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem).toContain(trecho);
  });

  it('a mensagem de erro NAO repete a URL informada', () => {
    const result = parseN8nWebhookUrl('http://ZEBRA:SEGREDO-42@n8n:5678/webhook/x');

    expect(JSON.stringify(result)).not.toContain('SEGREDO-42');
    expect(JSON.stringify(result)).not.toContain('ZEBRA');
  });
});

describe('isAcceptableSigningKey', () => {
  it('aceita 32 ou mais caracteres sem espaco', () => {
    expect(isAcceptableSigningKey('a'.repeat(32))).toBe(true);
    expect(isAcceptableSigningKey('a'.repeat(64))).toBe(true);
  });

  it.each([
    ['curta', 'a'.repeat(31)],
    ['vazia', ''],
    ['com espaco', `${'a'.repeat(20)} ${'b'.repeat(20)}`],
    ['com quebra de linha', `${'a'.repeat(40)}\n`],
  ])('recusa %s', (_nome, chave) => {
    expect(isAcceptableSigningKey(chave)).toBe(false);
  });
});
