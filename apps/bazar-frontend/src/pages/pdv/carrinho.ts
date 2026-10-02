/** Carrinho do PDV. Preços aqui são só para exibição — o servidor recalcula tudo (seção 5). */
import type { VendaItemRequest } from '../../api/types';

export interface LinhaCarrinho {
  key: string;
  tipo: 'codigo' | 'categoria';
  codigo?: string;
  categoriaId?: string;
  descricao: string;
  precoCents: number;
  quantidade: number;
}

export const subtotalCents = (linhas: LinhaCarrinho[]) => linhas.reduce((s, l) => s + l.precoCents * l.quantidade, 0);

export function paraItensRequest(linhas: LinhaCarrinho[]): VendaItemRequest[] {
  return linhas.map((l) => (l.tipo === 'codigo'
    ? { codigo: l.codigo!, quantidade: 1 as const }
    : { categoriaId: l.categoriaId!, quantidade: l.quantidade }));
}
