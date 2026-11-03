import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNfseInput } from './nfse-dps';
import { NFSE_LAYOUTS, type NfseLayoutId } from './nfse-layout';
import { buildDpsXml } from './nfse-xml.builder';
import { validateDpsXml, xsdPackageDir } from './nfse-xsd.validator';

/**
 * Pacotes XSD oficiais por leiaute: integridade (arquivos intactos) e comportamento (cada ambiente valida
 * contra o SEU pacote e rejeita o que e do outro). So documentos SINTETICOS: CNPJ, CPF e nomes ficticios,
 * derivados do gerador atual. Nenhuma NFS-e real e usada.
 */
const XSD_ROOT = join(__dirname, 'xsd');
const PRODUCAO: NfseLayoutId = 'producao-2026-02';
const RESTRITA: NfseLayoutId = 'restrita-2026-10';

interface Manifest {
  pacotes: Record<string, { zipOficialSha256: string; arquivos: Record<string, string> }>;
}
const manifest = JSON.parse(readFileSync(join(XSD_ROOT, 'MANIFEST.json'), 'utf8')) as Manifest;

/** SHA-256 apos normalizar o fim de linha para LF (o repositorio fixa LF; o oficial pode vir em CRLF). */
const sha256 = (arquivo: string): string =>
  createHash('sha256')
    .update(Buffer.from(readFileSync(arquivo, 'latin1').replace(/\r\n/g, '\n'), 'latin1'))
    .digest('hex');

