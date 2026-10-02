import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { Permissao } from '../api/types';

/** Exige login. Troca de senha provisória é obrigatória antes de qualquer outra tela. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, carregando, saiu } = useAuth();
  const loc = useLocation();
  if (carregando) return <div className="center-page">Carregando…</div>;
  if (!me) return <Navigate to="/login" replace state={saiu ? undefined : { from: loc.pathname }} />;
  if (me.trocarSenha && loc.pathname !== '/trocar-senha') return <Navigate to="/trocar-senha" replace />;
  return <>{children}</>;
}

/** Esconde a tela se o perfil não tiver nenhuma das permissões (conforto de UX; o servidor decide). */
export function RequirePermission({ perms, children }: { perms: Permissao[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perms)) {
    return (
      <div className="page"><div className="alert alert-error" role="alert">Seu perfil não tem acesso a esta tela.</div></div>
    );
  }
  return <>{children}</>;
}

/** Renderiza filhos só se o usuário tiver a permissão. */
export function Can({ perm, children }: { perm: Permissao | Permissao[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...(Array.isArray(perm) ? perm : [perm])) ? <>{children}</> : null;
}
