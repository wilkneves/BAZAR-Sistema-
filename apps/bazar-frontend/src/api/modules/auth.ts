/** ACS — autenticação, usuários, perfis, auditoria. */
import { http, tokenStore } from '../http';
import type { AuditoriaRegistro, LoginResponse, Me, Page, Perfil, Permissao, Usuario } from '../types';

export const authApi = {
  async login(login: string, senha: string): Promise<Me> {
    const r = await http.post<LoginResponse>('/auth/login', { login, senha }, { auth: false });
    tokenStore.set(r.accessToken);
    return r.usuario;
  },
  async logout() {
    try { await http.post<void>('/auth/logout'); } finally { tokenStore.clear(); }
  },
  trocarSenha: (senhaAtual: string, novaSenha: string) => http.put<void>('/auth/senha', { senhaAtual, novaSenha }),
  me: () => http.get<Me>('/me'),
};

export const usuariosApi = {
  listar: (q: { busca?: string; ativo?: boolean; page?: number }) => http.get<Page<Usuario>>('/usuarios', { query: q }),
  criar: (u: { id: string; nome: string; login: string; perfilId: string }) => http.post<Usuario & { senhaProvisoria: string }>('/usuarios', u),
  atualizar: (id: string, patch: Partial<Pick<Usuario, 'nome' | 'perfilId' | 'ativo'>>) => http.patch<Usuario>(`/usuarios/${id}`, patch),
  redefinirSenha: (id: string) => http.post<{ senhaProvisoria: string }>(`/usuarios/${id}/redefinir-senha`),
};

export const perfisApi = {
  listar: () => http.get<Perfil[]>('/perfis'),
  permissoes: () => http.get<{ codigo: Permissao; descricao: string }[]>('/permissoes'),
  criar: (p: Omit<Perfil, 'padrao'>) => http.post<Perfil>('/perfis', p),
  atualizar: (id: string, patch: Partial<Pick<Perfil, 'nome' | 'permissoes' | 'limiteDesconto'>>) => http.patch<Perfil>(`/perfis/${id}`, patch),
};

export const auditoriaApi = {
  listar: (q: { acao?: string; entidade?: string; de?: string; ate?: string; page?: number }) =>
    http.get<Page<AuditoriaRegistro>>('/auditoria', { query: q }),
};
