# Frontend

React + TypeScript + Vite + React Router.

## Estado

Implementado: **login**, **dashboard basico protegido** e **administracao de
usuarios**. As demais telas (Permissoes, Logs, Integracoes, Configuracoes) ainda
nao existem.

| Rota         | Acesso   | O que faz                                                        |
| ------------ | -------- | ---------------------------------------------------------------- |
| `/login`     | publico  | E-mail e senha; quem ja esta autenticado e enviado ao dashboard   |
| `/dashboard` | protegido | Nome, e-mail, perfil e status da sessao; navegacao e botao **Sair** |
| `/users`     | `users:read` | Tabela paginada com acoes (ver, editar, ativar/desativar, perfil) |
| `/users/novo` | `users:create` | Formulario de novo usuario                                   |
| `/users/:id` | `users:read` | Dados do usuario                                                |
| `/users/:id/editar` | `users:update` | Edicao de nome e e-mail                                  |
| qualquer outra | -      | redireciona para `/dashboard` (que exige login)                  |

## Como a protecao funciona

- `ProtectedRoute` envolve as rotas privadas. Sem sessao valida, redireciona para
  `/login`; enquanto confirma o token guardado com o servidor, **nao renderiza
  nada protegido**.
- Ao abrir/recarregar, o token guardado e validado em `GET /auth/me`. Token
  expirado, recusado (401) ou de usuario desativado leva de volta ao login.
- A sessao termina sozinha no instante em que o token expira.
- As acoes da area de usuarios aparecem conforme as permissoes do perfil e os
  perfis que o backend informa em `GET /users/assignable-roles`. Sem
  `users:read`, a navegacao "Usuarios" nem aparece.
- Desativar pede confirmacao. Recusas do backend (ex.: ultimo ADMIN ativo) sao
  mostradas como erro, nunca como sucesso.
- **A protecao real e a do backend.** O frontend apenas evita mostrar telas a quem
  nao tem sessao; toda API continua exigindo o JWT.

O token fica no `localStorage`. Trade-off conhecido: um XSS conseguiria le-lo.
Cookie httpOnly seria mais seguro, mas exige mudancas no backend (emissao do
cookie e protecao CSRF) e fica para o hardening.

## Executar

Requer Node.js >= 24.15.0 e o backend no ar (ver [README da raiz](../README.md)).

```bash
cd frontend
npm ci
cp .env.example .env      # Windows: Copy-Item .env.example .env
npm run dev               # http://localhost:5173
```

`VITE_API_URL` (padrao `http://localhost:3000`) aponta para o backend. O backend
so aceita chamadas da origem informada em `FRONTEND_ORIGIN` (CORS); o padrao do
`.env.example` ja e `http://localhost:5173`.

## Comandos

| Comando             | Descricao                                       |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Servidor de desenvolvimento (porta 5173)         |
| `npm run build`     | Verifica tipos e gera `dist/`                    |
| `npm run preview`   | Serve o build localmente                         |
| `npm run typecheck` | Verifica tipos                                   |
| `npm test`          | Testes (Vitest + Testing Library)                |
| `npm run lint`      | ESLint (falha com qualquer aviso)                |
| `npm run lint:fix`  | ESLint corrigindo o que for automatico           |

## Estrutura

```
src/
├── main.tsx              ponto de entrada (BrowserRouter + AuthProvider)
├── App.tsx               rotas
├── api/client.ts         chamadas HTTP ao backend e tipos da API
├── auth/
│   ├── AuthContext.tsx   estado da sessao (login, logout, expiracao)
│   ├── ProtectedRoute.tsx
│   └── session-storage.ts
├── components/           AppShell (topbar + navegacao), ConfirmDialog, StatusLabel
├── pages/                LoginPage, DashboardPage
│   └── users/            lista, formulario, visualizacao e testes da area de usuarios
└── App.test.tsx          testes de rota protegida, login e logout
```
