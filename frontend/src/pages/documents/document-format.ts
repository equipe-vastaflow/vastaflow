/** Rotulos curtos por tipo, para a coluna de tipo da listagem. */
const TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'text/csv': 'CSV',
  'application/csv': 'CSV',
  'text/plain': 'CSV',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/xml': 'XML',
  'text/xml': 'XML',
};

/**
 * Rotulo do tipo do documento.
 *
 * Mapa fechado: um MIME desconhecido aparece como "Arquivo", em vez de mostrar
 * ao usuario uma string tecnica como
 * `application/vnd.openxmlformats-officedocument...`.
 */
export function formatMimeType(mimeType: string): string {
  return TYPE_LABELS[mimeType.split(';')[0].trim().toLowerCase()] ?? 'Arquivo';
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/**
 * Tamanho em bytes como texto legivel.
 *
 * Base 1024, com uma casa decimal a partir de KB. Apenas apresentacao: o numero
 * exibido nunca volta para o servidor.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '-';
  }

  let valor = bytes;
  let unidade = 0;
  while (valor >= 1024 && unidade < UNITS.length - 1) {
    valor /= 1024;
    unidade += 1;
  }

  // Bytes nao levam decimal: "512 B" e mais claro que "512,0 B".
  const casas = unidade === 0 ? 0 : 1;
  return `${valor.toFixed(casas).replace('.', ',')} ${UNITS[unidade]}`;
}
