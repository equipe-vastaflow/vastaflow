import { approvedProfile, SYNTHETIC_ADDRESS } from '../../../../test/support/nfse-profile-fixtures';
import {
  buildNfseInput,
  confirmationFingerprint,
  parseAddressArgs,
  parseNfseArgs,
  summarizeInput,
  type NfseEmissionInput,
} from './nfse-dps';
import { buildFiscalSnapshot, type NfseFiscalProfile } from './nfse-fiscal-profile';

/** Endereco do tomador pelos argumentos do comando e impressao digital da confirmacao. Tudo SINTETICO. */
const SETTINGS = { opSimpNac: 1 as 1 | 2 | 3, regEspTrib: 0 as const, valorMaximo: '5000.00' };
const NOW = new Date('2026-10-15T15:00:00Z');
const GOOD = {
  tomador: '529.982.247-25',
  nome: 'Maria Teste',
  valor: '1500,50',
  servico: '010301',
  desc: 'Servico ficticio',
  iss: '1',
  ret: '1',
  local: '3106200',
};

describe('NFS-e - endereco do tomador pelos argumentos do comando', () => {
  const ADDRESS_ARGS = {
    cmun: '3106200',
    cep: '30000-000',
    logradouro: 'Rua Ficticia',
    numero: '100',
    bairro: 'Bairro Ficticio',
  };

  it('os argumentos do endereco sao reconhecidos pelo leitor de argumentos', () => {
    const parsed = parseNfseArgs(
      'cmun=3106200 cep=30000-000 logradouro="Rua Ficticia" numero=100 bairro="Bairro Ficticio" compl="Sala 1"',
    );

    expect(parsed).toEqual({ ok: true, fields: { ...ADDRESS_ARGS, compl: 'Sala 1' } });
  });

  it('sem nenhum argumento de endereco: sem endereco (null), sem erro', () => {
    expect(parseAddressArgs({})).toEqual({ ok: true, endereco: null });
    expect(parseAddressArgs({ tomador: '52998224725' })).toEqual({ ok: true, endereco: null });
  });

  it('endereco completo: normaliza o CEP e trata o complemento opcional', () => {
    expect(parseAddressArgs(ADDRESS_ARGS)).toEqual({
      ok: true,
      endereco: {
        cMun: '3106200',
        cep: '30000000',
        logradouro: 'Rua Ficticia',
        numero: '100',
        complemento: null,
        bairro: 'Bairro Ficticio',
      },
    });
    const withComplement = parseAddressArgs({
      ...ADDRESS_ARGS,
      cep: '30.000-000',
      compl: ' Sala 1 ',
    });
    expect(withComplement.ok && withComplement.endereco?.complemento).toBe('Sala 1');
    expect(withComplement.ok && withComplement.endereco?.cep).toBe('30000000');
  });

  it('endereco pela metade nao e aceito: cada campo que falta e citado pelo NOME DO ARGUMENTO', () => {
    const result = parseAddressArgs({ cep: '30000000' });

    expect(result.ok).toBe(false);
    const text = JSON.stringify(!result.ok && result.errors);
    for (const campo of ['cmun', 'logradouro', 'numero', 'bairro']) {
      expect(text).toContain(`endereco do tomador: ${campo}`);
    }
    expect(text).not.toContain('cMun');
    expect(text).not.toContain('complemento');
  });

  it.each([
    ['cmun com 6 digitos', { cmun: '310620' }, 'cmun deve ter 7 digitos'],
    ['cmun com letra', { cmun: '310620A' }, 'cmun deve ter 7 digitos'],
    ['cep com 7 digitos', { cep: '3000000' }, 'cep deve ter 8 digitos'],
    ['cep com letra', { cep: '3000000A' }, 'cep deve ter 8 digitos'],
    ['logradouro acima de 255', { logradouro: 'x'.repeat(256) }, 'logradouro invalido'],
    ['numero acima de 60', { numero: '1'.repeat(61) }, 'numero invalido'],
    ['bairro vazio', { bairro: '   ' }, 'bairro invalido'],
    ['complemento acima de 156', { compl: 'x'.repeat(157) }, 'compl invalido'],
    ['logradouro com quebra de linha', { logradouro: 'Rua\nFicticia' }, 'logradouro invalido'],
    ['numero com caractere de controle', { numero: '10\u0007' }, 'numero invalido'],
  ])('%s: recusa e cita so o nome do campo', (_nome, over, mensagem) => {
    const result = parseAddressArgs({ ...ADDRESS_ARGS, ...over });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual([`endereco do tomador: ${mensagem}`]);
  });

  it('o valor invalido nunca e repetido na mensagem', () => {
    expect(
      JSON.stringify(parseAddressArgs({ ...ADDRESS_ARGS, cep: 'VALOR-SIGILOSO' })),
    ).not.toContain('SIGILOSO');
  });

  it('numero "S/N" e aceito (texto livre ate 60 caracteres)', () => {
    expect(parseAddressArgs({ ...ADDRESS_ARGS, numero: 'S/N' }).ok).toBe(true);
  });
});

