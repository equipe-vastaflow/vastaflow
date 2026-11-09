import { maskAccountNumber, maskDocument, maskSensitive } from './plantae-mask';

// Documentos SINTETICOS (digitos de exemplo), nunca de pessoa real.
const CPF = '123.456.789-09';
const CNPJ = '12.345.678/0001-95';

describe('maskDocument', () => {
  it.each([
    [CPF, '***.456.789-**'],
    ['12345678909', '***.456.789-**'],
    [' 123 456 789 09 ', '***.456.789-**'],
    [CNPJ, '12.345.678/****-**'],
    ['12345678000195', '12.345.678/****-**'],
    [12345678909, '***.456.789-**'],
  ])('%p -> %p', (entrada, esperado) => {
    expect(maskDocument(entrada)).toBe(esperado);
  });

  it('null e undefined continuam null', () => {
    expect(maskDocument(null)).toBeNull();
    expect(maskDocument(undefined)).toBeNull();
  });

  it('texto vazio continua vazio (nao ha dado a esconder)', () => {
    expect(maskDocument('')).toBe('');
    expect(maskDocument('   ')).toBe('');
  });

  it.each([
    ['1234567890'], // 10 digitos
    ['123456789012'], // 12 digitos
    ['123456789012345'], // 15 digitos
    ['sem digitos'],
    ['CPF 123'],
  ])('formato inesperado %p vira mascara total, nunca o original', (entrada) => {
    expect(maskDocument(entrada)).toBe('***');
  });

  it.each([[true], [{ numero: CPF }], [[CPF]], [Number.NaN]])(
    'tipo inesperado %p vira mascara total',
    (entrada) => {
      expect(maskDocument(entrada)).toBe('***');
    },
  );

  it('nenhum resultado contem os digitos verificadores nem o documento inteiro', () => {
    for (const entrada of [CPF, '12345678909', CNPJ, '12345678000195']) {
      const mascarado = maskDocument(entrada) ?? '';
      expect(mascarado).not.toContain(entrada);
      expect(mascarado.replace(/\D/g, '')).not.toBe(entrada.replace(/\D/g, ''));
      expect(mascarado.endsWith('-**')).toBe(true);
    }
  });
});

describe('maskAccountNumber', () => {
  it.each([
    ['98765-4', '****7654'],
    ['987654', '****7654'],
    ['0012345-X', '****345X'],
    ['12.345.678-9', '****6789'],
    [123456, '****3456'],
  ])('%p -> %p (so os ultimos 4)', (entrada, esperado) => {
    expect(maskAccountNumber(entrada)).toBe(esperado);
  });

  it.each([['1234'], ['12-3'], ['1'], ['--']])(
    'com 4 caracteres ou menos %p nao mostra nada',
    (entrada) => {
      expect(maskAccountNumber(entrada)).toBe('****');
    },
  );

  it('null continua null; vazio continua vazio', () => {
    expect(maskAccountNumber(null)).toBeNull();
    expect(maskAccountNumber(undefined)).toBeNull();
    expect(maskAccountNumber('')).toBe('');
  });

  it('tipo inesperado vira mascara total', () => {
    expect(maskAccountNumber({ numero: '98765-4' })).toBe('****');
    expect(maskAccountNumber(false)).toBe('****');
  });
});

describe('maskSensitive', () => {
  const pessoa = {
    pessoa_id: 6990,
    nome: 'Pessoa Ficticia',
    razao_social: null,
    tipo_pessoa: 'F',
    cpf_cnpj: CPF,
  };

  it('mascara CPF/CNPJ em qualquer nivel (pessoa, emitente, destinatario, listas)', () => {
    const entrada = {
      data: [
        { parcela_id: 1, valor: '8337.10', pessoa },
        {
          nota_fiscal_id: 2,
          emitente: { razao_social_id: 155, cpf_cnpj: CNPJ },
          destinatario: { pessoa_id: 2775, cpf_cnpj: CPF },
        },
      ],
    };

    const saida = maskSensitive(entrada);

    expect(saida.data[0]).toEqual({
      parcela_id: 1,
      valor: '8337.10',
      pessoa: { ...pessoa, cpf_cnpj: '***.456.789-**' },
    });
    expect(saida.data[1]).toEqual({
      nota_fiscal_id: 2,
      emitente: { razao_social_id: 155, cpf_cnpj: '12.345.678/****-**' },
      destinatario: { pessoa_id: 2775, cpf_cnpj: '***.456.789-**' },
    });
  });

  it('mascara documento dentro de campo opaco (cpf/cnpj soltos, objetos aninhados)', () => {
    const saida = maskSensitive({
      razao_social: { cnpj: CNPJ, detalhe: { cpf: CPF, outro: 'x' } },
    });

    expect(saida).toEqual({
      razao_social: { cnpj: '12.345.678/****-**', detalhe: { cpf: '***.456.789-**', outro: 'x' } },
    });
  });

  it('mascara numero_conta e preserva agencia, banco e identificadores', () => {
    const conta = {
      conta_id: 1496,
      nome: 'Conta Ficticia',
      tipo: { codigo: 2, descricao: 'Conta bancaria' },
      banco: { banco_id: 5085, nome: 'Banco Ficticio' },
      agencia: '0001',
      numero_conta: '98765-4',
      conta_bancaria_id: 8266,
    };

    expect(maskSensitive([conta])).toEqual([{ ...conta, numero_conta: '****7654' }]);
  });

  it('nao altera valores financeiros, saldos, datas, booleanos nem nulos', () => {
    const movimento = {
      mov_conta_id: 2960,
      data: '2026-09-02',
      valor: '1503.20',
      saldo: '9000.80',
      conciliado: false,
      data_conciliacao: null,
      titulo_id: 352,
      numero_cheque: '000123',
      conta: { conta_id: 1496, nome: 'Conta Ficticia', tipo: null },
    };

    expect(maskSensitive(movimento)).toEqual(movimento);
  });

  it('nao muta a entrada (devolve copia)', () => {
    const entrada = { pessoa: { ...pessoa } };
    const congelada = Object.freeze({ pessoa: Object.freeze({ ...pessoa }) });

    maskSensitive(entrada);

    expect(entrada.pessoa.cpf_cnpj).toBe(CPF);
    expect(() => maskSensitive(congelada)).not.toThrow();
    expect(maskSensitive(congelada).pessoa.cpf_cnpj).toBe('***.456.789-**');
  });

  it('o documento completo nao sobrevive em lugar nenhum da saida serializada', () => {
    const saida = JSON.stringify(
      maskSensitive({
        data: [{ pessoa }, { emitente: { cpf_cnpj: CNPJ } }, { numero_conta: '98765-4' }],
      }),
    );

    for (const proibido of [CPF, '12345678909', CNPJ, '12345678000195', '98765-4', '98765']) {
      expect(saida).not.toContain(proibido);
    }
  });

  it('primitivos e null passam intactos', () => {
    expect(maskSensitive(null)).toBeNull();
    expect(maskSensitive('texto')).toBe('texto');
    expect(maskSensitive(42)).toBe(42);
  });
});
