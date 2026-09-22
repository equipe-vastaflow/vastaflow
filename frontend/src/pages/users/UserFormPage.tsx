import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type RoleName, type User } from '../../api/client';
import { describeApiError, isSessionExpired } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { ROLE_LABELS } from '../../roles';
import { userCapabilities } from './capabilities';

const PASSWORD_HINT = 'De 8 a 72 caracteres, com letra maiúscula, minúscula e número.';
const EMAIL_IN_USE = 'Já existe um usuário com este e-mail.';

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; assignable: RoleName[]; user: User | null };

/**
 * Criacao (`/users/novo`) e edicao (`/users/:id/editar`) de usuario.
 *
 * A edicao altera somente nome e e-mail: senha, perfil e status nao passam por
 * aqui (o backend recusa esses campos no PATCH generico). Perfil e status sao
 * alterados pelas acoes da lista.
 */
export function UserFormPage(): ReactNode {
  const { id } = useParams();
  const editing = id !== undefined;
  const { user: me, token, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [role, setRole] = useState<RoleName | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    Promise.all([api.users.assignableRoles(token), id ? api.users.get(token, id) : null])
      .then(([assignable, user]) => {
        if (cancelled) {
          return;
        }
        setLoaded({ state: 'ready', assignable, user });
        if (user) {
          setNome(user.nome);
          setEmail(user.email);
        } else {
          // USUARIO e o perfil padrao do backend; se nao puder concede-lo, o
          // campo fica vazio e a escolha e obrigatoria.
          setRole(assignable.includes('USUARIO') ? 'USUARIO' : '');
        }
      })
      .catch((caught: unknown) => {
        if (isSessionExpired(caught)) {
          void logout();
        }
        if (!cancelled) {
          setLoaded({ state: 'error', message: describeApiError(caught) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, id, logout]);

  if (!me || !token) {
    return null;
  }

  const title = editing ? 'Editar usuário' : 'Novo usuário';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (id) {
        const saved = await api.users.update(token, id, { nome: nome.trim(), email: email.trim() });
        if (saved.id === me?.id) {
          await refreshUser();
        }
        await navigate(`/users/${saved.id}`, {
          state: { notice: 'Alterações salvas com sucesso.' },
        });
      } else {
        const created = await api.users.create(token, {
          nome: nome.trim(),
          email: email.trim(),
          senha,
          role: role as RoleName,
        });
        await navigate('/users', { state: { notice: `Usuário ${created.nome} criado com sucesso.` } });
      }
    } catch (caught) {
      if (isSessionExpired(caught)) {
        void logout();
      }
      setError(describeApiError(caught, { conflict: EMAIL_IN_USE }));
      setSubmitting(false);
    }
  }

  let body: ReactNode;
  if (loaded.state === 'loading') {
    body = (
      <p className="muted" aria-busy="true">
        Carregando…
      </p>
    );
  } else if (loaded.state === 'error') {
    body = (
      <p className="alert" role="alert">
        {loaded.message}
      </p>
    );
  } else if (loaded.user && !userCapabilities(me, loaded.user, loaded.assignable).edit) {
    body = (
      <p className="alert" role="alert">
        Você não pode editar este usuário.
      </p>
    );
  } else if (!editing && loaded.assignable.length === 0) {
    body = (
      <p className="alert" role="alert">
        Seu perfil não pode conceder nenhum perfil de acesso.
      </p>
    );
  } else {
    const missing = !nome.trim() || !email.trim() || (!editing && (!senha || !role));
    body = (
      <form className="card form-card" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label className="field">
          <span>Nome</span>
          <input
            name="nome"
            value={nome}
            maxLength={120}
            onChange={(event) => {
              setNome(event.target.value);
            }}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>E-mail</span>
          <input
            type="email"
            name="email"
            value={email}
            maxLength={254}
            autoComplete="off"
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            required
          />
        </label>

        {!editing && (
          <>
            {/* A dica fica fora do <label> para nao fazer parte do nome do campo. */}
            <div className="field">
              <label htmlFor="senha">Senha inicial</label>
              <input
                id="senha"
                type="password"
                name="senha"
                value={senha}
                autoComplete="new-password"
                aria-describedby="senha-ajuda"
                onChange={(event) => {
                  setSenha(event.target.value);
                }}
                required
              />
              <small id="senha-ajuda" className="muted">
                {PASSWORD_HINT}
              </small>
            </div>

            <label className="field">
              <span>Perfil</span>
              <select
                name="role"
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as RoleName | '');
                }}
                required
              >
                <option value="">Selecione…</option>
                {loaded.assignable.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {editing && (
          <p className="muted">
            Perfil e status são alterados pelas ações da lista de usuários. A senha não é alterada
            por aqui.
          </p>
        )}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <Link to={id ? `/users/${id}` : '/users'} className="button button-secondary">
            Cancelar
          </Link>
          <button type="submit" className="button" disabled={submitting || missing}>
            {submitting ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar usuário'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <AppShell>
      <p>
        <Link to="/users">← Usuários</Link>
      </p>
      <h1>{title}</h1>
      {body}
    </AppShell>
  );
}
