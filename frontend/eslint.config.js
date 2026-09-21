// @ts-check
import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Mesmo criterio do backend: `any` e erro, nao aviso.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `useAuth` fica junto do `AuthProvider` (padrao usual de contexto React).
      // Custo aceito: editar AuthContext.tsx recarrega a pagina em vez de
      // aplicar o hot reload. Qualquer outra exportacao nao-componente em
      // arquivo de componente continua sendo erro.
      'react-refresh/only-export-components': ['error', { allowExportNames: ['useAuth'] }],
    },
  },
  {
    // Arquivos de configuracao do proprio tooling, fora do tsconfig da app.
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
