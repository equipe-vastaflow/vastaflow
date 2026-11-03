import {
  approvedProfile,
  SYNTHETIC_ADDRESS,
  SYNTHETIC_SERVICE,
} from '../../../../test/support/nfse-profile-fixtures';
import { buildNfseInput, type NfseEmissionInput } from './nfse-dps';
import { buildFiscalSnapshot, type NfseFiscalProfile } from './nfse-fiscal-profile';
import type { NfseLayoutId } from './nfse-layout';
import { buildDpsXml } from './nfse-xml.builder';
import { validateDpsXml } from './nfse-xsd.validator';

/**
 * DPS de empresa NAO optante (perfil fiscal) nos dois leiautes. Dados SINTETICOS: CNPJ, CPF, endereco e codigos
 * inventados, so no formato do esquema. Nenhum valor vem de nota real.
 */
const PRODUCAO: NfseLayoutId = 'producao-2026-02';
const RESTRITA: NfseLayoutId = 'restrita-2026-10';
const NOW = new Date('2026-10-15T15:00:00Z');

const SETTINGS = {
  tpAmb: 2 as const,
  municipioEmissor: '3106200',
  prestadorCnpj: '11222333000181',
  prestadorIm: null,
  prestadorNome: null,
  opSimpNac: 1 as 1 | 2 | 3,
  regApTribSN: null,
  regEspTrib: 0 as const,
  serie: '00001',
  valorMaximo: '50000.00',
};
const ARGS = {
  tomador: '52998224725',
  nome: 'Maria Teste',
  valor: '1500,50',
  servico: SYNTHETIC_SERVICE,
  desc: 'Servico ficticio',
  iss: '1',
  ret: '1',
  local: '3106200',
};

function inputFor(
  profile: NfseFiscalProfile = approvedProfile(),
  withAddress: boolean | typeof SYNTHETIC_ADDRESS = true,
): NfseEmissionInput {
  const built = buildNfseInput(ARGS, SETTINGS, NOW);
  if (!built.ok) {
    throw new Error(built.errors.join(','));
  }
  const snapshot = buildFiscalSnapshot(profile, built.input);
  if (!snapshot.ok) {
    throw new Error(snapshot.errors.join(','));
  }
  return {
    ...built.input,
    fiscal: snapshot.snapshot,
    tomadorEndereco:
      withAddress === false ? null : withAddress === true ? SYNTHETIC_ADDRESS : withAddress,
  };
}

const build = (input: NfseEmissionInput, layout: NfseLayoutId): string =>
  buildDpsXml(input, SETTINGS, 7, NOW, layout).xml;

