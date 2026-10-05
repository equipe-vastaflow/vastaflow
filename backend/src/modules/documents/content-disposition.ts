/** Nome usado quando o original nao sobra nada aproveitavel em ASCII. */
const FALLBACK_NAME = 'documento';

/**
 * Monta o `Content-Disposition` de um download de documento.
 *
 * SEMPRE `attachment`, nunca `inline`: o navegador salva o arquivo em vez de
 * tentar renderiza-lo. E o que impede um `.xml` contendo SVG, ou um `.csv`
 * contendo HTML, de ser interpretado como pagina na origem da aplicacao.
 *
 * O nome do arquivo e entrada do usuario e vai para dentro de um CABECALHO
 * HTTP, o que faz dele vetor de injecao de header. O tratamento tem duas
 * partes, como manda a RFC 6266:
 *
 * - `filename=` leva so ASCII imprimivel, sem aspas e sem barra, entre aspas;
 * - `filename*=` leva o nome completo em UTF-8 percent-encoded, que e como
 *   acento e emoji chegam intactos nos navegadores atuais.
 *
 * CR e LF sao o que realmente importa remover: com eles no valor, o cliente
 * passaria a ver um cabecalho novo (`arquivo\r\nX-Qualquer: valor`). Aqui eles
 * nao sobrevivem a nenhuma das duas partes - na primeira sao filtrados por
 * estarem fora da faixa imprimivel, na segunda viram `%0D`/`%0A`.
 */
export function contentDispositionFor(nomeOriginal: string): string {
  const ascii = toAsciiFilename(nomeOriginal);
  const utf8 = encodeRFC5987(nomeOriginal);

  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * Versao ASCII do nome, segura para ir entre aspas num cabecalho.
 *
 * Mantem apenas caracteres imprimiveis de ASCII, e remove os que teriam
 * significado proprio no cabecalho: aspas, contrabarra, ponto-e-virgula e
 * barras. Acento e qualquer caractere nao-ASCII caem fora - quem os preserva e
 * o `filename*`.
 */
function toAsciiFilename(nome: string): string {
  const limpo = [...nome]
    .filter((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      // Faixa imprimivel de ASCII, sem espaco de controle: 0x20 a 0x7E.
      return codigo >= 0x20 && codigo <= 0x7e;
    })
    .filter((caractere) => !'"\\;/,'.includes(caractere))
    .join('')
    .trim();

  return limpo === '' ? FALLBACK_NAME : limpo;
}

/**
 * Percent-encoding do nome para o parametro `filename*`.
 *
 * `encodeURIComponent` nao escapa `!'()*`, que sao validos em `attr-char` da
 * RFC 5987 exceto `'` e `*`; os dois sao escapados a mao para nao fechar o
 * valor cedo.
 */
function encodeRFC5987(nome: string): string {
  return encodeURIComponent(nome)
    .replace(/'/g, '%27')
    .replace(/\*/g, '%2A')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}
