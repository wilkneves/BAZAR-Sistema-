/** CAD — cadastros. Sem DELETE: desativar = PATCH { ativo: false } (RN-24). */
import { http } from '../http';
import type { Campanha, Categoria, CategoriaDespesa, Cliente, Instituicao, Motivo, Parceiro } from '../types';

export type TipoCadastro = 'categorias' | 'parceiros' | 'campanhas' | 'motivos-descarte' | 'motivos-baixa' | 'categorias-despesa';
type MapaTipo = {
  categorias: Categoria; parceiros: Parceiro; campanhas: Campanha;
  'motivos-descarte': Motivo; 'motivos-baixa': Motivo; 'categorias-despesa': CategoriaDespesa;
};

export const cadastrosApi = {
  listar: <K extends TipoCadastro>(tipo: K, q: { busca?: string; ativo?: boolean } = {}) =>
    http.get<MapaTipo[K][]>(`/${tipo}`, { query: q }),
  criar: <K extends TipoCadastro>(tipo: K, dados: Partial<MapaTipo[K]> & { id: string }) => http.post<MapaTipo[K]>(`/${tipo}`, dados),
  atualizar: <K extends TipoCadastro>(tipo: K, id: string, patch: Partial<MapaTipo[K]>) => http.patch<MapaTipo[K]>(`/${tipo}/${id}`, patch),
};

export const clientesApi = {
  /** Busca por nome vai no CORPO do POST para não expor PII em URL/log de acesso. */
  buscar: (termo: string, ativo?: boolean) => http.post<Cliente[]>('/clientes/busca', { termo, ativo }),
  /** Aceita id gerado no cliente (cadastro offline/rápido no PDV). */
  criar: (c: { id: string; nome: string; telefone: string; cienciaAviso: boolean }) => http.post<Cliente>('/clientes', c),
  atualizar: (id: string, patch: Partial<Pick<Cliente, 'nome' | 'telefone' | 'ativo'>>) => http.patch<Cliente>(`/clientes/${id}`, patch),
};

export const instituicaoApi = {
  obter: () => http.get<Instituicao>('/instituicao'),
  salvar: (i: Instituicao) => http.put<Instituicao>('/instituicao', i),
};
