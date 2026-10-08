import {
  EMPTY_CREDENTIALS_FILE,
  parseCredentialsFile,
  serializeCredentialsFile,
} from './service-credentials.file';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function registro(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'n8n-2026-10',
    principal: 'n8n',
    sha256: HASH_A,
    status: 'active',
    createdAt: '2026-10-08T00:00:00.000Z',
    ...over,
  };
}

function arquivo(credentials: unknown[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, credentials, ...over });
}

describe('parseCredentialsFile', () => {
  it('aceita um arquivo valido', () => {
    const file = parseCredentialsFile(arquivo([registro()]));

    expect(file.credentials).toEqual([registro()]);
  });

  it('aceita campos opcionais (expiresAt, revokedAt)', () => {
    const file = parseCredentialsFile(
      arquivo([
        registro({
          status: 'revoked',
          expiresAt: '2027-01-01T00:00:00.000Z',
          revokedAt: '2026-10-09T00:00:00.000Z',
        }),
      ]),
    );

    expect(file.credentials[0]).toMatchObject({
      status: 'revoked',
      expiresAt: '2027-01-01T00:00:00.000Z',
      revokedAt: '2026-10-09T00:00:00.000Z',
    });
  });

  it('lista vazia e valida e significa "nenhuma credencial"', () => {
    expect(parseCredentialsFile(arquivo([])).credentials).toEqual([]);
    expect(EMPTY_CREDENTIALS_FILE.credentials).toEqual([]);
  });

  it('aceita varias credenciais (janela de rotacao)', () => {
    const file = parseCredentialsFile(
      arquivo([registro(), registro({ id: 'n8n-2026-11', sha256: HASH_B })]),
    );

    expect(file.credentials.map((c) => c.id)).toEqual(['n8n-2026-10', 'n8n-2026-11']);
  });

  describe('recusa (o arquivo inteiro e rejeitado)', () => {
    it.each([
      ['JSON invalido', '{ nao e json', /JSON invalido/],
      ['texto vazio', '', /JSON invalido/],
      ['raiz que e lista', '[]', /raiz/],
      ['raiz nula', 'null', /raiz/],
      ['sem version', JSON.stringify({ credentials: [] }), /version/],
      ['version 2', arquivo([], { version: 2 }), /version/],
      ['credentials ausente', JSON.stringify({ version: 1 }), /credentials/],
      ['credentials que nao e lista', arquivo({} as unknown as unknown[]), /credentials/],
      ['item que nao e objeto', arquivo(['texto']), /credencial #1.*objeto/],
      ['id curto demais', arquivo([registro({ id: 'ab' })]), /'id' invalido/],
      ['id com maiuscula', arquivo([registro({ id: 'N8N-2026' })]), /'id' invalido/],
      ['id com espaco', arquivo([registro({ id: 'n8n 2026' })]), /'id' invalido/],
      ['id que nao e texto', arquivo([registro({ id: 123 })]), /'id' invalido/],
      ['principal desconhecido', arquivo([registro({ principal: 'whatsapp' })]), /principal/],
      ['sha256 curto', arquivo([registro({ sha256: 'abc' })]), /sha256/],
      ['sha256 em maiusculas', arquivo([registro({ sha256: 'A'.repeat(64) })]), /sha256/],
      ['sha256 nao hexadecimal', arquivo([registro({ sha256: 'z'.repeat(64) })]), /sha256/],
      ['status desconhecido', arquivo([registro({ status: 'ativa' })]), /status/],
      ['status ausente', arquivo([registro({ status: undefined })]), /status/],
      ['createdAt ausente', arquivo([registro({ createdAt: undefined })]), /createdAt/],
      ['createdAt invalida', arquivo([registro({ createdAt: 'ontem' })]), /createdAt/],
      ['expiresAt invalida', arquivo([registro({ expiresAt: 'amanha' })]), /expiresAt/],
      ['revokedAt invalida', arquivo([registro({ revokedAt: 42 })]), /revokedAt/],
    ])('%s', (_nome, texto, esperado) => {
      expect(() => parseCredentialsFile(texto)).toThrow(esperado);
    });

    it('campo desconhecido derruba o arquivo, em vez de ser ignorado', () => {
      // Um operador que digita `statuss: "revoked"` ou `expiresat` NAO pode ter
      // o campo ignorado em silencio: a credencial que ele acha revogada
      // continuaria valendo.
      expect(() => parseCredentialsFile(arquivo([registro({ statuss: 'revoked' })]))).toThrow(
        /campo desconhecido 'statuss'/,
      );
      expect(() => parseCredentialsFile(arquivo([registro({ expiresat: '2027-01-01' })]))).toThrow(
        /campo desconhecido 'expiresat'/,
      );
    });

    it('id repetido', () => {
      expect(() =>
        parseCredentialsFile(arquivo([registro(), registro({ sha256: HASH_B })])),
      ).toThrow(/'id' repetido/);
    });

    it('sha256 repetido', () => {
      expect(() =>
        parseCredentialsFile(arquivo([registro(), registro({ id: 'n8n-2026-11' })])),
      ).toThrow(/'sha256' repetido/);
    });

    it('uma credencial invalida entre varias validas derruba TODAS', () => {
      // Nao ha "aproveitar o que prestou": um arquivo parcialmente quebrado nega.
      expect(() =>
        parseCredentialsFile(arquivo([registro(), registro({ id: 'n8n-2', sha256: 'curto' })])),
      ).toThrow(/credencial #2/);
    });
  });

  it('as mensagens de erro NAO reproduzem valores do arquivo', () => {
    // O hash e o id sao distintivos de proposito: se algum aparecer na mensagem,
    // o erro vazou conteudo do arquivo para o log.
    const hashDistintivo = 'c0ffee'.repeat(10) + 'abcd';
    const idDistintivo = 'id-distintivo-xyz';
    const casos = [
      arquivo([registro({ id: idDistintivo, sha256: hashDistintivo, status: 'quebrado' })]),
      arquivo([registro({ id: idDistintivo, sha256: hashDistintivo, principal: 'x' })]),
      arquivo([registro({ id: idDistintivo, sha256: hashDistintivo, createdAt: 'x' })]),
      arquivo([registro({ id: idDistintivo, sha256: hashDistintivo, extra: 1 })]),
    ];

    for (const texto of casos) {
      try {
        parseCredentialsFile(texto);
        throw new Error('deveria ter sido recusado');
      } catch (error) {
        const mensagem = error instanceof Error ? error.message : String(error);

        expect(mensagem).not.toContain(hashDistintivo);
        expect(mensagem).not.toContain(idDistintivo);
      }
    }
  });
});

describe('serializeCredentialsFile', () => {
  it('ida e volta preserva o conteudo', () => {
    const original = parseCredentialsFile(
      arquivo([
        registro(),
        registro({ id: 'n8n-2026-11', sha256: HASH_B, expiresAt: '2027-01-01T00:00:00.000Z' }),
      ]),
    );

    expect(parseCredentialsFile(serializeCredentialsFile(original))).toEqual(original);
  });

  it('termina com quebra de linha e e legivel por pessoa', () => {
    const texto = serializeCredentialsFile(EMPTY_CREDENTIALS_FILE);

    expect(texto.endsWith('\n')).toBe(true);
    expect(texto).toContain('\n  ');
  });
});
