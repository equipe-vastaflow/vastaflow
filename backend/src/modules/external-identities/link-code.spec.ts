import { generateLinkCode, hashLinkCode, LINK_CODE_LENGTH, normalizeLinkCode } from './link-code';

describe('codigo de vinculacao', () => {
  it('formato XXXX-XXXX-XXXX, so com o alfabeto Crockford (sem I, L, O, U)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateLinkCode()).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
      );
    }
  });

  it('nao se repete (CSPRNG, 60 bits)', () => {
    const codigos = new Set(Array.from({ length: 5000 }, generateLinkCode));

    expect(codigos.size).toBe(5000);
  });

  it('usa todo o alfabeto: a distribuicao nao e presa a poucos simbolos', () => {
    const simbolos = new Set(
      Array.from({ length: 500 }, generateLinkCode).join('').replace(/-/g, ''),
    );

    expect(simbolos.size).toBe(32);
  });

  describe('normalizeLinkCode', () => {
    it('aceita minusculas, sem hifens e com espacos', () => {
      expect(normalizeLinkCode('k7qm-2xra-9cvb')).toBe('K7QM2XRA9CVB');
      expect(normalizeLinkCode('K7QM2XRA9CVB')).toBe('K7QM2XRA9CVB');
      expect(normalizeLinkCode(' K7QM 2XRA 9CVB ')).toBe('K7QM2XRA9CVB');
    });

    it.each([
      ['curto', 'K7QM-2XRA-9CV'],
      ['longo', 'K7QM-2XRA-9CVBX'],
      ['letra fora do alfabeto (I)', 'I7QM-2XRA-9CVB'],
      ['letra fora do alfabeto (U)', 'U7QM-2XRA-9CVB'],
      ['id interno', '3f2c1a7e-0000-4000-8000-000000000000'],
      ['id do Telegram', '123456789'],
      ['vazio', ''],
    ])('recusa: %s', (_caso, entrada) => {
      expect(normalizeLinkCode(entrada)).toBeNull();
    });
  });

  describe('hashLinkCode', () => {
    it('SHA-256 em hex, deterministico, e nao contem o codigo', () => {
      const codigo = 'K7QM2XRA9CVB';
      const hash = hashLinkCode(codigo);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hashLinkCode(codigo)).toBe(hash);
      expect(hash).not.toContain(codigo.toLowerCase());
      expect(hashLinkCode('K7QM2XRA9CVC')).not.toBe(hash);
    });

    it('o codigo gerado, normalizado, tem o tamanho esperado', () => {
      expect(normalizeLinkCode(generateLinkCode())).toHaveLength(LINK_CODE_LENGTH);
    });
  });
});
