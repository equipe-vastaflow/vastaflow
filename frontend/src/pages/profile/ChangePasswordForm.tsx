import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';

const POLICY_HINT =
  'A nova senha deve ter de 8 a 72 caracteres, com ao menos uma letra maiúscula, uma minúscula e um número.';

/**
 * Mensagem para o usuário a partir do erro da troca de senha.
 *
 * 400 traz o motivo escrito pelo backend (senha atual incorreta, nova senha igual à atual ou fora da
 * política): é texto nosso, sem dado sensível, e é mostrado como está. 400 NUNCA desloga - só o 401
 * (sessão expirada) encerra a sessão, e é tratado por quem chama.
 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400 || error.status === 409) {
      return error.message;
    }
    if (error.status === 429) {
      return 'Muitas tentativas. Aguarde um minuto e tente novamente.';
    }
  }
  return describeApiError(error);
}

/**
 * Troca da própria senha, em "Meu perfil".
 *
 * Três campos (senha atual, nova e confirmação), sempre `type="password"`. As senhas ficam só no estado
 * do componente: nunca em `localStorage`, URL ou log, e são apagadas depois do sucesso. A validação de
 * verdade é a do servidor (política de senha, senha atual, reutilização); aqui só se evita enviar o que
 * já se sabe inválido (campo vazio, confirmação diferente, nova igual à atual).
 *
 * Depois da troca o servidor invalida os tokens anteriores e devolve um novo, que o `AuthContext` passa
 * a usar: a pessoa continua logada. Senha atual incorreta responde 400 e a sessão segue intacta.
 */
export function ChangePasswordForm(): ReactNode {
  const { changePassword, logout } = useAuth();

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) {
      return;
    }
    setNotice(null);
    setError(null);

    if (senhaAtual === '' || novaSenha === '' || confirmacao === '') {
      setError('Preencha a senha atual, a nova senha e a confirmação.');
      return;
    }
    if (novaSenha !== confirmacao) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    if (novaSenha === senhaAtual) {
      setError('A nova senha deve ser diferente da senha atual.');
      return;
    }

    setSaving(true);
    changePassword(senhaAtual, novaSenha)
      .then(() => {
        setSenhaAtual('');
        setNovaSenha('');
        setConfirmacao('');
        setNotice(
          'Senha alterada com sucesso. As outras sessões abertas com a senha antiga foram encerradas.',
        );
      })
      .catch((cause: unknown) => {
        if (isSessionExpired(cause)) {
          void logout();
          return;
        }
        setError(describeError(cause));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <section aria-labelledby="titulo-alterar-senha">
      <h2 id="titulo-alterar-senha">Alterar senha</h2>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <form className="card form-card" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>Senha atual</span>
          <input
            name="senhaAtual"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={senhaAtual}
            disabled={saving}
            onChange={(event) => {
              setSenhaAtual(event.target.value);
            }}
            required
          />
        </label>
        <label className="field">
          <span>Nova senha</span>
          <input
            name="novaSenha"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={novaSenha}
            disabled={saving}
            onChange={(event) => {
              setNovaSenha(event.target.value);
            }}
            required
          />
        </label>
        <label className="field">
          <span>Confirmar nova senha</span>
          <input
            name="confirmacao"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={confirmacao}
            disabled={saving}
            onChange={(event) => {
              setConfirmacao(event.target.value);
            }}
            required
          />
        </label>
        <p className="muted">{POLICY_HINT}</p>

        <div className="row-actions">
          <button type="submit" className="button" disabled={saving}>
            {saving ? 'Alterando…' : 'Alterar senha'}
          </button>
        </div>
      </form>
    </section>
  );
}
