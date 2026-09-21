/// <reference types="vite/client" />

/**
 * Variaveis `VITE_*` usadas pela aplicacao. Sem esta declaracao o Vite tipa
 * todas como `any`. Lembrete: elas vao para o bundle publico do navegador.
 */
interface ImportMetaEnv {
  /** URL base do backend, sem barra no final. Padrao: http://localhost:3000 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
