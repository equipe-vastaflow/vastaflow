/** Caractere que o Node usa quando uma sequencia UTF-8 e invalida. */
const REPLACEMENT = '�';

/**
 * Corrige o nome de arquivo que vem de um upload multipart.
 *
 * O `busboy` (dentro do `multer`) decodifica o nome do arquivo como **latin1**,
 * nao como UTF-8. Os navegadores enviam UTF-8, entao todo nome com acento chega
 * corrompido: `Declaração.pdf` chega como `DeclaraÃ§Ã£o.pdf`. Em portugues isso
 * atinge a maioria dos nomes reais, e o nome corrompido iria para o banco e para
 * o cabecalho de download.
 *
 * A correcao reinterpreta os bytes: volta a string para bytes latin1 (que e a
 * sequencia original, byte a byte) e le como UTF-8.
 *
 * Se o resultado tiver caractere de substituicao, os bytes NAO eram UTF-8
 * valido - nesse caso o nome original e mantido, porque um nome estranho e
 * melhor que um nome destruido.
 *
 * Fica aqui, na borda, e nao no service: e peculiaridade do transporte
 * multipart, nao regra de documento.
 */
export function decodeMultipartFilename(nome: string): string {
  if (typeof nome !== 'string' || nome === '') {
    return nome;
  }

  // Nome so com ASCII nao tem o que corrigir.
  if (!/[\u0080-ÿ]/.test(nome)) {
    return nome;
  }

  const reinterpretado = Buffer.from(nome, 'latin1').toString('utf8');
  return reinterpretado.includes(REPLACEMENT) ? nome : reinterpretado;
}
