/** ENT/TRI — lotes de entrada e triagem. */
import { http } from '../http';
import type { Etiqueta, LoteDetalhe, LoteEntrada, NovoLoteRequest, Page, TriagemDescarteRequest, TriagemItemRequest } from '../types';

export const lotesApi = {
  listar: (q: { parceiroId?: string; campanhaId?: string; status?: string; de?: string; ate?: string; page?: number }) =>
    http.get<Page<LoteEntrada>>('/lotes', { query: q }),
  obter: (id: string) => http.get<LoteDetalhe>(`/lotes/${id}`),
  criar: (l: NovoLoteRequest) => http.post<LoteEntrada>('/lotes', l),
  enviarDocumento: (id: string, arquivo: File) => {
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    return http.upload<void>(`/lotes/${id}/documento`, fd);
  },
  baixarDocumento: (id: string) => http.blob(`/lotes/${id}/documento`),
  aprovarItem: (loteId: string, item: TriagemItemRequest) => http.post<LoteDetalhe['itens'][number]>(`/lotes/${loteId}/itens`, item),
  descartar: (loteId: string, d: TriagemDescarteRequest) => http.post<LoteDetalhe['descartes'][number]>(`/lotes/${loteId}/descartes`, d),
  encerrar: (id: string) => http.post<LoteEntrada>(`/lotes/${id}/encerrar`),
  reabrir: (id: string, motivo: string) => http.post<LoteEntrada>(`/lotes/${id}/reabrir`, { motivo }),
  reverterDescarte: (descarteId: string, motivo: string) => http.post<void>(`/descartes/${descarteId}/reverter`, { motivo }),
  etiquetas: (itemIds: string[]) => http.get<Etiqueta[]>('/etiquetas', { query: { itens: itemIds.join(',') } }),
};
