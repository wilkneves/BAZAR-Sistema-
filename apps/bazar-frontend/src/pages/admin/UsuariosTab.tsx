/** Gestão de usuários: criar (senha provisória exibida uma única vez), trocar perfil, desativar, redefinir senha. */
import { useState } from 'react';
import { perfisApi, usuariosApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { Usuario } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { Badge, Empty, ErrorAlert, Field, Pagination } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { uuid } from '../../lib/uuid';
import { useToast } from '../../components/Toast';

export function UsuariosTab() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [novo, setNovo] = useState(false);
  const [senha, setSenha] = useState<{ login: string; senha: string } | null>(null);
  const perfis = useAsync(() => perfisApi.listar(), []);
  const { data, erro, carregando, reload } = useAsync(() => usuariosApi.listar({ page }), [page]);

  async function alterar(u: Usuario, patch: Partial<Pick<Usuario, 'perfilId' | 'ativo'>>) {
    try { await usuariosApi.atualizar(u.id, patch); toast('Usuário atualizado.'); await reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function redefinir(u: Usuario) {
    try { const r = await usuariosApi.redefinirSenha(u.id); setSenha({ login: u.login, senha: r.senhaProvisoria }); } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <section>
      <div className="row"><button className="btn btn-primary" onClick={() => setNovo(true)}>+ Novo usuário</button></div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <table className="table">
          <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th /></tr></thead>
          <tbody>{data.items.map((u) => (
            <tr key={u.id}>
              <td>{u.nome}</td><td>{u.login}</td>
              <td><select value={u.perfilId} onChange={(e) => alterar(u, { perfilId: e.target.value })} aria-label={`Perfil de ${u.nome}`}>{perfis.data?.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></td>
              <td>{u.ativo ? <Badge tom="ok">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
              <td className="actions"><button className="btn btn-sm" onClick={() => redefinir(u)}>Redefinir senha</button><button className="btn btn-sm" onClick={() => alterar(u, { ativo: !u.ativo })}>{u.ativo ? 'Desativar' : 'Reativar'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      <NovoUsuario aberto={novo} perfis={perfis.data ?? []} onFechar={() => setNovo(false)} onOk={async (login, s) => { setSenha({ login, senha: s }); await reload(); }} />
      {/* Senha provisória: mostrada uma vez, nunca guardada no front nem logada. */}
      <Modal titulo="Senha provisória" aberto={!!senha} onFechar={() => setSenha(null)} largura="sm" rodape={<button className="btn btn-primary" onClick={() => setSenha(null)}>Já anotei</button>}>
        <p>Entregue pessoalmente ao usuário <strong>{senha?.login}</strong>. Ela será trocada no primeiro acesso e não será exibida novamente.</p>
        <p className="senha-provisoria"><code>{senha?.senha}</code></p>
      </Modal>
    </section>
  );
}

function NovoUsuario({ aberto, perfis, onFechar, onOk }: { aberto: boolean; perfis: { id: string; nome: string }[]; onFechar: () => void; onOk: (login: string, senha: string) => Promise<void> }) {
  const [nome, setNome] = useState(''); const [login, setLogin] = useState(''); const [perfilId, setPerfilId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const valido = nome.trim().length >= 3 && /^[a-z0-9._-]{3,30}$/.test(login) && perfilId;
  async function salvar() {
    if (!valido) return; setErro(null);
    try { const u = await usuariosApi.criar({ id: uuid(), nome: nome.trim(), login, perfilId }); setNome(''); setLogin(''); onFechar(); await onOk(u.login, u.senhaProvisoria); }
    catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo="Novo usuário" aberto={aberto} onFechar={onFechar} largura="sm" rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido} onClick={salvar}>Criar</button></>}>
      <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus /></Field>
      <Field label="Login" hint="Minúsculas, números, ponto, hífen ou sublinhado."><input value={login} onChange={(e) => setLogin(e.target.value.toLowerCase())} maxLength={30} autoComplete="off" /></Field>
      <Field label="Perfil"><select value={perfilId} onChange={(e) => setPerfilId(e.target.value)}><option value="">Selecione…</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
