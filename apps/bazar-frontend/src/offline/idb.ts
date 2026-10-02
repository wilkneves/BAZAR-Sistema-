/**
 * Wrapper mínimo de IndexedDB (sem dependência externa).
 * RNF-19 — o terminal guarda SOMENTE: catálogo/preços/regras fiscais vigentes, clientes do fiado
 * (nome + telefone), fila de vendas/clientes offline, carrinho em andamento e a sessão de caixa atual.
 * NUNCA: tokens, senhas, documentos, anexos.
 */
const DB_NAME = 'bazar-pdv';
const DB_VERSION = 1;
export type StoreName = 'kv' | 'filaVendas' | 'filaClientes';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('filaVendas')) db.createObjectStore('filaVendas', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('filaClientes')) db.createObjectStore('filaClientes', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idb = {
  get: <T>(store: StoreName, key: IDBValidKey) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  put: (store: StoreName, value: unknown, key?: IDBValidKey) => tx(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: StoreName, key: IDBValidKey) => tx(store, 'readwrite', (s) => s.delete(key)),
  getAll: <T>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  count: (store: StoreName) => tx<number>(store, 'readonly', (s) => s.count()),
};

/** Chaves do store 'kv'. */
export const KV = {
  catalogo: 'catalogo',
  catalogoEtag: 'catalogoEtag',
  carrinho: 'carrinho',
  caixaAtual: 'caixaAtual',
  terminalId: 'terminalId',
  seqLocal: 'seqLocal',
} as const;

/**
 * Logout / terminal desativado: apaga o banco local inteiro e os caches do Service Worker.
 * O logout é bloqueado enquanto houver vendas offline não sincronizadas (ver AuthContext),
 * para não apagar vendas que ainda não chegaram ao servidor.
 */
export async function clearLocalData() {
  if (dbPromise) { (await dbPromise).close(); dbPromise = null; }
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  navigator.serviceWorker?.controller?.postMessage('CLEAR_CACHES');
}
