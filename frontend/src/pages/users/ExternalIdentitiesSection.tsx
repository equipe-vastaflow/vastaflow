import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  api,
  type CreatedIdentityLinkRequest,
  type ExternalIdentity,
  type IdentityLinkRequest,
} from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CHANNEL_LABELS, isExpired, LINK_REQUEST_STATUS_LABELS } from './external-identity-format';
import { formatDateTime } from './format';
import { LinkCodeDialog } from './LinkCodeDialog';

/** O único canal do contrato. Não há WhatsApp, e-mail ou qualquer outro. */
const CANAL = 'telegram' as const;

const CREATE_CONFLICT =
  'Não foi possível criar a solicitação: já existe uma pendente para este usuário, ou o usuário está inativo.';
const NOT_FOUND = 'O item não foi encontrado. Atualize a lista para ver o estado atual.';

type Outcome =
  | { ok: true; links: ExternalIdentity[]; requests: IdentityLinkRequest[] }
  | { ok: false; message: string };

/** O que o diálogo de confirmação vai confirmar. */
type Pending =
  | { tipo: 'vinculo'; id: string; descricao: string }
  | { tipo: 'solicitacao'; id: string; descricao: string };

/**
 * Vínculos de identidade externa de um usuário, no detalhe dele.
 *
 * Consome os endpoints administrativos existentes. A criação **não** envia
 * identificador externo: o corpo leva só o canal, e quem prova a posse da conta
 * é a própria pessoa, enviando ao bot o código que aparece uma única vez.
 *
 * O código vive apenas em estado React enquanto o diálogo está aberto — não vai
 * para `localStorage`, `sessionStorage`, URL, histórico nem log. Ao fechar, é
 * descartado e a lista é recarregada para mostrar a solicitação pendente.
 *
 * `podeGerenciar` vem de `userCapabilities(...).edit`: as mutações exigem
 * `users:update` com a mesma hierarquia da edição de usuários, exatamente o que
 * o backend aplica. Nenhuma permissão nova foi criada, e esconder um botão aqui
 * não protege nada — o backend recusa de qualquer forma.
 */
