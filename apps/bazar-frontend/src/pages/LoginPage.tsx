/** Login — mensagem genérica de recusa (não revela se o login existe); bloqueio é do servidor. */
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, errorMessage } from '../api/http';
import { ErrorAlert, Field } from '../components/ui';
import type { Me } from '../api/types';

/** Destino pós-login: troca de senha > rota pedida > PDV (perfil só de caixa) > início. */
function destino(u: Me, from?: string) {
  if (u.trocarSenha) return '/trocar-senha';
  if (from && from !== '/login') return from;
  const soCaixa = u.permissoes.includes('caixa.operar') && !u.permissoes.some((p) => ['estoque.ajustar', 'entrada.registrar', 'relatorios.consultar'].includes(p));
  return soCaixa ? '/pdv' : '/';
}

export function LoginPage() {
  const { me, login, sessaoExpirada } = useAuth();
  const loc = useLocation() as { state?: { from?: string } };
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Único ponto de redirecionamento (evita corrida entre <Navigate> e navigate()).
  if (me) return <Navigate to={destino(me, loc.state?.from)} replace />;

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true); setErro(null);
    try {
      await login(usuario.trim(), senha); // o re-render com `me` faz o redirecionamento
      setSenha('');
    } catch (err) {
      setErro(err instanceof ApiError && err.status === 401 ? 'Login ou senha inválidos.' : errorMessage(err));
      setSenha('');
    } finally { setEnviando(false); }
  }

  return (
    <div className="center-page">
      <form className="card login-card" onSubmit={entrar} noValidate>
        <h1>Bazar Luz da Esperança</h1>
        <p className="muted">Entre com seu usuário e senha.</p>
        {sessaoExpirada && <div className="alert alert-info">Sua sessão expirou. Entre novamente — o carrinho em andamento foi preservado.</div>}
        <Field label="Usuário">
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoFocus required maxLength={60} />
        </Field>
        <Field label="Senha">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required maxLength={128} />
        </Field>
        <ErrorAlert erro={erro} />
        <button className="btn btn-primary btn-block" disabled={enviando || !usuario || !senha}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
