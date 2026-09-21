# Frontend

> **Estado: nao iniciado.** Entra na Etapa 4.

## Stack definida

- React
- TypeScript
- Vite
- React Router

## Estrutura prevista

Telas planejadas (apenas esqueleto de rotas na Etapa 4, sem telas completas):

- Login
- Dashboard
- Usuarios
- Permissoes
- Logs
- Integracoes
- Configuracoes

## Observacao sobre CORS

O backend sobe hoje com CORS **desabilitado** (`origin: false`), de proposito:
liberar `*` antes de conhecer a origem real do frontend seria um risco
desnecessario. A politica sera definida nesta etapa, junto com a URL de
desenvolvimento do Vite.
