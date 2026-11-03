import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML, type XMLFileInfo } from 'xmllint-wasm';
import { getLayout, type NfseLayoutId } from './nfse-layout';

/**
 * Esquemas OFICIAIS, um pacote por leiaute (`xsd/<pasta>/`), copiados sem alteração:
 * - `producao-2026-02-09`: NFSe-ESQUEMAS_XSD v1.01, 09/02/2026 (produção);
 * - `restrita-2026-10-20`: pacote de produção restrita de 20/10/2026.
 * Os dois declaram `versao="1.01"`; quem escolhe o pacote é o `NfseLayoutId`, ver `nfse-layout.ts`.
 */
const XSD_DIR = join(__dirname, 'xsd');
export const DPS_SCHEMA_FILE = 'DPS_v1.01.xsd';

export interface XsdValidation {
  readonly valid: boolean;
  /** Mensagens do validador, limitadas. Citam elementos do esquema, nao dados da pessoa. */
  readonly errors: readonly string[];
}

interface LoadedSchemas {
  readonly main: XMLFileInfo;
  readonly others: readonly XMLFileInfo[];
}

const cache = new Map<NfseLayoutId, LoadedSchemas>();

/**
 * Em XSD, `^` e `$` NAO sao ancoras (a expressao ja e ancorada): sao caracteres literais. O esquema
 * de producao v1.01 tem UM padrao escrito assim (`TSSerieDPS`: `^0{0,4}\d{1,5}$`), que na pratica nao
 * casa com valor nenhum. Na copia EM MEMORIA as ancoras sao removidas, para o padrao valer como foi
 * pretendido; os arquivos em `xsd/` ficam exatamente como publicados. (O pacote da restrita ja traz o
 * padrao corrigido: a funcao nao o altera.)
 */
export function anchorlessPatterns(contents: string): string {
  return contents.replace(/(<xs:pattern\s+value=")\^([^"]*?)\$(")/g, '$1$2$3');
}

/** Pasta do pacote de um leiaute (para os testes de integridade). */
export function xsdPackageDir(layout: NfseLayoutId): string {
  return join(XSD_DIR, getLayout(layout).pasta);
}

const withoutBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Carrega uma vez por leiaute. O arquivo oficial pode trazer BOM: removido, o validador exige UTF-8 puro. */
function loadSchemas(layout: NfseLayoutId): LoadedSchemas {
  const cached = cache.get(layout);
  if (cached !== undefined) {
    return cached;
  }
  const dir = xsdPackageDir(layout);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.xsd'))
    .map((name): XMLFileInfo => ({
      fileName: name,
      contents: anchorlessPatterns(withoutBom(readFileSync(join(dir, name), 'utf8'))),
    }));
  const main = files.find((file) => file.fileName === DPS_SCHEMA_FILE);
  if (main === undefined) {
    throw new Error('Esquema da DPS ausente no pacote (xsd/)');
  }
  const loaded = { main, others: files.filter((file) => file.fileName !== DPS_SCHEMA_FILE) };
  cache.set(layout, loaded);
  return loaded;
}

/**
 * Valida uma DPS (assinada ou nao) contra o esquema oficial do LEIAUTE informado. O leiaute e
 * obrigatorio (sem valor padrao): quem chama o escolhe pelo ambiente (`layoutForAmbiente`). Nunca
 * lanca por XML invalido.
 */
export async function validateDpsXml(xml: string, layout: NfseLayoutId): Promise<XsdValidation> {
  const { main, others } = loadSchemas(layout);
  const result = await validateXML({
    xml: { fileName: 'dps.xml', contents: xml },
    schema: main,
    preload: others,
  });
  return {
    valid: result.valid,
    errors: result.errors.slice(0, 5).map((error) => error.message.slice(0, 300)),
  };
}