export function ExternalIdentitiesSection({
  userId,
  podeGerenciar,
}: {
  userId: string;
  podeGerenciar: boolean;
}): ReactNode {
  const { token, logout } = useAuth();

  const [reloads, setReloads] = useState(0);
  // Mesmo padrão das outras telas: o resultado guarda a chave da consulta que o
  // produziu, então enquanto a chave atual não tem resultado está carregando.
  const requestKey = `${userId}:${reloads}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Operação em andamento. Enquanto houver uma, nenhuma ação responde. */
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [criado, setCriado] = useState<CreatedIdentityLinkRequest | null>(null);

  const handleError = useCallback(
    (error: unknown, messages: { conflict?: string; notFound?: string } = {}): string => {
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
    Promise.all([
      api.externalIdentities.list(token, userId),
      api.externalIdentities.listLinkRequests(token, userId),
    ])
      .then(([links, requests]) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, links, requests } });
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
  }, [token, userId, requestKey, handleError]);

  const closeDialog = useCallback(() => {
    setPending(null);
  }, []);

  if (!token) {
    return null;
  }
  const authToken = token;

  /** Recarrega as duas listas sem recarregar a página. */
  function reload(): void {
    setReloads((count) => count + 1);
  }

  function vincular(): void {
    if (busy !== null) {
      return;
    }
    setBusy('criar');
    setNotice(null);
    setActionError(null);
    api.externalIdentities
      .createLinkRequest(authToken, userId, CANAL)
      .then((request) => {
        // O código só existe aqui. Fica em estado React e é descartado ao fechar.
        setCriado(request);
      })
      .catch((error: unknown) => {
        setActionError(handleError(error, { conflict: CREATE_CONFLICT }));
      })
      .finally(() => {
        setBusy(null);
      });
  }

  function fecharCodigo(): void {
    setCriado(null);
    setNotice('Solicitação criada. Ela aparece abaixo até ser confirmada no Telegram.');
    // A solicitação pendente só aparece depois de reler a lista.
    reload();
  }

  function confirmar(): void {
    if (!pending || busy !== null) {
      return;
    }
    const alvo = pending;
    setBusy(alvo.id);
    setNotice(null);
    setActionError(null);

    const operacao =
      alvo.tipo === 'solicitacao'
        ? api.externalIdentities.cancelLinkRequest(authToken, userId, alvo.id)
        : api.externalIdentities.remove(authToken, userId, alvo.id);

    operacao
      .then(() => {
        setNotice(
          alvo.tipo === 'solicitacao'
            ? 'Solicitação cancelada.'
            : `Vínculo com ${alvo.descricao} removido.`,
        );
        reload();
      })
      .catch((error: unknown) => {
        setActionError(
          handleError(error, {
            notFound: NOT_FOUND,
            conflict:
              alvo.tipo === 'solicitacao'
                ? 'Não foi possível cancelar a solicitação.'
                : 'Não foi possível remover o vínculo.',
          }),
        );
      })
      .finally(() => {
        setBusy(null);
        setPending(null);
      });
  }

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;

  return (
    <section aria-labelledby="titulo-vinculos-externos">
      <div className="section-header">
        <h2 id="titulo-vinculos-externos">Vínculos externos</h2>
        {podeGerenciar && outcome?.ok === true && (
          <button type="button" className="button" disabled={busy !== null} onClick={vincular}>
            {busy === 'criar' ? 'Criando…' : `Vincular ${CHANNEL_LABELS[CANAL]}`}
          </button>
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
          Carregando vínculos externos…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar os vínculos externos. {outcome.message}</p>
          <button type="button" className="button button-secondary button-small" onClick={reload}>
            Tentar novamente
          </button>
        </div>
      )}

      {outcome?.ok && (
        <>
          <h3 className="subsection-title">Vínculos ativos</h3>
          {outcome.links.length === 0 ? (
            <p className="card muted">Nenhuma conta externa vinculada.</p>
          ) : (
            <div className="card table-wrapper">
              <table className="table">
                <caption className="sr-only">Vínculos ativos de identidade externa</caption>
                <thead>
                  <tr>
                    <th scope="col">Canal</th>
                    <th scope="col">Identificador</th>
                    <th scope="col">Vinculado em</th>
                    {podeGerenciar && <th scope="col">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {outcome.links.map((link) => (
                    <tr key={link.id}>
                      <td>
                        <span className="badge">{CHANNEL_LABELS[link.canal]}</span>
                      </td>
                      <td className="mono">{link.idExterno}</td>
                      <td>{formatDateTime(link.createdAt)}</td>
                      {podeGerenciar && (
                        <td>
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={busy !== null}
                            onClick={() => {
                              setPending({
                                tipo: 'vinculo',
                                id: link.id,
                                descricao: `${CHANNEL_LABELS[link.canal]} ${link.idExterno}`,
                              });
                            }}
                          >
                            {busy === link.id ? 'Removendo…' : 'Remover'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="subsection-title">Solicitações pendentes</h3>
          {outcome.requests.length === 0 ? (
            <p className="card muted">Nenhuma solicitação pendente.</p>
          ) : (
            <div className="card table-wrapper">
              <table className="table">
                <caption className="sr-only">Solicitações de vínculo pendentes</caption>
                <thead>
                  <tr>
                    <th scope="col">Canal</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Criada em</th>
                    <th scope="col">Validade</th>
                    {podeGerenciar && <th scope="col">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {outcome.requests.map((pedido) => {
                    const vencida = isExpired(pedido.expiraEm);
                    return (
                      <tr key={pedido.id}>
                        <td>
                          <span className="badge">{CHANNEL_LABELS[pedido.canal]}</span>
                        </td>
                        <td>{LINK_REQUEST_STATUS_LABELS[pedido.status]}</td>
                        <td>{formatDateTime(pedido.createdAt)}</td>
                        {/* O status vem do backend; aqui só se informa o que a
                            data diz. Nenhum status é inventado. */}
                        <td>
                          {vencida ? 'Venceu em ' : 'Válida até '}
                          {formatDateTime(pedido.expiraEm)}
                        </td>
                        {podeGerenciar && (
                          <td>
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              disabled={busy !== null}
                              onClick={() => {
                                setPending({
                                  tipo: 'solicitacao',
                                  id: pedido.id,
                                  descricao: CHANNEL_LABELS[pedido.canal],
                                });
                              }}
                            >
                              {busy === pedido.id ? 'Cancelando…' : 'Cancelar'}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {criado && <LinkCodeDialog request={criado} onClose={fecharCodigo} />}

      {pending && (
        <ConfirmDialog
          title={
            pending.tipo === 'solicitacao' ? 'Cancelar solicitação?' : 'Remover vínculo externo?'
          }
          confirmLabel={
            pending.tipo === 'solicitacao' ? 'Confirmar cancelamento' : 'Confirmar remoção'
          }
          cancelLabel="Voltar"
          danger
          busy={busy !== null}
          onConfirm={confirmar}
          onCancel={closeDialog}
        >
          <p>
            <strong>{pending.descricao}</strong>
          </p>
          <p>
            {pending.tipo === 'solicitacao'
              ? 'O código deixa de valer. Para vincular depois, inicie uma nova solicitação.'
              : 'A conta externa deixa de ser reconhecida na próxima mensagem do canal.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
