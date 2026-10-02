/** Administração: usuários, perfis, terminais, parâmetros, instituição, regra fiscal, auditoria, importação, LGPD. */
import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { Permissao } from '../../api/types';
import { PageHeader, Tabs } from '../../components/ui';
import { UsuariosTab } from './UsuariosTab';
import { PerfisTab } from './PerfisTab';
import { TerminaisTab, ParametrosTab, InstituicaoTab, RegrasFiscaisTab, ImportacaoTab } from './ConfigTabs';
import { AuditoriaTab } from './AuditoriaTab';
import { LgpdTab } from './LgpdTab';

const ABAS: { id: string; rotulo: string; perm: Permissao; el: ReactElement }[] = [
  { id: 'usuarios', rotulo: 'Usuários', perm: 'usuarios.gerenciar', el: <UsuariosTab /> },
  { id: 'perfis', rotulo: 'Perfis e permissões', perm: 'perfis.gerenciar', el: <PerfisTab /> },
  { id: 'terminais', rotulo: 'Terminais', perm: 'terminais.gerenciar', el: <TerminaisTab /> },
  { id: 'parametros', rotulo: 'Parâmetros', perm: 'parametros.gerenciar', el: <ParametrosTab /> },
  { id: 'instituicao', rotulo: 'Instituição', perm: 'parametros.gerenciar', el: <InstituicaoTab /> },
  { id: 'fiscal', rotulo: 'Regra fiscal', perm: 'fiscal.gerenciar', el: <RegrasFiscaisTab /> },
  { id: 'auditoria', rotulo: 'Auditoria', perm: 'auditoria.consultar', el: <AuditoriaTab /> },
  { id: 'importacao', rotulo: 'Importação', perm: 'cadastros.gerenciar', el: <ImportacaoTab /> },
  { id: 'lgpd', rotulo: 'LGPD', perm: 'privacidade.gerenciar', el: <LgpdTab /> },
];

export function AdminPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const visiveis = ABAS.filter((a) => can(a.perm));
  if (!visiveis.length) return <div className="page"><div className="alert alert-error">Seu perfil não tem acesso à administração.</div></div>;
  const atual = loc.pathname.split('/')[2] ?? '';
  return (
    <div className="page">
      <PageHeader titulo="Administração" />
      <Tabs abas={visiveis.map(({ id, rotulo }) => ({ id, rotulo }))} atual={atual} onChange={(id) => nav(`/admin/${id}`)} />
      <Routes>
        {visiveis.map((a) => <Route key={a.id} path={a.id} element={a.el} />)}
        <Route path="*" element={<Navigate to={visiveis[0]!.id} replace />} />
      </Routes>
    </div>
  );
}
