/**
 * Tamanho maximo do NOME do arquivo, em bytes.
 *
 * Bytes, e nao caracteres, porque a coluna e `varchar2(255)` no Oracle, onde o
 * tamanho e contado em BYTES por padrao. "Declaracao de Imposto de Renda -
 * Joao.pdf" ocupa mais bytes que caracteres, e um nome de 255 caracteres
 * acentuados nao caberia la. Mesmo criterio de `PASSWORD_MAX_BYTES`.
 */
export const NAME_MAX_BYTES = 255;

/**
 * Tipos aceitos nesta primeira versao.
 *
 * ATENCAO: esta lista NAO foi aprovada pelo negocio - nao havia decisao alguma
 * no repositorio quando a fundacao foi escrita. E o conjunto minimo necessario
 * para o endpoint existir, e deve ser revisto com a Vasta antes do uso real.
 *
 * Cada extensao declara os MIME que aceita, porque navegador e sistema
 * operacional divergem: o Windows manda `application/vnd.ms-excel` para `.csv`,
 * e alguns clientes mandam `application/octet-stream` para tudo.
 *
 * `application/octet-stream` NAO esta em lista nenhuma, de proposito: aceita-lo
 * equivaleria a desligar a conferencia, porque qualquer arquivo pode ser
 * enviado com esse tipo.
 *
 * Imagens ficaram FORA: o enunciado as admitia apenas se houvesse justificativa
 * no projeto, e nao ha nenhum caso de uso de imagem hoje.
 */
export const ALLOWED_TYPES: Readonly<Record<string, readonly string[]>> = {
  '.pdf': ['application/pdf'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.xls': ['application/vnd.ms-excel'],
  '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xml': ['application/xml', 'text/xml'],
};

/** Extensoes aceitas, para mensagem de erro e para a tela. */
export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_TYPES);

/** Sucesso nao devolve nada; falha traz a mensagem que o cliente recebe. */
export type FileCheck = { ok: true } | { ok: false; erro: string };

/** O que o interceptor de upload entrega, reduzido ao que a politica usa. */
export interface UploadedFileLike {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * Valida o arquivo enviado: presenca, tamanho, nome, extensao e coerencia do
 * MIME declarado com a extensao.
 *
 * Funcao pura, sem excecao de framework - quem chama decide o que fazer com a
 * recusa. Mesma abordagem de `entry-status.policy.ts` e `report-period.policy.ts`.
 *
 * O QUE ESTA FUNCAO NAO FAZ, e precisa ser dito: ela nao abre o arquivo e nao
 * olha o conteudo. Um `.pdf` com `application/pdf` que seja na verdade um
 * executavel renomeado PASSA. Conferir os bytes iniciais (magic bytes) exigiria
 * dependencia nova, que nao foi aprovada. Isto NAO e antivirus e nao substitui
 * um. O que limita o dano e o download sair sempre como anexo, com `nosniff`, e
 * a chave fisica nao levar a extensao original.
 */
export function checkUploadedFile(
  file: UploadedFileLike | undefined,
  maxFileSize: number,
): FileCheck {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return { ok: false, erro: 'Envie um arquivo no campo "arquivo"' };
  }

  // O tamanho do buffer manda, nao o campo `size`: e o que de fato foi gravado.
  const tamanho = file.buffer.length;
  if (tamanho === 0) {
    return { ok: false, erro: 'Arquivo vazio' };
  }
  if (tamanho > maxFileSize) {
    return { ok: false, erro: `Arquivo acima do limite de ${maxFileSize} bytes` };
  }

  const nome = file.originalname;
  if (typeof nome !== 'string' || nome.trim() === '') {
    return { ok: false, erro: 'Nome do arquivo ausente' };
  }
  if (Buffer.byteLength(nome, 'utf8') > NAME_MAX_BYTES) {
    return { ok: false, erro: `Nome do arquivo acima de ${NAME_MAX_BYTES} bytes` };
  }
  if (nome.includes('\0')) {
    return { ok: false, erro: 'Nome do arquivo invalido' };
  }

  const extensao = extensionOf(nome);
  const mimesAceitos = extensao === null ? undefined : ALLOWED_TYPES[extensao];
  if (!mimesAceitos) {
    return {
      ok: false,
      erro: `Tipo de arquivo nao permitido. Aceitos: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  // O `Content-Type` do cliente e declaracao, nao prova - mas incoerencia com a
  // extensao e sinal claro de problema e custa nada recusar.
  if (!mimesAceitos.includes(normalizeMime(file.mimetype))) {
    return { ok: false, erro: `O tipo informado nao corresponde a extensao ${extensao}` };
  }

  return { ok: true };
}

/**
 * Extensao final do nome, em minusculas, ou `null` quando nao houver.
 *
 * Usa SOMENTE o ultimo ponto. Isso e o que trata extensao dupla do jeito certo:
 * `arquivo.pdf.exe` tem extensao `.exe` e e recusado; `arquivo.exe.pdf` tem
 * `.pdf` e passa - e passar esta correto, porque a chave fisica nao leva a
 * extensao original, o download sai como anexo e nada no servidor executa o
 * arquivo.
 *
 * Byte nulo (`arquivo%00.exe` decodificado) e rejeitado antes, por `checkUploadedFile`.
 */
export function extensionOf(nome: string): string | null {
  const ponto = nome.lastIndexOf('.');
  if (ponto <= 0 || ponto === nome.length - 1) {
    return null;
  }
  return nome.slice(ponto).toLowerCase();
}

/** Remove parametros (`; charset=utf-8`) e normaliza a caixa do MIME. */
function normalizeMime(mime: string): string {
  return typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
}
