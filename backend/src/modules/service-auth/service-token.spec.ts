import {
  SERVICE_TOKEN_BYTES,
  SERVICE_TOKEN_PATTERN,
  SERVICE_TOKEN_PREFIX,
} from './service-auth.constants';
import { generateServiceToken, hashServiceToken, hasServiceTokenFormat } from './service-token';

describe('generateServiceToken', () => {
  it('tem o formato esperado: prefixo + 43 caracteres base64url', () => {
    const token = generateServiceToken();

    expect(token).toMatch(SERVICE_TOKEN_PATTERN);
    expect(token.startsWith(SERVICE_TOKEN_PREFIX)).toBe(true);
    expect(token).toHaveLength(SERVICE_TOKEN_PREFIX.length + 43);
  });

  it('carrega 256 bits de entropia', () => {
    // 43 caracteres base64url sem padding = 32 bytes. Se alguem trocar o
    // gerador por algo mais curto, este teste e o que avisa.
    const corpo = generateServiceToken().slice(SERVICE_TOKEN_PREFIX.length);

    expect(Buffer.from(corpo, 'base64url')).toHaveLength(SERVICE_TOKEN_BYTES);
    expect(SERVICE_TOKEN_BYTES * 8).toBe(256);
  });

  it('nunca repete', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateServiceToken()));

    expect(tokens.size).toBe(500);
  });

  it('nao e um JWT: nao tem pontos nem estrutura decodificavel', () => {
    const token = generateServiceToken();

    expect(token.split('.')).toHaveLength(1);
  });
});

describe('hasServiceTokenFormat', () => {
  const valido = generateServiceToken();

  it('aceita um token gerado', () => {
    expect(hasServiceTokenFormat(valido)).toBe(true);
  });

  it.each([
    ['vazio', ''],
    ['so o prefixo', 'vfs_'],
    ['curto demais (42)', `vfs_${'a'.repeat(42)}`],
    ['longo demais (44)', `vfs_${'a'.repeat(44)}`],
    ['sem prefixo', 'a'.repeat(43)],
    ['prefixo errado', `xyz_${'a'.repeat(43)}`],
    ['prefixo em maiusculas', `VFS_${'a'.repeat(43)}`],
    ['com "+" (base64 comum, nao base64url)', `vfs_${'a'.repeat(42)}+`],
    ['com "/" (base64 comum, nao base64url)', `vfs_${'a'.repeat(42)}/`],
    ['com padding "="', `vfs_${'a'.repeat(42)}=`],
    ['com espaco', `vfs_${'a'.repeat(42)} `],
    ['com quebra de linha', `vfs_${'a'.repeat(42)}\n`],
    ['com espaco no inicio', ` vfs_${'a'.repeat(43)}`],
    ['dois tokens colados', `${valido},${valido}`],
    ['com caractere nao ASCII', `vfs_${'a'.repeat(42)}ç`],
  ])('recusa: %s', (_nome, token) => {
    expect(hasServiceTokenFormat(token)).toBe(false);
  });
});

describe('hashServiceToken', () => {
  it('devolve SHA-256 em hexadecimal minusculo (64 caracteres)', () => {
    expect(hashServiceToken(generateServiceToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('e deterministico', () => {
    const token = generateServiceToken();

    expect(hashServiceToken(token)).toBe(hashServiceToken(token));
  });

  it('tokens diferentes dao hashes diferentes', () => {
    expect(hashServiceToken(generateServiceToken())).not.toBe(
      hashServiceToken(generateServiceToken()),
    );
  });

  it('vetor conhecido de SHA-256: confere com a implementacao de referencia', () => {
    // SHA-256("abc"), do FIPS 180-2 - guarda contra trocar o algoritmo por engano.
    expect(hashServiceToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('o hash NAO contem o token', () => {
    const token = generateServiceToken();

    expect(hashServiceToken(token)).not.toContain(token.slice(SERVICE_TOKEN_PREFIX.length));
  });
});
