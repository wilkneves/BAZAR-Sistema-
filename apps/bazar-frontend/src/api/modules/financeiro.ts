/** FIN — contas a pagar/receber, recebimentos, extrato e resumo. */
import { http } from '../http';
import type { ContaPagar, ContaReceber, ExtratoCliente, Money, Page, Recebimento, ResumoFinanceiro } from '../types';

export const contasPagarApi = {
  listar: (q: { status?: string; de?: string; ate?: string; page?: number }) => http.get<Page<ContaPagar>>('/contas-pagar', { query: q }),
  criar: (c: { id: string; descricao: string; categoriaDespesaId: string; valor: Money; vencimento: string }) => http.post<ContaPagar>('/contas-pagar', c),
  atualizar: (id: string, patch: Partial<Pick<ContaPagar, 'descricao' | 'valor' | 'vencimento'>>) => http.patch<ContaPagar>(`/contas-pagar/${id}`, patch),
  /** saiuDoCaixa=true gera sangria ligada no caixa aberto do operador. */
  pagar: (id: string, saiuDoCaixa: boolean) => http.post<ContaPagar>(`/contas-pagar/${id}/pagar`, { saiuDoCaixa }),
  cancelar: (id: string, motivo: string) => http.post<ContaPagar>(`/contas-pagar/${id}/cancelar`, { motivo }),
};

export const contasReceberApi = {
  listar: (q: { status?: string; clienteId?: string; page?: number }) => http.get<Page<ContaReceber>>('/contas-receber', { query: q }),
  lancar: (c: { id: string; clienteId: string; descricao: string; valor: Money; vencimento: string }) => http.post<ContaReceber>('/contas-receber', c),
  /** Sem caixaId = recebimento fora do caixa. */
  receber: (contaId: string, r: { id: string; valor: Money; caixaId?: string }) => http.post<Recebimento>(`/contas-receber/${contaId}/recebimentos`, r),
  estornar: (recebimentoId: string, motivo: string) => http.post<void>(`/recebimentos/${recebimentoId}/estornar`, { motivo }),
  extrato: (clienteId: string) => http.get<ExtratoCliente>(`/clientes/${clienteId}/extrato`),
};

export const financeiroApi = {
  resumo: (de: string, ate: string) => http.get<ResumoFinanceiro>('/financeiro/resumo', { query: { de, ate } }),
};
