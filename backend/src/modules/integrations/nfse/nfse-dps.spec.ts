import {
  buildNfseInput,
  formatBrl,
  isValidCnpj,
  isValidCpf,
  maskDocument,
  parseNfseArgs,
  summarizeInput,
  todayInBrasilia,
} from './nfse-dps';

const SETTINGS = { opSimpNac: 3 as 1 | 2 | 3, regEspTrib: 0 as const, valorMaximo: '5000.00' };
const NOW = new Date('2026-10-15T15:00:00Z');
const GOOD = {
  tomador: '529.982.247-25',
  nome: 'Maria Teste',
  valor: '1500,50',
  servico: '010101',
  desc: 'Consultoria ficticia',
  iss: '1',
  ret: '1',
  local: '3106200',
  totsn: '12,5',
};

describe('NFS-e - argumentos do comando', () => {
  it('le campo=valor, com aspas retas e tipograficas', () => {
    const parsed = parseNfseArgs(
      'tomador=52998224725 nome="Maria da Silva" desc=“Servico mensal” valor=10,50',
    );
    expect(parsed).toEqual({
      ok: true,
      fields: {
        tomador: '52998224725',
        nome: 'Maria da Silva',
        desc: 'Servico mensal',
        valor: '10,50',
      },
    });
  });

  it('recusa campo desconhecido, repetido e texto solto (nunca adivinha a intencao)', () => {
    expect(parseNfseArgs('foo=1')).toMatchObject({ ok: false });
    expect(parseNfseArgs('valor=1 valor=2')).toMatchObject({ ok: false });
    expect(parseNfseArgs('emitir agora')).toMatchObject({ ok: false });
    expect(parseNfseArgs('valor= 10')).toMatchObject({ ok: false });
  });
});

