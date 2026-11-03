import { passwordVersion } from './password-version';

describe('passwordVersion', () => {
  it('e deterministico e muda quando o hash muda', () => {
    expect(passwordVersion('hash-a')).toBe(passwordVersion('hash-a'));
    expect(passwordVersion('hash-a')).not.toBe(passwordVersion('hash-b'));
  });

  it('tem 16 caracteres hexadecimais e nao contem o hash', () => {
    const hash = '$2b$12$abcdefghijklmnopqrstuuVWXYZ0123456789ABCDEFGHIJKLMNOPQ';
    const versao = passwordVersion(hash);

    expect(versao).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toContain(versao);
  });
});
