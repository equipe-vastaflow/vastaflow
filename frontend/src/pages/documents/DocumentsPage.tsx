import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type DocumentFile, type DocumentPage } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission, Permission } from '../../auth/permissions';
import { AppShell } from '../../components/AppShell';
import { Pagination } from '../../components/Pagination';
import { downloadFile } from '../finance/download-file';
import { formatDateTime } from '../users/format';
import { formatFileSize, formatMimeType } from './document-format';

const PAGE_SIZE = 20;

/** Extensoes que o backend aceita. Serve ao `accept` do seletor de arquivo. */
const ACCEPTED = '.pdf,.xlsx,.xls,.csv,.docx,.xml';

/**
 * 413 chega quando o arquivo passa do limite do servidor. A mensagem tecnica
 * nao ajuda quem esta usando a tela.
 */
const TOO_LARGE = 'Arquivo grande demais. Envie um arquivo menor.';

type Outcome = { ok: true; page: DocumentPage } | { ok: false; message: string };

/**
 * Documentos.
 *
 * Consome `GET /documents`, paginado no backend. A tela nao conhece storage:
 * envia pelo endpoint multipart e baixa pela rota de download, sempre pelo id.
 */
export function DocumentsPage(): ReactNode {
  const { user: me, token, logout } = useAuth();

  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  const requestKey = `${page}:${reloads}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleError = useCallback(
    (error: unknown, messages: { payloadTooLarge?: string } = {}): string => {
      if (isSessionExpired(error)) {
        void logout();
      }
      return describeApiError(error, messages);
    },
    [logout],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    api.documents
      .list(token, page, PAGE_SIZE)
      .then((documentPage) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, page: documentPage } });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: false, message: handleError(error) } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, requestKey, handleError]);

  if (!me || !token) {
    return null;
  }
  const authToken = token;
  const podeEnviar = hasPermission(me, Permission.DocumentsCreate);

  function enviar(file: File): void {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    api.documents
      .upload(authToken, file)
      .then((documento) => {
        setNotice(`"${documento.nome}" enviado.`);
        setPage(1);
        setReloads((count) => count + 1);
      })
      .catch((error: unknown) => {
        // O 400 do backend ja diz o motivo (tipo nao permitido, arquivo vazio,
        // nome invalido), entao a mensagem dele e aproveitada. O 413 nao tem
        // mensagem util, porque a recusa acontece no limite do servidor.
        setActionError(handleError(error, { payloadTooLarge: TOO_LARGE }));
      })
      .finally(() => {
        setBusy(false);
        // Limpa o seletor para que escolher o MESMO arquivo de novo dispare o
        // evento outra vez.
        if (fileInput.current) {
          fileInput.current.value = '';
        }
      });
  }

  function baixar(documento: DocumentFile): void {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    api.documents
      .download(authToken, documento)
      .then((arquivo) => {
        downloadFile(arquivo);
        setNotice(`"${arquivo.filename}" baixado.`);
      })
      .catch((error: unknown) => {
        setActionError(handleError(error));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Documentos</h1>
          <p className="muted">
            Arquivos armazenados no VastaFlow. Tipos aceitos: PDF, XLSX, XLS, CSV, DOCX e XML.
          </p>
        </div>
        {podeEnviar && (
          <div className="row-actions">
            {/* Um `<input type="file">` escondido atras de um botao: o controle
                nativo nao aceita estilo, e o botao segue o padrao da aplicacao. */}
            <input
              ref={fileInput}
              id="documento-arquivo"
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  enviar(file);
                }
              }}
            />
            <label htmlFor="documento-arquivo" className="button">
              {busy ? 'Enviando…' : 'Enviar documento'}
            </label>
          </div>
        )}
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="alert" role="alert">
          {actionError}
        </p>
      )}

      {loading && (
        <p className="muted" aria-busy="true">
          Carregando documentos…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar os documentos. {outcome.message}</p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setReloads((count) => count + 1);
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {outcome?.ok && outcome.page.items.length === 0 && (
        <p className="card muted">
          {outcome.page.total === 0
            ? 'Nenhum documento enviado ainda.'
            : 'Nenhum documento nesta página.'}
        </p>
      )}

      {outcome?.ok && outcome.page.items.length > 0 && (
        <>
          <div className="card table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Tamanho</th>
                  <th scope="col">Enviado por</th>
                  <th scope="col">Enviado em</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {outcome.page.items.map((documento) => (
                  <tr key={documento.id}>
                    <td className="cell-wrap">{documento.nome}</td>
                    <td>{formatMimeType(documento.mimeType)}</td>
                    <td className="amount">{formatFileSize(documento.tamanho)}</td>
                    <td>{documento.criadoPor?.nome ?? '—'}</td>
                    <td>{formatDateTime(documento.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={busy}
                          onClick={() => {
                            baixar(documento);
                          }}
                        >
                          Baixar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={outcome.page.page}
            total={outcome.page.total}
            limit={outcome.page.limit}
            onChange={setPage}
            label={{ singular: 'documento', plural: 'documentos' }}
          />
        </>
      )}
    </AppShell>
  );
}
