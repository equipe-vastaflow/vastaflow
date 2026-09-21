# Frontend

React + TypeScript + Vite + React Router.

## Estado

Implementado: **login** e **dashboard basico protegido**. As demais telas
(Usuarios, Permissoes, Logs, Integracoes, Configuracoes) ainda nao existem.

| Rota         | Acesso   | O que faz                                                        |
| ------------ | -------- | ---------------------------------------------------------------- |
| `/login`     | publico  | E-mail e senha; quem ja esta autenticado e enviado ao dashboard   |
| `/dashboard` | protegido | Nome, e-mail, perfil e status da sessao; botao **Sair**          |
| qualquer outra | -      | redireciona para `/dashboard` (que exige login)                  |

## Como a protecao funciona

- `ProtectedRoute` envolve as rotas privadas. Sem sessao valida, redireciona para
  `/login`; enquanto confirma o token guardado com o servidor, **nao renderiza
  nada protegido**.
- Ao abrir/recarregar, o token guardado e validado em `GET /auth/me`. Token
  expirado, recusado (401) ou de usuario desativado leva de volta ao login.
- A sessao termina sozinha no instante em que o token expira.
- **A protecao real e a do backend.** O frontend apenas evita mostrar telas a quem
  nao tem sessao; toda API continua exigindo o JWT.

O token fica no `localStorage`. Trade-off conhecido: um XSS conseguiria le-lo.
Cookie httpOnly seria mais seguro, mas exige mudancas no backend (emissao do
cookie e protecao CSRF) e fica para o hardening.

## Executar

Requer Node.js >= 24 e o backend no ar (ver [README da raiz](../README.md)).

```bash
cd frontend
npm install
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
├── pages/                LoginPage, DashboardPage
└── App.test.tsx          testes de rota protegida, login e logout
```
