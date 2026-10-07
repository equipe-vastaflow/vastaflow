import { readFileSync } from 'node:fs';

/**
 * De onde vem a CA que valida o certificado do servidor MySQL.
 *
 * Duas formas, e EXATAMENTE UMA por vez:
 *
 * - `DATABASE_SSL_CA` - o conteudo PEM, inline. Serve para gerenciadores de
 *   segredo que entregam valor, e foi a unica forma durante a Fase 1;
 * - `DATABASE_SSL_CA_FILE` - o caminho de um arquivo montado. E a forma
 *   adequada a container: um PEM e multilinha, e valor multilinha em arquivo
 *   `.env` lido pelo Compose e fragil. Montar o arquivo somente-leitura e o
 *   padrao da industria (`*_FILE` e a convencao que as proprias imagens
 *   oficiais de MySQL e PostgreSQL usam, e secrets de Docker e Kubernetes sao
 *   arquivos).
 *
 * "Exatamente uma" em vez de precedencia, de proposito: com precedencia, quem
 * configurasse as duas por engano ficaria sem saber qual esta em uso, e a
 * descoberta viria de um comportamento estranho em producao. Recusar no boot e
 * mais barato.
 *
 * A leitura de arquivo mora AQUI, isolada, e nao em `buildDataSourceOptions`
 * nem em `validateEnv`: a montagem das opcoes e a validacao de ambiente
 * continuam sem I/O, e este modulo pequeno e testavel com um arquivo temporario.
 */

/** Nenhuma das duas variaveis foi informada. */
export const MISSING_CA_MESSAGE =
  'DATABASE_SSL=true exige a CA do servidor MySQL: informe DATABASE_SSL_CA (conteudo PEM) ou DATABASE_SSL_CA_FILE (caminho de um arquivo montado)';

/** As duas foram informadas ao mesmo tempo. */
export const AMBIGUOUS_CA_MESSAGE =
  'informe DATABASE_SSL_CA ou DATABASE_SSL_CA_FILE, nunca as duas (nao ha precedencia: a configuracao e ambigua)';

/** O arquivo apontado nao pode ser lido. O caminho entra na mensagem; o conteudo nunca. */
export function unreadableCaMessage(file: string): string {
  return `DATABASE_SSL_CA_FILE nao pode ser lido: ${file}`;
}

/** O arquivo existe mas esta vazio. */
export function emptyCaMessage(file: string): string {
  return `DATABASE_SSL_CA_FILE aponta para um arquivo vazio: ${file}`;
}

/** As duas origens possiveis da CA, ja normalizadas. */
export interface SslCaSource {
  /** Conteudo PEM, de `DATABASE_SSL_CA`. */
  readonly inline?: string;
  /** Caminho de arquivo, de `DATABASE_SSL_CA_FILE`. */
  readonly file?: string;
}

/**
 * Conteudo PEM da CA, vindo de onde estiver configurado.
 *
 * Em branco conta como ausente nas duas formas: uma string so com espacos e
 * truthy e seria repassada ao driver, com a falha aparecendo no handshake e
 * mensagem obscura.
 *
 * NENHUMA mensagem de erro inclui o conteudo do arquivo - nem em caso de falha
 * de leitura. O caminho aparece, porque e o que permite diagnosticar e nao e
 * segredo; o certificado tambem nao e segredo, mas imprimi-lo em log nao ajuda
 * ninguem e polui a saida.
 *
 * @throws Error quando nenhuma das duas, as duas, ou o arquivo nao serve.
 */
export function resolveSslCa(source: SslCaSource): string {
  const inline = source.inline?.trim();
  const file = source.file?.trim();

  const temInline = inline !== undefined && inline !== '';
  const temFile = file !== undefined && file !== '';

  if (temInline && temFile) {
    throw new Error(AMBIGUOUS_CA_MESSAGE);
  }
  if (temInline) {
    return inline;
  }
  if (!temFile) {
    throw new Error(MISSING_CA_MESSAGE);
  }

  let conteudo: string;
  try {
    conteudo = readFileSync(file, 'utf8');
  } catch {
    // O erro original e descartado de proposito: ele carrega `errno`, `syscall`
    // e o caminho absoluto resolvido, e nada disso ajuda quem le o log mais do
    // que a mensagem propria.
    throw new Error(unreadableCaMessage(file));
  }

  const pem = conteudo.trim();
  if (pem === '') {
    throw new Error(emptyCaMessage(file));
  }

  return pem;
}
