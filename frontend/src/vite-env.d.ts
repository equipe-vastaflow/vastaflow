/// <reference types="vite/client" />

/**
 * Variaveis `VITE_*` usadas pela aplicacao. Sem esta declaracao o Vite tipa
 * todas como `any`. Lembrete: elas vao para o bundle publico do navegador.
 */
interface ImportMetaEnv {
  /**
   * URL base do backend, sem barra no final.
   *
   * Opcional no TIPO, obrigatoria em PRODUCAO: o TypeScript nao sabe em que
   * modo o build roda, entao a exigencia e feita em `src/api/api-url.ts` (e o
   * `vite build` falha pelo plugin em `vite.config.ts`). Fora de producao,
   * ausente, cai em http://localhost:3000.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
