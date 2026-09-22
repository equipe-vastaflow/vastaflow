# Frontend

React + TypeScript + Vite + React Router.

## Estado

Implementado: **login**, **dashboard**, **administracao de usuarios** e
**auditoria**. As demais telas (Permissoes, Integracoes, Configuracoes) ainda
nao existem.

| Rota         | Acesso   | O que faz                                                        |
| ------------ | -------- | ---------------------------------------------------------------- |
| `/login`     | publico  | E-mail e senha; quem ja esta autenticado e enviado ao dashboard   |
| `/dashboard` | protegido | Cabecalho (usuario, perfil, sessao), cards de usuarios, auditoria recente e atalhos |
| `/audit-logs` | `audit:read` | Historico completo de auditoria, paginado |
| `/users`     | `users:read` | Tabela paginada com acoes (ver, editar, ativar/desativar, perfil) |
| `/users/novo` | `users:create` | Formulario de novo usuario                                   |
| `/users/:id` | `users:read` | Dados do usuario                                                |
| `/users/:id/editar` | `users:update` | Edicao de nome e e-mail                                  |
| qualquer outra | -      | redireciona para `/dashboard` (que exige login)                  |

> O dashboard mostra os 10 eventos mais recentes; o historico completo fica em
> `/audit-logs`, que pagina no backend. A tela ainda **nao tem filtros** (por
> periodo, acao ou modulo) - o endpoint tambem nao os oferece.

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
- No dashboard, quem decide o que aparece e o backend: ele devolve apenas as
  secoes permitidas ao perfil (`users:read` para os cards de usuarios,
  `audit:read` para a auditoria recente). Um perfil sem nenhuma das duas ve a
  pagina com um aviso, e nao um erro.
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
├── components/           AppShell (topbar + navegacao), ConfirmDialog, Pagination, StatusLabel
├── pages/                LoginPage
│   ├── audit/            AuditLogsPage + tabela e testes da tela de auditoria
│   ├── dashboard/        DashboardPage + cards, auditoria recente, atalhos e testes
│   └── users/            lista, formulario, visualizacao e testes da area de usuarios
└── App.test.tsx          testes de rota protegida, login e logout
```
