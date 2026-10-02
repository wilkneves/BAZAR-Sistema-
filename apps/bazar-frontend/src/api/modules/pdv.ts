/** PDV — catálogo, vendas, sincronização e pendências. */
import { http } from '../http';
import type { CatalogoPdv, Page, Pendencia, SyncLoteRequest, SyncLoteResponse, Venda, VendaRequest } from '../types';

export const pdvApi = {
  /** Snapshot do terminal com ETag: 304 = catálogo local continua válido. */
  async catalogo(etag?: string): Promise<{ catalogo: CatalogoPdv | null; etag?: string }> {
    const r = await http.get<{ body: CatalogoPdv | null; headers: Record<string, string>; status: number }>('/pdv/catalogo', {
      raw: true, headers: etag ? { 'If-None-Match': etag } : {},
    });
    return { catalogo: r.status === 304 ? null : r.body, etag: r.headers.etag };
  },
  /** Idempotente: reenviar o mesmo id devolve a venda já gravada. */
  registrarVenda: (id: string, v: VendaRequest) => http.put<Venda>(`/vendas/${id}`, v),
  sincronizar: (lote: SyncLoteRequest) => http.post<SyncLoteResponse>('/sync/lote', lote, { timeoutMs: 60_000 }),
  listarVendas: (q: { de?: string; ate?: string; caixaId?: string; page?: number }) => http.get<Page<Venda>>('/vendas', { query: q }),
  comprovante: (id: string) => http.get<Venda>(`/vendas/${id}/comprovante`),
  cancelar: (id: string, motivo: string) => http.post<Venda>(`/vendas/${id}/cancelar`, { motivo }),
};

export const pendenciasApi = {
  listar: (q: { status?: string; page?: number }) => http.get<Page<Pendencia>>('/pendencias', { query: q }),
  reprocessar: (id: string) => http.post<Pendencia>(`/pendencias/${id}/reprocessar`),
  descartar: (id: string, justificativa: string) => http.post<Pendencia>(`/pendencias/${id}/descartar`, { justificativa }),
};
