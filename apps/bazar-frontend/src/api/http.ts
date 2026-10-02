/**
 * Cliente HTTP único da aplicação.
 *
 * Segurança (seção 3 — baseline):
 *  - Access token SÓ em memória (variável de módulo). Nunca localStorage/sessionStorage/IndexedDB.
 *  - Refresh token é cookie HttpOnly/Secure/SameSite=Strict: o JS não lê nem escreve; só enviamos
 *    `credentials: 'include'` para POST /auth/refresh.
 *  - Timeout em toda requisição (AbortController).
 *  - 401 -> uma única tentativa de refresh (single-flight) e repetição da chamada; falhou -> sessão expirada.
 *  - Erros normalizados em ProblemDetails (RFC 9457); nada de stack trace na UI.
 *  - Query string nunca deve conter PII (nome/telefone): buscas de cliente usam POST /clientes/busca.
 */
import type { ProblemDetails } from './types';
import { reportNetwork, isSimulatedOffline } from '../lib/connectivity';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';
const TIMEOUT_MS = 15_000;

// ---------------- Token em memória ----------------
let accessToken: string | null = null;
const sessionExpiredListeners = new Set<() => void>();
export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => { accessToken = t; },
  clear: () => { accessToken = null; },
  onSessionExpired(cb: () => void): () => void { sessionExpiredListeners.add(cb); return () => { sessionExpiredListeners.delete(cb); }; },
};

// ---------------- Erros ----------------
export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
  get status() { return this.problem.status; }
  get code() { return this.problem.code; }
}
/** Sem conexão / timeout: o PDV usa isso para cair no modo offline. */
export class NetworkError extends Error {
  constructor(message = 'Sem conexão com o servidor') { super(message); this.name = 'NetworkError'; }
}

// ---------------- Transporte (real ou mock) ----------------
export interface TransportRequest {
  method: string;
  path: string; // relativo a BASE, com query
  headers: Record<string, string>;
  body?: string | FormData;
}
export interface TransportResponse { status: number; headers: Record<string, string>; body: unknown }
export type Transport = (req: TransportRequest, signal: AbortSignal) => Promise<TransportResponse>;

const fetchTransport: Transport = async (req, signal) => {
  const res = await fetch(BASE + req.path, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    credentials: 'include', // envia o cookie HttpOnly de refresh (mesmo domínio / CORS restrito no servidor)
    signal,
    cache: 'no-store',
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const ct = headers['content-type'] ?? '';
  let body: unknown = null;
  if (res.status !== 204 && res.status !== 304) {
    body = ct.includes('json') ? await res.json().catch(() => null) : await res.blob();
  }
  return { status: res.status, headers, body };
};

let transport: Transport = fetchTransport;
/** Usado apenas em DEV para plugar a API simulada (src/mocks). */
export function setTransport(t: Transport) { transport = t; }

// ---------------- Núcleo ----------------
export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  formData?: FormData;
  /** false = rota pública (login/refresh). */
  auth?: boolean;
  headers?: Record<string, string>;
  /** Retorna também os cabeçalhos (ETag). */
  raw?: boolean;
  timeoutMs?: number;
}

function buildPath(path: string, query?: RequestOptions['query']) {
  if (!query) return path;
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

async function send(method: string, path: string, opts: RequestOptions): Promise<TransportResponse> {
  if (isSimulatedOffline()) { reportNetwork(false); throw new NetworkError(); }
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body: string | FormData | undefined;
  if (opts.formData) body = opts.formData; // o navegador define o boundary do multipart
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await transport({ method, path: buildPath(path, opts.query), headers, body }, ctrl.signal);
    reportNetwork(true);
    return res;
  } catch {
    reportNetwork(false);
    throw new NetworkError(ctrl.signal.aborted ? 'Tempo de resposta esgotado' : undefined);
  } finally {
    clearTimeout(timer);
  }
}

// Single-flight: várias chamadas recebendo 401 ao mesmo tempo disparam UM refresh.
let refreshing: Promise<boolean> | null = null;
export function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await send('POST', '/auth/refresh', { auth: false });
      if (res.status === 200) {
        tokenStore.set((res.body as { accessToken: string }).accessToken);
        return true;
      }
      tokenStore.clear();
      return false;
    } catch (e) {
      if (e instanceof NetworkError) throw e; // offline não é sessão expirada
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

function toProblem(res: TransportResponse): ProblemDetails {
  const b = res.body as Partial<ProblemDetails> | null;
  if (b && typeof b === 'object' && 'title' in b) return { type: 'about:blank', status: res.status, title: 'Erro', ...b };
  return { type: 'about:blank', status: res.status, title: DEFAULT_TITLES[res.status] ?? 'Erro inesperado' };
}
const DEFAULT_TITLES: Record<number, string> = {
  400: 'Dados inválidos', 401: 'Sessão expirada', 403: 'Você não tem permissão para esta ação',
  404: 'Registro não encontrado', 409: 'Operação recusada pela regra de negócio',
  413: 'Arquivo maior que o permitido', 415: 'Tipo de arquivo não aceito', 429: 'Muitas tentativas. Aguarde e tente novamente.',
};

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(method, path, opts);
  if (res.status === 401 && opts.auth !== false) {
    const ok = await refreshAccessToken();
    if (!ok) { sessionExpiredListeners.forEach((cb) => cb()); throw new ApiError(toProblem(res)); }
    res = await send(method, path, opts);
  }
  if (res.status >= 400) throw new ApiError(toProblem(res));
  if (opts.raw) return { body: res.body, headers: res.headers, status: res.status } as T;
  return res.body as T;
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body }),
  upload: <T>(path: string, form: FormData, opts?: RequestOptions) => request<T>('POST', path, { ...opts, formData: form, timeoutMs: 60_000 }),
  /** Download autenticado (relatórios, anexos, exportação LGPD). */
  blob: (path: string, opts?: RequestOptions) =>
    request<Blob>('GET', path, { ...opts, headers: { Accept: '*/*', ...opts?.headers }, timeoutMs: 60_000 }),
};

/** Mensagem amigável para exibir ao usuário a partir de qualquer erro. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const extra = e.problem.errors?.map((x) => (x.linha ? `Linha ${x.linha}: ` : x.campo ? `${x.campo}: ` : '') + x.mensagem).join(' · ');
    const ref = e.problem.requestId ? ` (ref. ${e.problem.requestId})` : '';
    return `${e.problem.detail ?? e.problem.title}${extra ? ` — ${extra}` : ''}${ref}`;
  }
  if (e instanceof NetworkError) return e.message;
  return 'Erro inesperado. Tente novamente.';
}
