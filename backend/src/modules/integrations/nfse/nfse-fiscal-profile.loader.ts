import { readFileSync, statSync } from 'node:fs';
import { parseFiscalProfiles, type ParsedProfiles } from './nfse-fiscal-profile';

/** Arquivo de perfis e pequeno (dezenas de servicos no maximo): acima disso e erro, nao dado. */
export const PROFILES_FILE_MAX_BYTES = 512 * 1024;

/**
 * Le o arquivo de perfis fiscais (`NFSE_PERFIS_FISCAIS_PATH`, fora do repositorio e montado somente leitura,
 * como o certificado). Lido a CADA pedido e a CADA transmissao: uma revogacao ou uma alteracao do arquivo vale
 * na hora, sem reiniciar. Falha de leitura vira problema fixo: o caminho e o conteudo nunca sao repetidos.
 */
export function loadFiscalProfiles(path: string): ParsedProfiles {
  const unreadable: ParsedProfiles = {
    perfis: [],
    problems: ['arquivo de perfis fiscais ilegivel'],
  };
  try {
    if (statSync(path).size > PROFILES_FILE_MAX_BYTES) {
      return { perfis: [], problems: ['arquivo de perfis fiscais grande demais'] };
    }
    return parseFiscalProfiles(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return unreadable;
  }
}
