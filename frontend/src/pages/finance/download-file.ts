import type { DownloadedFile } from '../../api/client';

/**
 * Entrega ao navegador um arquivo que ja esta em memoria.
 *
 * A planilha vem pelo `fetch` autenticado, e nao por um link direto: a rota
 * exige o cabecalho `Authorization`, que um `<a href>` comum nao envia. Por isso
 * o caminho e baixar o conteudo e so entao disparar o download a partir dele.
 */
export function downloadFile({ blob, filename }: DownloadedFile): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // O elemento precisa estar no documento para o clique valer no Firefox.
  document.body.append(link);
  link.click();
  link.remove();

  // Liberado no proximo ciclo, e nao aqui: revogar na mesma volta do laco de
  // eventos chega a cancelar o download que acabou de comecar em alguns
  // navegadores. Sem revogar, o blob ficaria preso em memoria ate recarregar a
  // pagina.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
