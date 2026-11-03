import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNfseInput, type NfseEmissionInput } from './nfse-dps';
import { buildDpsId, buildDpsXml, escapeXml, formatDhEmi } from './nfse-xml.builder';
import { anchorlessPatterns, validateDpsXml } from './nfse-xsd.validator';

const SETTINGS = {
  tpAmb: 2 as const,
  municipioEmissor: '3106200',
  prestadorCnpj: '11222333000181',
  prestadorIm: '123456',
  prestadorNome: 'Empresa Ficticia Ltda',
  opSimpNac: 3 as 1 | 2 | 3,
  regApTribSN: 1 as 1 | 2 | 3 | null,
  regEspTrib: 0 as const,
  serie: '00001',
  valorMaximo: '50000.00',
};
const NOW = new Date('2026-10-15T15:00:00Z');
const GOOD = {
  tomador: '52998224725',
  nome: 'Maria Teste',
  valor: '1500,50',
  servico: '010101',
  desc: 'Consultoria ficticia',
  iss: '1',
  ret: '1',
  local: '3106200',
  totsn: '12,5',
};

function input(
  over: Record<string, string> = {},
  settings: typeof SETTINGS = SETTINGS,
): NfseEmissionInput {
  const built = buildNfseInput({ ...GOOD, ...over }, settings, NOW);
  if (!built.ok) {
    throw new Error(`entrada invalida: ${built.errors.join(', ')}`);
  }
  return built.input;
}

