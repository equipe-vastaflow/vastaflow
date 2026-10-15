import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML, type XMLFileInfo } from 'xmllint-wasm';

/** Esquemas OFICIAIS v1.01 (NFSe-ESQUEMAS_XSD v1.01, 09/02/2026), copiados sem alteracao. */
const XSD_DIR = join(__dirname, 'xsd');
export const DPS_SCHEMA_FILE = 'DPS_v1.01.xsd';

export interface XsdValidation {
  readonly valid: boolean;
  /** Mensagens do validador, limitadas. Citam elementos do esquema, nao dados da pessoa. */
  readonly errors: readonly string[];
}

let cache: { readonly main: XMLFileInfo; readonly others: readonly XMLFileInfo[] } | undefined;

/**
 * Em XSD, `^` e `$` NAO sao ancoras (a expressao ja e ancorada): sao caracteres literais. O esquema
 * oficial v1.01 tem UM padrao escrito assim (`TSSerieDPS`: `^0{0,4}\d{1,5}$`), que na pratica nao
 * casa com valor nenhum. Na copia EM MEMORIA as ancoras sao removidas, para o padrao valer como foi
 * pretendido; os arquivos em `xsd/` ficam exatamente como publicados.
 */
export function anchorlessPatterns(contents: string): string {
  return contents.replace(/(<xs:pattern\s+value=")\^([^"]*?)\$(")/g, '$1$2$3');
}

/** Carrega uma vez. O arquivo oficial pode trazer BOM: removido, o validador exige UTF-8 puro. */
function loadSchemas(): NonNullable<typeof cache> {
  if (cache === undefined) {
    const files = readdirSync(XSD_DIR)
      .filter((name) => name.endsWith('.xsd'))
      .map((name): XMLFileInfo => ({
        fileName: name,
        contents: anchorlessPatterns(
          readFileSync(join(XSD_DIR, name), 'utf8').replace(/^\uFEFF/, ''),
        ),
      }));
    const main = files.find((file) => file.fileName === DPS_SCHEMA_FILE);
    if (main === undefined) {
      throw new Error('Esquema da DPS ausente no pacote (xsd/)');
    }
    cache = { main, others: files.filter((file) => file.fileName !== DPS_SCHEMA_FILE) };
  }
  return cache;
}

/** Valida uma DPS (assinada ou nao) contra o esquema oficial. Nunca lanca por XML invalido. */
export async function validateDpsXml(xml: string): Promise<XsdValidation> {
  const { main, others } = loadSchemas();
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
