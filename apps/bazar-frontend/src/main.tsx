import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setTransport } from './api/http';
import './styles/global.css';

async function bootstrap() {
  // API simulada SÓ em desenvolvimento: em `vite build`, import.meta.env.DEV é `false`
  // e o bloco (com o import dinâmico) é removido do bundle de produção.
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true') {
    const { mockTransport } = await import('./mocks/server');
    setTransport(mockTransport);
    console.info('[dev] API simulada ativa — usuários: admin / caixa / triagem (ver README)');
  }
  // Service Worker só em produção (em dev atrapalha o HMR).
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA indisponível: segue online */ });
  }
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
void bootstrap();
