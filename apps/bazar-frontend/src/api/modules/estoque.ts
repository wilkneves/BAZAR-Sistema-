/** EST — estoque (saldo sempre vem de vw_saldo_estoque no servidor). */
import { http } from '../http';
import type { AjusteRequest, BaixaRequest, CargaInicialResultado, HistoricoEvento, ItemEstoque, LocalEstoque, Money, Page, TransferenciaRequest } from '../types';

export const estoqueApi = {
  listar: (q: { local?: LocalEstoque; categoriaId?: string; parceiroId?: string; campanhaId?: string; loteId?: string; busca?: string; page?: number }) =>
    http.get<Page<ItemEstoque>>('/estoque', { query: q }),
  historico: (itemId: string) => http.get<{ item: ItemEstoque; eventos: HistoricoEvento[] }>(`/itens/${itemId}/historico`),
  porCodigo: (codigo: string) => http.get<ItemEstoque>(`/itens/codigo/${encodeURIComponent(codigo)}`),
  transferir: (t: TransferenciaRequest) => http.post<void>('/transferencias', t),
  baixa: (b: BaixaRequest) => http.post<void>('/baixas', b),
  ajuste: (a: AjusteRequest) => http.post<void>('/ajustes', a),
  precoItem: (itemId: string, preco: Money, motivo: string) => http.patch<void>(`/itens/${itemId}/preco`, { preco, motivo }),
  precoCategoria: (categoriaId: string, preco: Money, motivo: string) => http.patch<void>(`/categorias/${categoriaId}/preco`, { preco, motivo }),
  cargaInicial: (arquivo: File) => {
    const fd = new FormData(); fd.append('arquivo', arquivo);
    return http.upload<CargaInicialResultado>('/carga-inicial', fd);
  },
};
