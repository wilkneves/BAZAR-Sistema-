/** ADM / PRV — parâmetros, importações e direitos do titular (LGPD). */
import { http } from '../http';
import type { ImportacaoResultado, Parametro } from '../types';

export type TipoTitular = 'cliente';

export const parametrosApi = {
  listar: () => http.get<Parametro[]>('/parametros'),
  salvar: (valores: { chave: string; valor: string }[]) => http.put<Parametro[]>('/parametros', { valores }),
};

export const importacoesApi = {
  importar: (tipo: 'categorias' | 'parceiros' | 'campanhas' | 'clientes', arquivo: File) => {
    const fd = new FormData(); fd.append('arquivo', arquivo);
    return http.upload<ImportacaoResultado>(`/importacoes/${tipo}`, fd);
  },
};

export const privacidadeApi = {
  exportar: (tipo: TipoTitular, id: string) => http.blob(`/titulares/${tipo}/${id}/exportar`),
  /** Com débito em aberto, o servidor responde 409 CLIENTE_COM_DEBITO; reenviar com confirmar=true. */
  anonimizar: (tipo: TipoTitular, id: string, motivo: string, confirmar = false) =>
    http.post<void>(`/titulares/${tipo}/${id}/anonimizar`, { motivo, confirmar }),
};