describe('NFS-e - impressao digital da confirmacao', () => {
  const ctx = { ambiente: 'restrita' as const, numero: 7 };
  const base = (): NfseEmissionInput => {
    const built = buildNfseInput(GOOD, SETTINGS, NOW);
    if (!built.ok) {
      throw new Error(built.errors.join(','));
    }
    return built.input;
  };
  const fiscal = (over: Partial<NfseFiscalProfile> = {}): NfseEmissionInput => {
    const snapshot = buildFiscalSnapshot(approvedProfile(over), {
      valor: '1500.50',
      tribIssqn: 1,
      tpRetIssqn: 1,
    });
    if (!snapshot.ok) {
      throw new Error(snapshot.errors.join(','));
    }
    return { ...base(), tomadorEndereco: SYNTHETIC_ADDRESS, fiscal: snapshot.snapshot };
  };
  /** Altera um pedaco do instantaneo fiscal (o campo `fiscal` existe: foi montado acima). */
  const withFiscal = (
    input: NfseEmissionInput,
    change: (
      f: NonNullable<NfseEmissionInput['fiscal']>,
    ) => NonNullable<NfseEmissionInput['fiscal']>,
  ): NfseEmissionInput => {
    if (input.fiscal == null) {
      throw new Error('sem fiscal');
    }
    return { ...input, fiscal: change(input.fiscal) };
  };

  it('e deterministica e muda com o numero e com o ambiente do pedido', () => {
    const a = confirmationFingerprint(base(), ctx);

    expect(a).toBe(confirmationFingerprint(base(), ctx));
    expect(a).not.toBe(confirmationFingerprint(base(), { ...ctx, numero: 8 }));
    expect(a).not.toBe(confirmationFingerprint(base(), { ...ctx, ambiente: 'producao' }));
  });

  it('cobre o que o resumo MOSTRA: mudar o valor ou o tomador muda a impressao', () => {
    const a = confirmationFingerprint(base(), ctx);

    expect(confirmationFingerprint({ ...base(), valor: '1500.51' }, ctx)).not.toBe(a);
    expect(confirmationFingerprint({ ...base(), tomadorDoc: '11144477735' }, ctx)).not.toBe(a);
  });

  it.each([
    [
      'logradouro do endereco (o resumo so mostra municipio e CEP parcial)',
      (i: NfseEmissionInput) => ({
        ...i,
        tomadorEndereco: { ...SYNTHETIC_ADDRESS, logradouro: 'Rua Outra' },
      }),
    ],
    [
      'numero do endereco',
      (i: NfseEmissionInput) => ({
        ...i,
        tomadorEndereco: { ...SYNTHETIC_ADDRESS, numero: '101' },
      }),
    ],
    [
      'indFinal (nao aparece no resumo)',
      (i: NfseEmissionInput) =>
        withFiscal(i, (f) => ({ ...f, ibscbs: { ...f.ibscbs, indFinal: 1 } })),
    ],
    [
      'tpRetPisCofins (nao aparece no resumo)',
      (i: NfseEmissionInput) =>
        withFiscal(i, (f) => ({
          ...f,
          tribFed: f.tribFed && { ...f.tribFed, piscofins: { cst: '99', tpRetPisCofins: '1' } },
        })),
    ],
    ['cNBS', (i: NfseEmissionInput) => withFiscal(i, (f) => ({ ...f, cNBS: '188888889' }))],
    [
      'versao do perfil',
      (i: NfseEmissionInput) =>
        withFiscal(i, (f) => ({ ...f, perfil: { ...f.perfil, versao: 2 } })),
    ],
    [
      'hash do perfil',
      (i: NfseEmissionInput) =>
        withFiscal(i, (f) => ({ ...f, perfil: { ...f.perfil, conteudoSha256: 'f'.repeat(64) } })),
    ],
    [
      'total de tributos',
      (i: NfseEmissionInput) => withFiscal(i, (f) => ({ ...f, totTrib: { tipo: 'indicador' } })),
    ],
  ])('cobre TAMBEM o que o resumo nao mostra: %s', (_nome, change) => {
    const original = fiscal();

    expect(confirmationFingerprint(change(original), ctx)).not.toBe(
      confirmationFingerprint(original, ctx),
    );
  });

  it('o resumo do nao optante traz perfil, codigos, IBS/CBS, retencoes, total de tributos e endereco parcial', () => {
    const summary = summarizeInput(fiscal(), ctx);

    expect(summary).toContain(
      'Perfil fiscal: servico-sintetico v1 (aprovado por Contadora Ficticia em 01/10/2026; ref. ',
    );
    expect(summary).toContain('Codigos: cTribNac 010301, cTribMun 777, NBS 101011100');
    expect(summary).toContain('IBS/CBS: CST 288, cClassTrib 288888, cIndOp 100301, indDest 0');
    expect(summary).toContain('Tributos federais: PIS/COFINS CST 99, IRRF R$ 22,51, CSLL R$ 30,01');
    expect(summary).toContain(
      'Total aproximado de tributos: federal R$ 150,05, estadual R$ 75,03, municipal R$ 37,51',
    );
    expect(summary).toMatch(
      /Endereco do tomador: municipio 3106200, CEP 30000-\*\*\* \(ref\. [0-9a-f]{8}\)/,
    );
    expect(summary).not.toMatch(/Rua Ficticia|Bairro Ficticio|30000000|52998224725/);
  });

  it('o resumo de ME/EPP nao ganha linhas fiscais (comportamento anterior preservado)', () => {
    expect(summarizeInput(base(), ctx)).not.toMatch(
      /Perfil fiscal|IBS\/CBS|Tributos federais|Endereco/,
    );
  });
});
