/** CXA — terminais e sessões de caixa. */
import { http } from '../http';
import type { CaixaLancamentoRequest, CaixaSessao, Money, Page, PreviaFechamento, Terminal } from '../types';

export const terminaisApi = {
  listar: (q: { ativo?: boolean } = {}) => http.get<Terminal[]>('/terminais', { query: q }),
  criar: (t: { id: string; nome: string }) => http.post<Terminal>('/terminais', t),
  atualizar: (id: string, patch: Partial<Pick<Terminal, 'nome' | 'ativo'>>) => http.patch<Terminal>(`/terminais/${id}`, patch),
};

export const caixaApi = {
  /** 404 = nenhum caixa aberto para este operador/terminal. */
  atual: () => http.get<CaixaSessao>('/caixas/atual'),
  abrir: (c: { id: string; terminalId: string; fundoTroco: Money }) => http.post<CaixaSessao>('/caixas', c),
  lancar: (caixaId: string, l: CaixaLancamentoRequest) => http.post<void>(`/caixas/${caixaId}/lancamentos`, l),
  previaFechamento: (caixaId: string) => http.get<PreviaFechamento>(`/caixas/${caixaId}/previa-fechamento`),
  fechar: (caixaId: string, contado: Money, observacao?: string) => http.post<CaixaSessao>(`/caixas/${caixaId}/fechar`, { contado, observacao }),
  historico: (q: { de?: string; ate?: string; page?: number }) => http.get<Page<CaixaSessao>>('/caixas', { query: q }),
};
