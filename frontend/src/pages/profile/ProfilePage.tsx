import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Profile } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { ROLE_LABELS } from '../../roles';
import { formatDateTime } from '../users/format';

const NOT_FOUND = 'Sua conta não foi encontrada. Entre novamente.';

type Outcome = { ok: true; profile: Profile } | { ok: false; message: string };

/**
 * Dados pessoais do próprio usuário.
 *
 * Consome `GET /profile` e `PATCH /profile`. **Somente o nome é editável** - a
 * tela nem oferece campo para os demais, e o backend recusa qualquer um deles
 * com 400. E-mail, perfil e situação aparecem como leitura, para a pessoa ver
 * o que o sistema sabe sobre ela sem poder alterar.
 *
 * A tela tem contrato próprio e não usa `/auth/me`: são informações
 * diferentes - ali está o material de autorização, aqui os dados pessoais.
 * Depois de salvar, o `AuthContext` é relido para que o nome mostrado no resto
 * da aplicação acompanhe a mudança.
 */
export function ProfilePage(): ReactNode {
  const { token, logout, refreshUser } = useAuth();

  const [reloads, setReloads] = useState(0);
  // O resultado guarda a chave da consulta que o produziu: enquanto a chave
  // atual não tem resultado, a tela está carregando (mesmo padrão das outras).
  const requestKey = String(reloads);
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  const [nome, setNome] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleError = useCallback(
    (error: unknown): string => {
      if (isSessionExpired(error)) {
        void logout();
      }
      return describeApiError(error, { notFound: NOT_FOUND });
    },
    [logout],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    api.profile
      .get(token)
      .then((profile) => {
        if (!cancelled) {
          setResult({ key: requestKey, outcome: { ok: true, profile } });
          setNome(profile.nome);
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
  }, [token, requestKey, handleError]);

  if (!token) {
    return null;
  }
  const authToken = token;

  const loading = result?.key !== requestKey;
  const outcome = loading ? null : result.outcome;
  const profile = outcome?.ok === true ? outcome.profile : null;

  const nomeLimpo = nome.trim();
  const semAlteracao = profile !== null && nomeLimpo === profile.nome;
  const invalido = nomeLimpo === '';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // `saving` já desabilita o botão; a guarda cobre o Enter repetido.
    if (!profile || saving || invalido) {
      return;
    }
    if (semAlteracao) {
      setNotice('Nenhuma alteração para salvar.');
      return;
    }

    setSaving(true);
    setNotice(null);
    setActionError(null);
    // Apenas o campo editável vai no corpo: nunca id, e-mail, perfil,
    // situação, permissões ou senha.
    api.profile
      .update(authToken, { nome: nomeLimpo })
      .then((atualizado) => {
        setResult({ key: requestKey, outcome: { ok: true, profile: atualizado } });
        setNome(atualizado.nome);
        setNotice('Perfil atualizado com sucesso.');
        // O nome aparece no resto da aplicação: relê a sessão em vez de
        // recarregar a página.
        return refreshUser();
      })
      .catch((error: unknown) => {
        setActionError(handleError(error));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Meu perfil</h1>
          <p className="muted">Seus dados pessoais no VastaFlow.</p>
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
          Carregando perfil…
        </p>
      )}

      {outcome && !outcome.ok && (
        <div className="alert" role="alert">
          <p>Não foi possível carregar seu perfil. {outcome.message}</p>
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

      {profile && (
        <form className="card form-card" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Nome</span>
            <input
              name="nome"
              value={nome}
              maxLength={120}
              disabled={saving}
              onChange={(event) => {
                setNome(event.target.value);
              }}
              required
              autoFocus
            />
          </label>
          {invalido && (
            <small className="field-error" role="alert">
              O nome não pode ficar vazio.
            </small>
          )}

          {/* Dados administrativos: aparecem para a pessoa se reconhecer, mas
              não há campo de edição. Alterá-los é atribuição da administração
              de usuários, e o backend recusa a tentativa com 400. */}
          <dl className="profile-readonly">
            <div>
              <dt>E-mail</dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>Perfil</dt>
              <dd>{ROLE_LABELS[profile.role]}</dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>{profile.ativo ? 'Ativo' : 'Inativo'}</dd>
            </div>
            <div>
              <dt>Cadastrado em</dt>
              <dd>{formatDateTime(profile.createdAt)}</dd>
            </div>
          </dl>
          <p className="muted">
            E-mail, perfil e situação não são editáveis aqui. Troca de senha e de e-mail ainda não
            estão disponíveis.
          </p>

          <div className="row-actions">
            <button type="submit" className="button" disabled={saving || invalido}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
