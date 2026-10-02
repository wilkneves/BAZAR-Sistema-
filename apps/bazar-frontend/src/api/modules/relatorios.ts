/** REL — relatórios (JSON para tela; PDF/CSV/XLSX para download) e FIS — regras fiscais. */
import { http } from '../http';
import type { RegraFiscal, RelatorioResposta, TipoRelatorio } from '../types';

export type FormatoExportacao = 'pdf' | 'csv' | 'xlsx';
export type FiltroRelatorio = { de: string; ate: string; modo?: 'parceiro' | 'campanha'; local?: string };

export const relatoriosApi = {
  consultar: (tipo: TipoRelatorio, f: FiltroRelatorio) =>
    http.get<RelatorioResposta>(`/relatorios/${tipo}`, { query: { ...f, formato: 'json' } }),
  exportar: (tipo: TipoRelatorio, f: FiltroRelatorio, formato: FormatoExportacao) =>
    http.blob(`/relatorios/${tipo}`, { query: { ...f, formato } }),
};

export const regrasFiscaisApi = {
  listar: () => http.get<RegraFiscal[]>('/regras-fiscais'),
  /** Nova regra encerra a anterior do mesmo alvo (servidor). */
  criar: (r: Omit<RegraFiscal, 'vigenciaFim' | 'alvoNome'>) => http.post<RegraFiscal>('/regras-fiscais', r),
};
