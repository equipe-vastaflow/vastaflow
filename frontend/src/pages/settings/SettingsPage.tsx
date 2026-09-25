import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type SettingValue, type SystemSetting } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission, Permission } from '../../auth/permissions';
import { AppShell } from '../../components/AppShell';
import { formatDateTime } from '../users/format';
import { formatSettingValue, parseNumberInput, TYPE_LABELS } from './setting-format';

const NOT_FOUND = 'Configuração não encontrada. Ela pode ter sido removida do catálogo do sistema.';

type Outcome = { ok: true; settings: SystemSetting[] } | { ok: false; message: string };

/** Linha em edicao. `draft` guarda o que esta no campo, ainda nao enviado. */
interface Editing {
  chave: string;
  draft: string | boolean;
}

/**
 * Configuracoes internas do sistema.
 *
 * Consome `GET /settings`, que devolve a lista inteira: o catalogo e um
 * conjunto fechado definido no backend, entao nao ha paginacao nem busca.
 *
 * Somente o VALOR e editavel - chave, tipo e descricao vem do catalogo. O campo
 * de edicao muda conforme o tipo, e o valor e enviado no tipo declarado: um
 * numero vai como numero, um booleano como booleano. Nada aqui e convertido
 * "no chute" para agradar o backend.
 *
 * Nenhuma configuracao guarda segredo nesta versao, entao nao ha valor
 * mascarado na tela.
 */
export function SettingsPage(): ReactNode {
  const { user: me, token, logout } = useAuth();

  const [reloads, setReloads] = useState(0);
  // O resultado guarda a chave da consulta que o produziu: enquanto a chave
  // atual nao tem resultado, a tela esta carregando (mesmo padrao das outras).
  const requestKey = String(reloads);
  const [result, setResult] = useState<{
    key: string;
    outcome: Outcome;
  } | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleError = useCallback(
    (error: unknown, messages: { notFound?: string } = {}): string => {
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
    api.settings
      .list(token)
      .then((settings) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, settings } });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            key: requestKey,
            outcome: { ok: false, message: handleError(error) },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, requestKey, handleError]);

  if (!me || !token) {
    return null;
  }
  const authToken = token;
  const podeEditar = hasPermission(me, Permission.SettingsUpdate);

  function startEdit(setting: SystemSetting): void {
    setNotice(null);
    setActionError(null);
    setEditing({
      chave: setting.chave,
      draft: typeof setting.valor === 'boolean' ? setting.valor : String(setting.valor),
    });
  }

  /**
   * Valor a enviar, ja no tipo da configuracao, ou `null` quando o campo ainda
   * nao tem um valor valido (numero mal digitado, texto vazio).
   */
  function draftValue(setting: SystemSetting, draft: string | boolean): SettingValue | null {
    if (setting.tipo === 'BOOLEAN') {
      return typeof draft === 'boolean' ? draft : null;
    }
    if (typeof draft !== 'string') {
      return null;
    }
    if (setting.tipo === 'NUMBER') {
      return parseNumberInput(draft);
    }
    const texto = draft.trim();
    return texto === '' ? null : texto;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>, setting: SystemSetting): void {
    event.preventDefault();
    if (!editing || saving) {
      return;
    }
    const valor = draftValue(setting, editing.draft);
    if (valor === null) {
      setActionError('Informe um valor válido para esta configuração.');
      return;
    }

    // `saving` desabilita o botao, entao um segundo clique nao dispara uma
    // segunda requisicao; a guarda acima cobre o Enter repetido no teclado.
    setSaving(true);
    setNotice(null);
    setActionError(null);
    api.settings
      .update(authToken, setting.chave, valor)
      .then((atualizado) => {
        setNotice(`Configuração ${atualizado.chave} atualizada.`);
        setEditing(null);
        // Recarrega a lista para refletir valor e responsavel vindos do servidor.
        setReloads((count) => count + 1);
      })
      .catch((error: unknown) => {
        setActionError(handleError(error, { notFound: NOT_FOUND }));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;

  return (
    <AppShell wide>
      <div className="page-header">
        <div>
          <h1>Configurações</h1>
          <p className="muted">
            Parâmetros internos do VastaFlow. Nenhuma senha, token ou credencial é armazenada aqui.
          </p>
        </div>
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
          Carregando configurações…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar as configurações. {outcome.message}</p>
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

      {outcome?.ok && outcome.settings.length === 0 && (
        <p className="card muted">Nenhuma configuração cadastrada.</p>
      )}

      {outcome?.ok && outcome.settings.length > 0 && (
        <div className="card table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Chave</th>
                <th scope="col">Descrição</th>
                <th scope="col">Tipo</th>
                <th scope="col">Valor</th>
                <th scope="col">Última atualização</th>
                {podeEditar && <th scope="col">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {outcome.settings.map((setting) => {
                const emEdicao = editing?.chave === setting.chave;
                return (
                  <tr key={setting.chave}>
                    <td className="mono">{setting.chave}</td>
                    <td className="cell-wrap">{setting.descricao}</td>
                    <td>{TYPE_LABELS[setting.tipo]}</td>
                    <td>
                      {emEdicao && editing ? (
                        <form
                          className="row-actions setting-form"
                          onSubmit={(event) => {
                            handleSubmit(event, setting);
                          }}
                        >
                          <ValueField
                            setting={setting}
                            draft={editing.draft}
                            disabled={saving}
                            onChange={(draft) => {
                              setEditing({ chave: setting.chave, draft });
                            }}
                          />
                          <button type="submit" className="button button-small" disabled={saving}>
                            {saving ? 'Salvando…' : 'Salvar'}
                          </button>
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={saving}
                            onClick={() => {
                              setEditing(null);
                            }}
                          >
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        formatSettingValue(setting.valor)
                      )}
                    </td>
                    <td>
                      {formatDateTime(setting.updatedAt)}
                      {setting.atualizadoPor && (
                        <>
                          <br />
                          <span className="muted actor-email">{setting.atualizadoPor.nome}</span>
                        </>
                      )}
                    </td>
                    {podeEditar && (
                      <td>
                        {!emEdicao && (
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={saving}
                            onClick={() => {
                              startEdit(setting);
                            }}
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

/** Campo de edicao adequado ao tipo da configuracao. */
function ValueField({
  setting,
  draft,
  disabled,
  onChange,
}: {
  setting: SystemSetting;
  draft: string | boolean;
  disabled: boolean;
  onChange: (draft: string | boolean) => void;
}): ReactNode {
  const label = `Valor de ${setting.chave}`;

  if (setting.tipo === 'BOOLEAN') {
    return (
      <label className="field-inline">
        <input
          type="checkbox"
          aria-label={label}
          checked={draft === true}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span>{draft === true ? 'Sim' : 'Não'}</span>
      </label>
    );
  }

  const texto = typeof draft === 'string' ? draft : '';

  if (setting.tipo === 'NUMBER') {
    return (
      <input
        type="number"
        inputMode="decimal"
        step="any"
        aria-label={label}
        value={texto}
        disabled={disabled}
        autoFocus
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  return (
    <input
      type="text"
      aria-label={label}
      value={texto}
      maxLength={500}
      disabled={disabled}
      autoFocus
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}
