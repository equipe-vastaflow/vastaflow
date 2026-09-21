import { isPasswordValid } from './password.policy';

describe('isPasswordValid', () => {
  it.each(['Senha1234', 'Abcdefg1', 'Senha Com Espacos 1', 'Sénha1234'])('aceita %s', (senha) => {
    expect(isPasswordValid(senha)).toBe(true);
  });

  it.each([
    ['curta demais', 'Ab1cdef'],
    ['sem numero', 'SenhaSemNumero'],
    ['sem maiuscula', 'senha1234'],
    ['sem minuscula', 'SENHA1234'],
    ['vazia', ''],
  ])('recusa senha %s', (_descricao, senha) => {
    expect(isPasswordValid(senha)).toBe(false);
  });

  it.each([[undefined], [null], [12345678], [{}]])('recusa valor que nao e texto (%j)', (valor) => {
    expect(isPasswordValid(valor)).toBe(false);
  });

  it('mede o limite do bcrypt em BYTES, nao em caracteres', () => {
    // 'é' ocupa 2 bytes em UTF-8: 36 delas passam de 72 bytes com apenas 36 caracteres.
    const ascii72 = `Aa1${'x'.repeat(69)}`;
    const multibyte = `Aa1${'é'.repeat(36)}`;

    expect(isPasswordValid(ascii72)).toBe(true);
    expect(isPasswordValid(`${ascii72}x`)).toBe(false);
    expect(multibyte.length).toBeLessThan(72);
    expect(isPasswordValid(multibyte)).toBe(false);
  });
});
