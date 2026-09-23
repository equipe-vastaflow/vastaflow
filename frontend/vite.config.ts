import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
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