describe('NFS-e - pacotes XSD oficiais (integridade)', () => {
  it.each(Object.values(NFSE_LAYOUTS))(
    '$id: o manifesto e a pasta do pacote coincidem',
    (layout) => {
      const pasta = xsdPackageDir(layout.id);
      const noDisco = readdirSync(pasta).sort();
      const noManifesto = Object.keys(manifest.pacotes[layout.pasta]?.arquivos ?? {}).sort();

      expect(noManifesto.length).toBeGreaterThanOrEqual(10);
      expect(noDisco).toEqual(noManifesto);
    },
  );

  it.each(Object.values(NFSE_LAYOUTS))(
    '$id: nenhum arquivo oficial foi alterado (SHA-256)',
    (layout) => {
      const pasta = xsdPackageDir(layout.id);
      for (const [arquivo, esperado] of Object.entries(
        manifest.pacotes[layout.pasta]?.arquivos ?? {},
      )) {
        expect({ arquivo, sha256: sha256(join(pasta, arquivo)) }).toEqual({
          arquivo,
          sha256: esperado,
        });
      }
    },
  );

  it.each(Object.values(NFSE_LAYOUTS))(
    '$id: o pacote traz a DPS e todas as dependencias (include/import resolvem na propria pasta)',
    (layout) => {
      const pasta = xsdPackageDir(layout.id);
      const arquivos = new Set(readdirSync(pasta));
      expect(arquivos.has('DPS_v1.01.xsd')).toBe(true);
      for (const arquivo of arquivos) {
        const xsd = readFileSync(join(pasta, arquivo), 'utf8');
        for (const [, local] of xsd.matchAll(/schemaLocation="([^"]+)"/g)) {
          expect({ arquivo, local, existe: arquivos.has(local ?? '') }).toEqual({
            arquivo,
            local,
            existe: true,
          });
        }
      }
    },
  );

  it('os dois pacotes sao distintos (um nao e copia do outro)', () => {
    const [a, b] = [PRODUCAO, RESTRITA].map((id) =>
      sha256(join(xsdPackageDir(id), 'tiposComplexos_v1.01.xsd')),
    );
    expect(a).not.toBe(b);
  });
});

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
const ARGS = {
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

/** DPS do gerador ATUAL (leiaute de producao). */
function dpsDoGeradorAtual(): string {
  const built = buildNfseInput(ARGS, SETTINGS, NOW);
  if (!built.ok) {
    throw new Error(built.errors.join(','));
  }
  return buildDpsXml(built.input, SETTINGS, 7, NOW).xml;
}

/** O que muda no leiaute da restrita: `finNFSe` passa a ser obrigatorio direto em `infDPS`. */
const comFinNfseNoInfDps = (xml: string): string =>
  xml.replace('<tpEmit>1</tpEmit>', '<tpEmit>1</tpEmit><finNFSe>0</finNFSe>');

/** CNPJ ALFANUMERICO (ficticio): so o pacote da restrita o aceita no tipo e no Id da DPS. */
const CNPJ_ALFA = '1A2B3C4D5E6F78';
const comCnpjAlfanumerico = (xml: string): string => xml.split('11222333000181').join(CNPJ_ALFA);

describe('NFS-e - cada ambiente valida contra o SEU pacote (documentos sinteticos)', () => {
  it('DPS do gerador atual: valida no leiaute de PRODUCAO', async () => {
    expect(await validateDpsXml(dpsDoGeradorAtual(), PRODUCAO)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('a mesma DPS e REJEITADA pelo leiaute da RESTRITA (falta finNFSe em infDPS)', async () => {
    const resultado = await validateDpsXml(dpsDoGeradorAtual(), RESTRITA);

    expect(resultado.valid).toBe(false);
    expect(resultado.errors.join(' ')).toContain('finNFSe');
  });

  it('DPS no formato da restrita (finNFSe em infDPS): valida na RESTRITA e e rejeitada em PRODUCAO', async () => {
    const xml = comFinNfseNoInfDps(dpsDoGeradorAtual());

    expect(await validateDpsXml(xml, RESTRITA)).toEqual({ valid: true, errors: [] });
    const producao = await validateDpsXml(xml, PRODUCAO);
    expect(producao.valid).toBe(false);
    expect(producao.errors.join(' ')).toContain('finNFSe');
  });

  it('as duas variantes declaram versao="1.01": a versao nao diz qual pacote vale', () => {
    const atual = dpsDoGeradorAtual();
    const restrita = comFinNfseNoInfDps(atual);

    expect(atual).toContain('versao="1.01"');
    expect(restrita).toContain('versao="1.01"');
  });

  it('CNPJ alfanumerico: aceito so no leiaute da RESTRITA', async () => {
    const xml = comCnpjAlfanumerico(comFinNfseNoInfDps(dpsDoGeradorAtual()));

    expect(xml).toContain(`<CNPJ>${CNPJ_ALFA}</CNPJ>`);
    expect(await validateDpsXml(xml, RESTRITA)).toEqual({ valid: true, errors: [] });
    expect((await validateDpsXml(xml, PRODUCAO)).valid).toBe(false);
  });

  it('a producao continua rejeitando CNPJ alfanumerico mesmo sem finNFSe (o gerador atual nao o produz)', async () => {
    const resultado = await validateDpsXml(comCnpjAlfanumerico(dpsDoGeradorAtual()), PRODUCAO);

    expect(resultado.valid).toBe(false);
  });

  it('serie de 5 digitos: valida nos dois pacotes (a restrita traz o padrao corrigido, a producao a copia em memoria)', async () => {
    const xml = dpsDoGeradorAtual().replace('<serie>1</serie>', '<serie>45000</serie>');

    expect((await validateDpsXml(xml, PRODUCAO)).errors).toEqual([]);
    // Na restrita o unico erro esperado continua sendo finNFSe, nunca a serie.
    const restrita = await validateDpsXml(comFinNfseNoInfDps(xml), RESTRITA);
    expect(restrita).toEqual({ valid: true, errors: [] });
  });

  it('XML malformado e rejeitado nos dois leiautes, sem lancar', async () => {
    for (const layout of [PRODUCAO, RESTRITA]) {
      const resultado = await validateDpsXml(
        '<DPS xmlns="http://www.sped.fazenda.gov.br/nfse">',
        layout,
      );
      expect(resultado.valid).toBe(false);
    }
  });
});
