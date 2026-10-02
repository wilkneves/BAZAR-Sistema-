/**
 * Bloqueio temporário após senhas erradas (RNF-07: 5 tentativas -> 10 min).
 * Implementação em memória do processo. O doc 04 prevê Redis para isso (RNF-17: se o Redis cair,
 * o sistema continua); com mais de uma instância da API, trocar por um store compartilhado
 * com a mesma interface. Somado ao rate limit por IP das rotas /auth/*.
 */
const MAX_ERROS = 5;
const BLOQUEIO_MS = 10 * 60_000;
const JANELA_MS = 15 * 60_000;
const MAX_CHAVES = 10_000;

interface Registro { erros: number; primeiroErro: number; bloqueadoAte: number }
const mapa = new Map<string, Registro>();

export const tentativas = {
  bloqueadoAte(login: string): number | null {
    const r = mapa.get(login);
    if (!r) return null;
    if (r.bloqueadoAte > Date.now()) return r.bloqueadoAte;
    return null;
  },
  registrarErro(login: string): void {
    const agora = Date.now();
    let r = mapa.get(login);
    if (!r || agora - r.primeiroErro > JANELA_MS) r = { erros: 0, primeiroErro: agora, bloqueadoAte: 0 };
    r.erros++;
    if (r.erros >= MAX_ERROS) { r.bloqueadoAte = agora + BLOQUEIO_MS; r.erros = 0; r.primeiroErro = agora; }
    if (mapa.size >= MAX_CHAVES && !mapa.has(login)) {
      // evita crescimento sem limite por logins aleatórios: descarta o mais antigo
      const primeira = mapa.keys().next().value;
      if (primeira !== undefined) mapa.delete(primeira);
    }
    mapa.set(login, r);
  },
  limpar(login: string): void { mapa.delete(login); },
};