describe('NFS-e - documentos', () => {
  it('valida os digitos verificadores de CPF e CNPJ', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('mascara o documento: nunca o numero inteiro no chat', () => {
    expect(maskDocument('52998224725')).toBe('***.982.***-**');
    expect(maskDocument('11222333000181')).toBe('**.***.333/****-**');
  });
});

describe('NFS-e - validacao da entrada fiscal', () => {
  it('monta a entrada com tudo informado', () => {
    const built = buildNfseInput(GOOD, SETTINGS, NOW);
    expect(built).toMatchObject({
      ok: true,
      input: {
        tomadorDoc: '52998224725',
        tomadorTipo: 'CPF',
        valor: '1500.50',
        servico: '010101',
        tribIssqn: 1,
        tpRetIssqn: 1,
        localPrestacao: '3106200',
        totTribSimples: '12.50',
        competencia: '2026-10-15',
      },
    });
  });

  it('NADA e preenchido por padrao: falta de qualquer decisao fiscal e erro', () => {
    for (const key of [
      'tomador',
      'nome',
      'valor',
      'servico',
      'desc',
      'iss',
      'ret',
      'local',
      'totsn',
    ]) {
      const fields: Record<string, string> = { ...GOOD };
      delete fields[key];
      const built = buildNfseInput(fields, SETTINGS, NOW);
      expect(built.ok).toBe(false);
    }
  });

  it('devolve TODOS os problemas de uma vez e nunca ecoa o valor invalido', () => {
    const built = buildNfseInput(
      {
        ...GOOD,
        tomador: '12345678900',
        valor: '99999',
        servico: 'ABC',
        iss: '9',
        ret: '7',
        local: '12',
      },
      SETTINGS,
      NOW,
    );
    expect(built.ok).toBe(false);
    if (built.ok) {
      return;
    }
    expect(built.errors.length).toBeGreaterThanOrEqual(6);
    const text = built.errors.join('|');
    expect(text).not.toContain('12345678900');
    expect(text).not.toContain('99999');
  });

  it('respeita o limite de valor por emissao e recusa valor zero ou negativo', () => {
    expect(buildNfseInput({ ...GOOD, valor: '5000,00' }, SETTINGS, NOW).ok).toBe(true);
    expect(buildNfseInput({ ...GOOD, valor: '5000,01' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, valor: '0' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, valor: '-5' }, SETTINGS, NOW).ok).toBe(false);
  });

  it('imunidade e exportacao (iss 2 e 3) nao sao suportadas: exigem dados que nao existem aqui', () => {
    expect(buildNfseInput({ ...GOOD, iss: '2' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, iss: '3' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, iss: '4' }, SETTINGS, NOW).ok).toBe(true);
  });

  it('nao incidencia com regime especial configurado e recusada (regra E0172)', () => {
    expect(buildNfseInput({ ...GOOD, iss: '4' }, { ...SETTINGS, regEspTrib: 5 }, NOW).ok).toBe(
      false,
    );
  });

  it('aliquota: ate 5%, duas casas, so para operacao tributavel (regra E0595)', () => {
    expect(buildNfseInput({ ...GOOD, aliq: '2,5' }, SETTINGS, NOW)).toMatchObject({
      ok: true,
      input: { aliquota: '2.50' },
    });
    expect(buildNfseInput({ ...GOOD, aliq: '5,01' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, aliq: '6' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, iss: '4', aliq: '2' }, SETTINGS, NOW).ok).toBe(false);
  });

  it('ME/EPP exige o percentual de tributos; os demais regimes nao podem informa-lo', () => {
    const { totsn: _omitted, ...withoutTotsn } = GOOD;
    expect(buildNfseInput(withoutTotsn, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput(GOOD, { ...SETTINGS, opSimpNac: 2 }, NOW).ok).toBe(false);
    expect(buildNfseInput(withoutTotsn, { ...SETTINGS, opSimpNac: 2 }, NOW)).toMatchObject({
      ok: true,
      input: { totTribSimples: null },
    });
  });

  it('competencia: data real, nunca futura; padrao e hoje no fuso de Brasilia', () => {
    expect(buildNfseInput({ ...GOOD, competencia: '2026-10-16' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, competencia: '2026-02-30' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, competencia: '2026-10-01' }, SETTINGS, NOW).ok).toBe(true);
    // 01:00 UTC de 16/10 ainda e 15/10 em Brasilia.
    expect(todayInBrasilia(new Date('2026-10-16T01:00:00Z'))).toBe('2026-10-15');
  });

  it('descricao e nome: sem quebra de linha nem caracteres de controle', () => {
    expect(buildNfseInput({ ...GOOD, desc: 'a\nb' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, nome: 'x\u0007y' }, SETTINGS, NOW).ok).toBe(false);
    expect(buildNfseInput({ ...GOOD, desc: 'x'.repeat(2001) }, SETTINGS, NOW).ok).toBe(false);
  });
});

describe('NFS-e - resumo fiscal', () => {
  it('mostra o que sera emitido, com documento mascarado e dinheiro exato', () => {
    const built = buildNfseInput(
      { ...GOOD, valor: '1234567,89' },
      { ...SETTINGS, valorMaximo: '9999999.00' },
      NOW,
    );
    if (!built.ok) {
      throw new Error('entrada invalida');
    }
    const summary = summarizeInput(built.input, { ambiente: 'restrita', numero: 12 });
    expect(summary).toContain('HOMOLOGACAO');
    expect(summary).toContain('R$ 1.234.567,89');
    expect(summary).toContain('***.982.***-**');
    expect(summary).not.toContain('52998224725');
    expect(summary).toContain('aliquota do municipio');
  });

  it('formata em reais a partir do texto decimal', () => {
    expect(formatBrl('0.07')).toBe('R$ 0,07');
    expect(formatBrl('1000.00')).toBe('R$ 1.000,00');
  });

  it('o resumo muda quando QUALQUER campo muda (o hash gravado amarra a confirmacao)', () => {
    const a = buildNfseInput(GOOD, SETTINGS, NOW);
    const b = buildNfseInput({ ...GOOD, valor: '1500,51' }, SETTINGS, NOW);
    if (!a.ok || !b.ok) {
      throw new Error('entrada invalida');
    }
    expect(summarizeInput(a.input, { ambiente: 'restrita', numero: 1 })).not.toEqual(
      summarizeInput(b.input, { ambiente: 'restrita', numero: 1 }),
    );
  });
});
