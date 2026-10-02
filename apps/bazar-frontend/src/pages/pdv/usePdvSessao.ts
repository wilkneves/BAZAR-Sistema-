/**
 * Estado da sessão do PDV: caixa aberto, terminal do dispositivo e catálogo local.
 * Online: busca da API e atualiza o IndexedDB. Offline: usa o que está no IndexedDB.
 */
import { useCallback, useEffect, useState } from 'react';
import { caixaApi, pdvApi } from '../../api/modules';
import { ApiError, NetworkError, errorMessage } from '../../api/http';
import type { CaixaSessao, CatalogoPdv } from '../../api/types';
import { clearLocalData, idb, KV } from '../../offline/idb';
import { isOnline } from '../../lib/connectivity';

export interface PdvSessao {
  caixa: CaixaSessao | null;
  catalogo: CatalogoPdv | null;
  carregando: boolean;
  erro: string | null;
  semCaixa: boolean;
  terminalDesativado: boolean;
  recarregarCatalogo: () => Promise<void>;
  atualizarCatalogoLocal: (fn: (c: CatalogoPdv) => CatalogoPdv) => Promise<void>;
}

export function usePdvSessao(): PdvSessao {
  const [caixa, setCaixa] = useState<CaixaSessao | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoPdv | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semCaixa, setSemCaixa] = useState(false);
  const [terminalDesativado, setTerminalDesativado] = useState(false);

  const recarregarCatalogo = useCallback(async () => {
    const local = await idb.get<CatalogoPdv>('kv', KV.catalogo);
    if (isOnline()) {
      try {
        const etag = local ? await idb.get<string>('kv', KV.catalogoEtag) : undefined;
        const r = await pdvApi.catalogo(etag);
        if (r.catalogo) {
          await idb.put('kv', r.catalogo, KV.catalogo);
          if (r.etag) await idb.put('kv', r.etag, KV.catalogoEtag);
          setCatalogo(r.catalogo);
          return;
        }
      } catch (e) { if (!(e instanceof NetworkError)) throw e; }
    }
    if (local) setCatalogo(local);
    else throw new Error('Catálogo não disponível neste dispositivo. Conecte-se à internet para carregá-lo.');
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        let cx: CaixaSessao | undefined;
        if (isOnline()) {
          try { cx = await caixaApi.atual(); await idb.put('kv', cx, KV.caixaAtual); }
          catch (e) {
            if (e instanceof ApiError && e.status === 404) { await idb.del('kv', KV.caixaAtual); if (vivo) setSemCaixa(true); return; }
            if (e instanceof ApiError && e.code === 'TERMINAL_DESATIVADO') {
              await clearLocalData(); if (vivo) setTerminalDesativado(true); return; // RNF-09
            }
            if (!(e instanceof NetworkError)) throw e;
          }
        }
        cx ??= await idb.get<CaixaSessao>('kv', KV.caixaAtual);
        if (!cx) { if (vivo) setSemCaixa(true); return; }
        if (vivo) setCaixa(cx);
        await recarregarCatalogo();
      } catch (e) { if (vivo) setErro(e instanceof Error && !(e instanceof ApiError) ? e.message : errorMessage(e)); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [recarregarCatalogo]);

  const atualizarCatalogoLocal = useCallback(async (fn: (c: CatalogoPdv) => CatalogoPdv) => {
    setCatalogo((atual) => {
      if (!atual) return atual;
      const novo = fn(atual);
      void idb.put('kv', novo, KV.catalogo);
      return novo;
    });
  }, []);

  return { caixa, catalogo, carregando, erro, semCaixa, terminalDesativado, recarregarCatalogo, atualizarCatalogoLocal };
}