describe('NFS-e - identificador e data', () => {
  it('Id da DPS: DPS + municipio(7) + tipo(1=CPF, 2=CNPJ) + inscricao(14) + serie(5) + numero(15) = 45', () => {
    const id = buildDpsId('3106200', '11222333000181', '00001', 7);
    expect(id).toBe('DPS310620021122233300018100001000000000000007');
    expect(id).toHaveLength(45);
    expect(id).toMatch(/^DPS[0-9]{42}$/);
  });

  it('dhEmi em horario de Brasilia, no formato do esquema', () => {
    expect(formatDhEmi(NOW)).toBe('2026-10-15T12:00:00-03:00');
  });

  it('escapa os cinco caracteres especiais do XML', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('NFS-e - DPS contra o esquema OFICIAL v1.01', () => {
  it('ME/EPP com tomador CPF: valida', async () => {
    const { xml } = buildDpsXml(input(), SETTINGS, 7, NOW, 'producao-2026-02');
    expect(await validateDpsXml(xml, 'producao-2026-02')).toEqual({ valid: true, errors: [] });
  });

  it('MEI com tomador CNPJ, aliquota e nao retido: valida', async () => {
    const settings = { ...SETTINGS, opSimpNac: 2 as const, regApTribSN: null };
    const { totsn: _unused, ...rest } = GOOD;
    const built = buildNfseInput(
      { ...rest, tomador: '11222333000181', aliq: '2,5' },
      settings,
      NOW,
    );
    if (!built.ok) {
      throw new Error(built.errors.join(','));
    }
    const { xml } = buildDpsXml(built.input, settings, 1, NOW, 'producao-2026-02');
    expect(xml).toContain('<CNPJ>11222333000181</CNPJ><xNome>');
    expect(xml).toContain('<indTotTrib>0</indTotTrib>');
    expect(xml).toContain('<pAliq>2.50</pAliq>');
    expect((await validateDpsXml(xml, 'producao-2026-02')).errors).toEqual([]);
  });

  it('nao optante (sem IBS/CBS) gera XML valido no esquema, mas a configuracao o bloqueia', async () => {
    const settings = { ...SETTINGS, opSimpNac: 1 as const, regApTribSN: null };
    const { totsn: _unused, ...rest } = GOOD;
    const built = buildNfseInput(rest, settings, NOW);
    if (!built.ok) {
      throw new Error(built.errors.join(','));
    }
    expect(
      (
        await validateDpsXml(
          buildDpsXml(built.input, settings, 1, NOW, 'producao-2026-02').xml,
          'producao-2026-02',
        )
      ).valid,
    ).toBe(true);
  });

  it('o numero e a serie saem sem zeros a esquerda onde o esquema pede, e o Id com zeros', () => {
    const { xml } = buildDpsXml(input(), SETTINGS, 7, NOW, 'producao-2026-02');
    expect(xml).toContain('<serie>1</serie><nDPS>7</nDPS>');
    expect(xml).toContain('Id="DPS310620021122233300018100001000000000000007"');
  });

  it('texto hostil na descricao e no nome nao altera a estrutura (injecao de XML)', async () => {
    const hostile = input({
      desc: '</xDescServ></cServ></serv><valores><vServPrest><vServ>0.01</vServ></vServPrest></valores><!-- &x; ]]>',
      nome: 'A</xNome><CPF>00000000000</CPF>"\'<b>',
    });
    const { xml } = buildDpsXml(hostile, SETTINGS, 1, NOW, 'producao-2026-02');
    expect(await validateDpsXml(xml, 'producao-2026-02')).toEqual({ valid: true, errors: [] });
    // O valor do servico continua o informado, e existe UM so elemento de cada.
    expect(xml.match(/<vServ>/g)).toHaveLength(1);
    expect(xml).toContain('<vServ>1500.50</vServ>');
    expect(xml.match(/<xNome>/g)).toHaveLength(2);
    expect(xml.match(/<CPF>/g)).toHaveLength(1);
  });

  it('o XML nao usa prefixo de namespace e declara UTF-8 (regras E1228 e E1229)', () => {
    const { xml } = buildDpsXml(
      input({ desc: 'Servico com acentuacao: coracao, pao' }),
      SETTINGS,
      1,
      NOW,
      'producao-2026-02',
    );
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse"',
      ),
    ).toBe(true);
    expect(xml).not.toMatch(/<[a-z0-9]+:[A-Za-z]/);
  });

  it('o esquema REJEITA o que viola o leiaute (o validador e a rede de seguranca)', async () => {
    const { xml } = buildDpsXml(input(), SETTINGS, 7, NOW, 'producao-2026-02');
    const cases: Array<[string, string]> = [
      ['ambiente invalido', xml.replace('<tpAmb>2</tpAmb>', '<tpAmb>3</tpAmb>')],
      ['CPF com 10 digitos', xml.replace('<CPF>52998224725</CPF>', '<CPF>5299822472</CPF>')],
      ['valor com 3 casas', xml.replace('<vServ>1500.50</vServ>', '<vServ>1500.505</vServ>')],
      ['valor com virgula', xml.replace('<vServ>1500.50</vServ>', '<vServ>1500,50</vServ>')],
      [
        'codigo de servico curto',
        xml.replace('<cTribNac>010101</cTribNac>', '<cTribNac>1101</cTribNac>'),
      ],
      [
        'elemento fora de ordem',
        xml.replace(
          '<tpEmit>1</tpEmit><cLocEmi>3106200</cLocEmi>',
          '<cLocEmi>3106200</cLocEmi><tpEmit>1</tpEmit>',
        ),
      ],
      ['elemento desconhecido', xml.replace('</infDPS>', '<extra>1</extra></infDPS>')],
      ['Id malformado', xml.replace(/Id="DPS\d{42}"/, 'Id="DPS123"')],
      ['sem tomador identificado', xml.replace('<xNome>Maria Teste</xNome>', '')],
      ['versao invalida', xml.replace('versao="1.01"', 'versao="9.99"')],
    ];
    for (const [name, broken] of cases) {
      const result = await validateDpsXml(broken, 'producao-2026-02');
      expect({ name, valid: result.valid }).toEqual({ name, valid: false });
    }
  });

  it('as mensagens do validador citam o esquema, nao os dados da pessoa', async () => {
    const { xml } = buildDpsXml(
      input({ nome: 'NOME-SIGILOSO-123' }),
      SETTINGS,
      7,
      NOW,
      'producao-2026-02',
    );
    const result = await validateDpsXml(
      xml.replace('<tpAmb>2</tpAmb>', '<tpAmb>3</tpAmb>'),
      'producao-2026-02',
    );
    expect(JSON.stringify(result.errors)).not.toContain('NOME-SIGILOSO-123');
  });
});

describe('NFS-e - pacote oficial de esquemas', () => {
  it('os arquivos .xsd sao os publicados (v1.01, 09/02/2026) e o unico ajuste e em memoria', () => {
    const dir = join(__dirname, 'xsd', 'producao-2026-02-09');
    const files = readdirSync(dir).filter((name) => name.endsWith('.xsd'));
    expect(files).toEqual(
      expect.arrayContaining([
        'DPS_v1.01.xsd',
        'tiposComplexos_v1.01.xsd',
        'tiposSimples_v1.01.xsd',
      ]),
    );
    // O arquivo oficial mantem as ancoras literais; so a copia em memoria as remove.
    const simples = readFileSync(join(dir, 'tiposSimples_v1.01.xsd'), 'utf8');
    expect(simples).toContain('value="^0{0,4}\\d{1,5}$"');
    expect(anchorlessPatterns(simples)).toContain('value="0{0,4}\\d{1,5}"');
    // So UM padrao tinha ancora: nada mais muda.
    expect(simples.replace(/\r?\n/g, '\n').split('\n').length).toBe(
      anchorlessPatterns(simples).replace(/\r?\n/g, '\n').split('\n').length,
    );
  });
});
