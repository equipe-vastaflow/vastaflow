/**
 * Comando reconhecido no texto.
 */
export interface ParsedCommand {
  /** Nome sem a barra, em minusculas. */
  readonly name: string;
  /** Argumentos separados por espaco, na ordem recebida. Pode ser vazio. */
  readonly args: readonly string[];
}

/**
 * O que o parser entendeu do texto. Ele nao decide o que fazer a respeito -
 * quem traduz isso em resposta e o `CommandRouter`.
 */
export type ParseResult =
  | { readonly kind: 'command'; readonly command: ParsedCommand }
  | { readonly kind: 'empty' }
  | { readonly kind: 'not-a-command' }
  | { readonly kind: 'malformed' };

const COMMAND_PREFIX = '/';

/** Letras, digitos e `_`. Sem acentos: os comandos do motor sao ASCII. */
const COMMAND_NAME = /^[a-z0-9_]+$/i;

/**
 * Interpreta uma mensagem de texto.
 *
 * Formato reconhecido: `/comando` ou `/comando arg1 arg2`. Espacos extras nas
 * pontas e entre os argumentos sao ignorados, e o nome do comando e
 * normalizado para minusculas (`/Ajuda` e `/ajuda` sao o mesmo comando).
 *
 * Esta funcao so olha para o texto: nao conhece os comandos registrados, nao
 * consulta permissoes e nao tem regra de negocio. Um nome bem formado que nao
 * corresponde a nenhum handler e um `command` aqui, e vira
 * `UnknownCommand` no router.
 */
export function parseCommand(text: string): ParseResult {
  const trimmed = text.trim();

  if (trimmed === '') {
    return { kind: 'empty' };
  }

  if (!trimmed.startsWith(COMMAND_PREFIX)) {
    return { kind: 'not-a-command' };
  }

  // `/` sozinho, `//ajuda`, `/ ajuda` e `/aju-da` caem todos aqui.
  const [rawName = '', ...args] = trimmed.slice(COMMAND_PREFIX.length).split(/\s+/);
  if (!COMMAND_NAME.test(rawName)) {
    return { kind: 'malformed' };
  }

  return {
    kind: 'command',
    // O `split` com `\s+` nao produz strings vazias no meio, mas produz uma no
    // fim quando o texto termina em espaco - ja removido pelo `trim`.
    command: { name: rawName.toLowerCase(), args },
  };
}
