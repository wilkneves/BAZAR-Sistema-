/**
 * Estado de conexão do PDV. Combina navigator.onLine com falhas reais de rede
 * (o navegador pode dizer "online" com o roteador sem internet).
 * Em DEV há também um "offline simulado" para testar o PWA sem desligar a rede.
 */
type Listener = (online: boolean) => void;
const listeners = new Set<Listener>();
let simulatedOffline = false;
let lastNetworkFailure = false;

export function isOnline(): boolean {
  return navigator.onLine && !simulatedOffline && !lastNetworkFailure;
}
function emit() { const v = isOnline(); listeners.forEach((l) => l(v)); }

export function subscribeConnectivity(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export function setSimulatedOffline(v: boolean) { simulatedOffline = v; emit(); }
export function isSimulatedOffline() { return simulatedOffline; }
/** Chamado pela camada HTTP: falha de rede marca offline; sucesso desmarca. */
export function reportNetwork(ok: boolean) {
  if (lastNetworkFailure === !ok) return;
  lastNetworkFailure = !ok; emit();
}

window.addEventListener('online', () => { lastNetworkFailure = false; emit(); });
window.addEventListener('offline', emit);