describe('NFS-e - DPS do nao optante: valida no leiaute de CADA ambiente', () => {
  it.each([PRODUCAO, RESTRITA])(
    '%s: DPS completa (perfil + endereco + IBS/CBS) valida',
    async (layout) => {
      expect(await validateDpsXml(build(inputFor(), layout), layout)).toEqual({
        valid: true,
        errors: [],
      });
    },
  );

  it('a DPS gerada para um leiaute e REJEITADA pelo outro (finNFSe e a estrutura de CST/cClassTrib mudam de lugar)', async () => {
    const producao = build(inputFor(), PRODUCAO);
    const restrita = build(inputFor(), RESTRITA);

    expect((await validateDpsXml(producao, RESTRITA)).valid).toBe(false);
    expect((await validateDpsXml(restrita, PRODUCAO)).valid).toBe(false);
  });

  it.each([
    [
      'sem cTribMun',
      { servico: { cTribNac: SYNTHETIC_SERVICE, cTribMun: null, cNBS: '101011100' } },
    ],
    ['sem indFinal', { ibscbs: { ...approvedProfile().ibscbs, indFinal: null } }],
    [
      'com tpOper e tpEnteGov (operacao com ente governamental)',
      { ibscbs: { ...approvedProfile().ibscbs, tpOper: 1 as const, tpEnteGov: 2 as const } },
    ],
    ['sem tributos federais', { tribFed: null }],
    [
      'so PIS/COFINS',
      { tribFed: { piscofins: { cst: '99', tpRetPisCofins: null }, retencoes: null } },
    ],
    [
      'so retencoes',
      {
        tribFed: { piscofins: null, retencoes: { cpPct: '11.00', irrfPct: null, csllPct: '1.00' } },
      },
    ],
    ['total de tributos: indicador', { totTrib: { tipo: 'indicador' as const } }],
    [
      'total de tributos: percentuais',
      { totTrib: { tipo: 'percentuais' as const, fed: '13.45', est: '0.00', mun: '2.50' } },
    ],
    ['indDest 1', { ibscbs: { ...approvedProfile().ibscbs, indDest: 1 as const } }],
  ])('variante %s: valida nos dois leiautes', async (_nome, over) => {
    const input = inputFor(approvedProfile(over));
    for (const layout of [PRODUCAO, RESTRITA]) {
      expect(await validateDpsXml(build(input, layout), layout)).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it('endereco com complemento e caracteres especiais e escapado e valida', async () => {
    const input = inputFor(approvedProfile(), {
      ...SYNTHETIC_ADDRESS,
      logradouro: 'Rua A & B <Teste>',
      complemento: 'Sala "12"',
    });

    for (const layout of [PRODUCAO, RESTRITA]) {
      const xml = build(input, layout);
      expect(xml).toContain('<xLgr>Rua A &amp; B &lt;Teste&gt;</xLgr>');
      expect(xml).toContain('<xCpl>Sala &quot;12&quot;</xCpl>');
      expect((await validateDpsXml(xml, layout)).valid).toBe(true);
    }
  });
});

describe('NFS-e - posicao e obrigatoriedade dos campos em cada leiaute', () => {
  const xmlProducao = build(inputFor(), PRODUCAO);
  const xmlRestrita = build(inputFor(), RESTRITA);

  it('producao: finNFSe DENTRO do grupo IBSCBS (primeiro elemento), nunca direto em infDPS', () => {
    expect(xmlProducao).toMatch(/<IBSCBS><finNFSe>0<\/finNFSe><indFinal>0<\/indFinal><cIndOp>/);
    expect(xmlProducao).not.toMatch(/<tpEmit>1<\/tpEmit><finNFSe>/);
    expect(xmlProducao.match(/<finNFSe>/g)).toHaveLength(1);
  });

  it('restrita: finNFSe em infDPS (depois de tpEmit), e FORA do grupo IBSCBS', () => {
    expect(xmlRestrita).toContain('<tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>');
    expect(xmlRestrita).toMatch(/<IBSCBS><indFinal>0<\/indFinal><cIndOp>/);
    expect(xmlRestrita.match(/<finNFSe>/g)).toHaveLength(1);
  });

  it('producao: CST e cClassTrib dentro de valores/trib/gIBSCBS', () => {
    expect(xmlProducao).toContain(
      '<valores><trib><gIBSCBS><CST>288</CST><cClassTrib>288888</cClassTrib></gIBSCBS></trib></valores></IBSCBS>',
    );
  });

  it('restrita: CST e cClassTrib sobem para valores/trib (sem gIBSCBS)', () => {
    expect(xmlRestrita).toContain(
      '<valores><trib><CST>288</CST><cClassTrib>288888</cClassTrib></trib></valores></IBSCBS>',
    );
    expect(xmlRestrita).not.toContain('<gIBSCBS>');
  });

  it('ordem de cServ: producao (cTribNac, cTribMun, xDescServ, cNBS) x restrita (cTribNac, cTribMun, cNBS, xDescServ)', () => {
    expect(xmlProducao).toContain(
      `<cServ><cTribNac>${SYNTHETIC_SERVICE}</cTribNac><cTribMun>777</cTribMun><xDescServ>Servico ficticio</xDescServ><cNBS>101011100</cNBS></cServ>`,
    );
    expect(xmlRestrita).toContain(
      `<cServ><cTribNac>${SYNTHETIC_SERVICE}</cTribNac><cTribMun>777</cTribMun><cNBS>101011100</cNBS><xDescServ>Servico ficticio</xDescServ></cServ>`,
    );
  });

  it.each([
    [PRODUCAO, xmlProducao],
    [RESTRITA, xmlRestrita],
  ])('%s: ordem de toma/end, tribMun, tribFed, totTrib e IBSCBS', (_layout, xml) => {
    expect(xml).toContain(
      '<toma><CPF>52998224725</CPF><xNome>Maria Teste</xNome><end><endNac><cMun>3106200</cMun><CEP>30000000</CEP></endNac><xLgr>Rua Ficticia</xLgr><nro>100</nro><xBairro>Bairro Ficticio</xBairro></end></toma>',
    );
    expect(xml).toContain(
      '</tribMun><tribFed><piscofins><CST>99</CST><tpRetPisCofins>9</tpRetPisCofins></piscofins>',
    );
    expect(xml).toContain(
      '<vRetIRRF>22.51</vRetIRRF><vRetCSLL>30.01</vRetCSLL></tribFed><totTrib><vTotTrib>',
    );
    expect(xml).toContain(
      '<vTotTribFed>150.05</vTotTribFed><vTotTribEst>75.03</vTotTribEst><vTotTribMun>37.51</vTotTribMun></vTotTrib></totTrib></trib></valores><IBSCBS>',
    );
    // tpOper e tpEnteGov so entram quando o perfil os define.
    expect(xml).not.toMatch(/<tpOper>|<tpEnteGov>/);
  });

  it('tpOper e tpEnteGov, quando definidos, entram entre cIndOp e indDest, nessa ordem', () => {
    const xml = build(
      inputFor(
        approvedProfile({ ibscbs: { ...approvedProfile().ibscbs, tpOper: 1, tpEnteGov: 2 } }),
      ),
      PRODUCAO,
    );

    expect(xml).toMatch(
      /<cIndOp>100301<\/cIndOp><tpOper>1<\/tpOper><tpEnteGov>2<\/tpEnteGov><indDest>0<\/indDest>/,
    );
  });

  it('obrigatoriedade: o esquema recusa a DPS sem indDest ou sem CST (nos dois leiautes)', async () => {
    for (const [layout, xml] of [
      [PRODUCAO, xmlProducao],
      [RESTRITA, xmlRestrita],
    ] as const) {
      expect((await validateDpsXml(xml.replace('<indDest>0</indDest>', ''), layout)).valid).toBe(
        false,
      );
      expect((await validateDpsXml(xml.replace('<CST>288</CST>', ''), layout)).valid).toBe(false);
    }
  });

  it('obrigatoriedade: finNFSe ausente e recusado em cada leiaute, na posicao que ele exige', async () => {
    expect(
      (await validateDpsXml(xmlProducao.replace('<finNFSe>0</finNFSe>', ''), PRODUCAO)).valid,
    ).toBe(false);
    expect(
      (await validateDpsXml(xmlRestrita.replace('<finNFSe>0</finNFSe>', ''), RESTRITA)).valid,
    ).toBe(false);
  });

  it('producao exige cIndOp no grupo IBSCBS; a restrita o aceita ausente', async () => {
    const semCIndOpProducao = xmlProducao.replace('<cIndOp>100301</cIndOp>', '');
    const semCIndOpRestrita = xmlRestrita.replace('<cIndOp>100301</cIndOp>', '');

    expect((await validateDpsXml(semCIndOpProducao, PRODUCAO)).valid).toBe(false);
    expect((await validateDpsXml(semCIndOpRestrita, RESTRITA)).valid).toBe(true);
  });

  it('formato dos codigos e imposto pelo esquema: CST de 2 digitos e cClassTrib de 5 sao recusados', async () => {
    for (const [layout, xml] of [
      [PRODUCAO, xmlProducao],
      [RESTRITA, xmlRestrita],
    ] as const) {
      expect(
        (await validateDpsXml(xml.replace('<CST>288</CST>', '<CST>28</CST>'), layout)).valid,
      ).toBe(false);
      expect(
        (
          await validateDpsXml(
            xml.replace('<cClassTrib>288888</cClassTrib>', '<cClassTrib>28888</cClassTrib>'),
            layout,
          )
        ).valid,
      ).toBe(false);
    }
  });
});

describe('NFS-e - ME/EPP (sem perfil): o resultado anterior e preservado', () => {
  const SIMPLES = { ...SETTINGS, opSimpNac: 3 as const, regApTribSN: 1 as const };
  const simples = (layout: NfseLayoutId): string => {
    const built = buildNfseInput({ ...ARGS, totsn: '12,5' }, SIMPLES, NOW);
    if (!built.ok) {
      throw new Error(built.errors.join(','));
    }
    return buildDpsXml(built.input, SIMPLES, 7, NOW, layout).xml;
  };

  it('producao: sem IBSCBS, sem tribFed, sem cNBS e sem endereco, como antes', async () => {
    const xml = simples(PRODUCAO);

    expect(xml).not.toMatch(/<IBSCBS>|<tribFed>|<cNBS>|<cTribMun>|<end>|<finNFSe>/);
    expect(xml).toContain('<totTrib><pTotTribSN>12.50</pTotTribSN></totTrib>');
    expect((await validateDpsXml(xml, PRODUCAO)).valid).toBe(true);
  });

  it('restrita: a unica diferenca e o finNFSe em infDPS (exigido em toda DPS desse leiaute)', async () => {
    const xml = simples(RESTRITA);

    expect(xml).toContain('<tpEmit>1</tpEmit><finNFSe>0</finNFSe>');
    expect(xml).not.toMatch(/<IBSCBS>|<tribFed>|<cNBS>|<end>/);
    expect(xml.replace('<finNFSe>0</finNFSe>', '')).toBe(simples(PRODUCAO));
    expect((await validateDpsXml(xml, RESTRITA)).valid).toBe(true);
  });

  it('a DPS e deterministica: mesma entrada, mesmo XML', () => {
    expect(simples(RESTRITA)).toBe(simples(RESTRITA));
    expect(build(inputFor(), PRODUCAO)).toBe(build(inputFor(), PRODUCAO));
  });
});
