import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';
// Extensao explicita: o carregador nativo de configuracao do Vite (que vira o
// padrao numa versao maior futura) nao resolve import sem extensao aqui.
import { resolveApiUrl } from './src/api/api-url.ts';

/**
 * Faz `vite build` FALHAR quando o build e de producao e `VITE_API_URL` esta
 * ausente.
 *
 * Existe porque a guarda em `api-url.ts` lanca em RUNTIME: sozinha, ela
 * transformaria o problema em pagina branca para o usuario final, em vez de
 * build quebrado para quem publica. Lancar em `configResolved` interrompe o
 * build antes de qualquer arquivo ser gerado - nao existe imagem com bundle
 * errado para alguem publicar por engano.
 *
 * `config.env` e exatamente o objeto que vira `import.meta.env` no bundle, e
 * `config.isProduction` o mesmo valor que vira `import.meta.env.PROD`. A
 * conferencia usa a MESMA funcao do runtime, de proposito: uma regra, dois
 * momentos.
 *
 * O Dockerfile do frontend, quando existir, tera de passar a variavel como
 * build arg (`ARG VITE_API_URL`) - este plugin e que torna o esquecimento
 * visivel ali.
 */
function requireApiUrlOnProductionBuild(): Plugin {
  return {
    name: 'vastaflow:require-api-url',
    configResolved(config) {
      if (config.command !== 'build' || !config.isProduction) {
        return;
      }

      // `config.env` e `Record<string, any>`; estreitar para `unknown` evita
      // propagar `any` (o lint do projeto trata `any` como erro).
      const apiUrl: unknown = config.env.VITE_API_URL;

      // Lanca a mensagem de `api-url.ts` quando a variavel falta.
      resolveApiUrl({
        PROD: true,
        VITE_API_URL: typeof apiUrl === 'string' ? apiUrl : undefined,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), requireApiUrlOnProductionBuild()],
  server: {
    // Porta que o backend libera no CORS (FRONTEND_ORIGIN no .env da raiz).
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // Fuso fixo, negativo como o do Brasil. Sem isto o resultado dependeria
      // da maquina: uma data `YYYY-MM-DD` do backend convertida por engano para
      // instante UTC aparece no dia certo numa maquina em UTC e um dia antes em
      // Brasilia. O bug passaria numa CI em UTC e apareceria so para quem usa o
      // sistema; com o fuso fixo, quem escorregar quebra o teste em qualquer lugar.
      TZ: 'America/Sao_Paulo',
    },
  },
});
