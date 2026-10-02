import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O back-end (Fastify) roda separado; em dev com API real, o proxy evita CORS.
// Com VITE_USE_MOCK=true o proxy não é usado: a camada src/mocks responde em memória.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { sourcemap: false, target: 'es2022' },
});
