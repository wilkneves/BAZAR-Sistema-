/**
 * Layout do Backoffice: navegação lateral filtrada pelas permissões do perfil.
 * Esconder item de menu é só conforto — a API recusa com 403 de qualquer forma.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { Permissao } from '../api/types';
import { useToast } from './Toast';
import { useOnline } from '../offline/hooks';

interface ItemMenu { to: string; rotulo: string; perms: Permissao[] }
const MENU: { grupo: string; itens: ItemMenu[] }[] = [
  { grupo: 'Operação', itens: [
    { to: '/pdv', rotulo: 'PDV — Vender', perms: ['caixa.operar'] },
    { to: '/vendas', rotulo: 'Vendas', perms: ['caixa.operar', 'venda.cancelar'] },
  ] },
  { grupo: 'Entradas e estoque', itens: [
    { to: '/entradas', rotulo: 'Lotes de entrada', perms: ['entrada.registrar'] },
    { to: '/estoque', rotulo: 'Estoque', perms: ['estoque.consultar'] },
    { to: '/estoque/transferir', rotulo: 'Transferência', perms: ['estoque.transferir'] },
    { to: '/estoque/ajustes', rotulo: 'Baixa / ajuste / preço', perms: ['estoque.ajustar'] },
  ] },
  { grupo: 'Financeiro', itens: [
    { to: '/financeiro/pagar', rotulo: 'Contas a pagar', perms: ['contas_pagar.gerenciar'] },
    { to: '/financeiro/receber', rotulo: 'Contas a receber / fiado', perms: ['contas_receber.receber'] },
    { to: '/financeiro/resumo', rotulo: 'Resumo financeiro', perms: ['relatorios.consultar'] },
  ] },
  { grupo: 'Gestão', itens: [
    { to: '/relatorios/prestacao-contas', rotulo: 'Relatórios', perms: ['relatorios.consultar'] },
    { to: '/sincronizacao', rotulo: 'Pendências de sincronização', perms: ['sincronizacao.resolver'] },
    { to: '/cadastros/categorias', rotulo: 'Cadastros', perms: ['cadastros.gerenciar', 'cadastros.consultar', 'clientes.gerenciar'] },
    { to: '/admin', rotulo: 'Administração', perms: ['usuarios.gerenciar', 'perfis.gerenciar', 'parametros.gerenciar', 'auditoria.consultar', 'terminais.gerenciar', 'privacidade.gerenciar', 'fiscal.gerenciar'] },
  ] },
];

export function Layout() {
  const { me, can, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const online = useOnline();
  const [menuAberto, setMenuAberto] = useState(false);

  async function sair() {
    try { await logout(); nav('/login', { replace: true }); }
    catch (e) { toast((e as Error).message, 'erro'); }
  }

  return (
    <div className="shell">
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <aside className={`sidebar ${menuAberto ? 'open' : ''}`}>
        <div className="brand">Bazar Luz da Esperança</div>
        <nav aria-label="Menu principal" onClick={() => setMenuAberto(false)}>
          <NavLink to="/" end className="nav-item">Início</NavLink>
          {MENU.map((g) => {
            const itens = g.itens.filter((i) => can(...i.perms));
            if (!itens.length) return null;
            return (
              <div key={g.grupo} className="nav-group">
                <div className="nav-group-title">{g.grupo}</div>
                {itens.map((i) => <NavLink key={i.to} to={i.to} className="nav-item">{i.rotulo}</NavLink>)}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost menu-toggle" onClick={() => setMenuAberto((v) => !v)} aria-label="Abrir menu">☰</button>
          {!online && <span className="badge badge-erro">Sem conexão — o Backoffice exige internet</span>}
          <div className="spacer" />
          <span className="user">{me?.nome} · <small>{me?.perfil.nome}</small></span>
          <NavLink to="/trocar-senha" className="btn btn-ghost">Senha</NavLink>
          <button className="btn" onClick={sair}>Sair</button>
        </header>
        <main id="conteudo" className="content"><Outlet /></main>
      </div>
    </div>
  );
}
