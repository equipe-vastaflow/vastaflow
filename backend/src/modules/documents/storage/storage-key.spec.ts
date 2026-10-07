import { generateStorageKey, isSafeStorageKey, STORAGE_KEY_MAX_LENGTH } from './storage-key';

/** Tentativas de manipulacao que a chave jamais deve aceitar. */
const CHAVES_HOSTIS = [
  '../../arquivo.pdf',
  '..\\..\\arquivo.pdf',
  '/absolute/path',
  'C:\\absolute\\path',
  '/etc/passwd',
  '2026/10/05/../../../etc/passwd',
  '2026/10/05/..%2F..%2Fetc%2Fpasswd',
  './2026/10/05/arquivo.bin',
  'arquivo.pdf',
  '2026/10/05/arquivo.pdf',
  '2026/10/05/nao-e-uuid.bin',
  '2026/10/05/',
  '',
  ' ',
  '\\',
  '/',
  '..',
  'C:/Users/ejsoa/segredo.txt',
  '\\\\servidor\\compartilhado\\arquivo.bin',
  'http://exemplo.com/arquivo.bin',
];

describe('generateStorageKey', () => {
  it('gera no formato AAAA/MM/DD/<uuid>.bin', () => {
    const chave = generateStorageKey(new Date(Date.UTC(2026, 9, 5, 12, 0, 0)));

    expect(chave).toMatch(/^2026\/10\/05\/[0-9a-f-]{36}\.bin$/);
  });

  it('a chave gerada e sempre aceita pela propria validacao', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isSafeStorageKey(generateStorageKey())).toBe(true);
    }
  });

  it('usa UTC: o prefixo de data nao muda com o fuso da maquina', () => {
    // 23:30 em Brasilia (UTC-3) ja e o dia seguinte em UTC. Usar fuso local
    // faria duas maquinas gravarem o mesmo documento em prefixos diferentes.
    const chave = generateStorageKey(new Date(Date.UTC(2026, 0, 1, 2, 30, 0)));

    expect(chave.startsWith('2026/01/01/')).toBe(true);
  });

  it('nunca repete: 2000 chaves, 2000 valores distintos', () => {
    const chaves = new Set(Array.from({ length: 2000 }, () => generateStorageKey()));

    expect(chaves.size).toBe(2000);
  });

  it('nao e previsivel: o sufixo nao deriva do horario', () => {
    // Mesmo instante, chaves diferentes - o UUID vem de gerador
    // criptografico, nao de timestamp.
    const instante = new Date(Date.UTC(2026, 9, 5));
    const primeira = generateStorageKey(instante);
    const segunda = generateStorageKey(instante);

    expect(primeira).not.toBe(segunda);
  });

  it('a extensao fisica e sempre .bin', () => {
    // Nunca a extensao original: um objeto gravado como `.html` ou `.svg`
    // poderia ser servido e interpretado por quem olhasse so o caminho.
    expect(generateStorageKey().endsWith('.bin')).toBe(true);
  });

  it('cabe na coluna com folga', () => {
    expect(generateStorageKey().length).toBeLessThanOrEqual(STORAGE_KEY_MAX_LENGTH);
  });
});

describe('isSafeStorageKey', () => {
  it.each(CHAVES_HOSTIS)('recusa %j', (chave) => {
    expect(isSafeStorageKey(chave)).toBe(false);
  });

  it('recusa byte nulo no meio de uma chave valida', () => {
    const valida = generateStorageKey();

    expect(isSafeStorageKey(`${valida}\0.txt`)).toBe(false);
    expect(isSafeStorageKey(valida.replace('/', '\0'))).toBe(false);
  });

  it('recusa chave acima do limite da coluna', () => {
    expect(isSafeStorageKey(`2026/10/05/${'a'.repeat(STORAGE_KEY_MAX_LENGTH)}.bin`)).toBe(false);
  });

  it('recusa UUID em maiusculas: o formato gerado e minusculo', () => {
    const chave = generateStorageKey();

    expect(isSafeStorageKey(chave.toUpperCase())).toBe(false);
  });

  it('recusa prefixo de data mal formado', () => {
    const uuid = generateStorageKey().split('/')[3];

    for (const prefixo of ['26/10/05', '2026/1/05', '2026/10/5', '2026-10-05', '2026/10']) {
      expect(isSafeStorageKey(`${prefixo}/${uuid}`)).toBe(false);
    }
  });
});
