/**
 * Cadastros genéricos (categorias, parceiros, campanhas, motivos, categorias de despesa, clientes).
 * Nada é excluído: só desativa (RN-24). Busca de clientes vai no corpo de POST (sem PII na URL).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cadastrosApi, clientesApi, type TipoCadastro } from '../api/modules';
import { errorMessage } from '../api/http';
import { useAsync } from '../components/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Tabs } from '../components/ui';
import { Modal } from '../components/Modal';
import { useAuth } from '../auth/AuthContext';
import { fromCents, toCents, tryCents } from '../lib/money';
import { formatDate, maskPhone } from '../lib/format';
import { uuid } from '../lib/uuid';
import { useToast } from '../components/Toast';

type Tipo = TipoCadastro | 'clientes';
interface Campo { chave: string; rotulo: string; tipo: 'text' | 'money' | 'bool' | 'date' | 'tel' }
const CONFIG: Record<Tipo, { titulo: string; campos: Campo[] }> = {
  categorias: { titulo: 'Categorias', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }, { chave: 'precoPadrao', rotulo: 'Preço padrão', tipo: 'money' }, { chave: 'vendaPorCategoria', rotulo: 'Vende por categoria no PDV', tipo: 'bool' }] },
  parceiros: { titulo: 'Parceiros', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }] },
  campanhas: { titulo: 'Campanhas', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }, { chave: 'inicio', rotulo: 'Início', tipo: 'date' }, { chave: 'fim', rotulo: 'Fim', tipo: 'date' }] },
  'motivos-descarte': { titulo: 'Motivos de descarte', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }] },
  'motivos-baixa': { titulo: 'Motivos de baixa', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }] },
  'categorias-despesa': { titulo: 'Categorias de despesa', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }] },
  clientes: { titulo: 'Clientes', campos: [{ chave: 'nome', rotulo: 'Nome', tipo: 'text' }, { chave: 'telefone', rotulo: 'Telefone', tipo: 'tel' }] },
};
type Registro = Record<string, unknown> & { id: string; nome: string; ativo: boolean; especial?: boolean };

export function CadastrosPage() {
  const { tipo: tipoParam = 'categorias' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const tipo = (tipoParam in CONFIG ? tipoParam : 'categorias') as Tipo;
  const cfg = CONFIG[tipo];
  const podeEditar = tipo === 'clientes' ? can('clientes.gerenciar') : can('cadastros.gerenciar');
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [ativo, setAtivo] = useState<'true' | 'false' | ''>('true');
  const [editando, setEditando] = useState<Registro | 'novo' | null>(null);

  const abas = (Object.keys(CONFIG) as Tipo[])
    .filter((t) => (t === 'clientes' ? can('clientes.gerenciar') : can('cadastros.gerenciar', 'cadastros.consultar')))
    .map((t) => ({ id: t, rotulo: CONFIG[t].titulo }));

  const lista = useAsync<Registro[]>(async () => {
    const a = ativo === '' ? undefined : ativo === 'true';
    if (tipo === 'clientes') return (await clientesApi.buscar(termo, a)) as unknown as Registro[];
    return (await cadastrosApi.listar(tipo, { busca: termo || undefined, ativo: a })) as unknown as Registro[];
  }, [tipo, termo, ativo]);

  async function alternarAtivo(r: Registro) {
    try {
      if (tipo === 'clientes') await clientesApi.atualizar(r.id, { ativo: !r.ativo });
      else await cadastrosApi.atualizar(tipo, r.id, { ativo: !r.ativo } as never);
      toast(r.ativo ? 'Desativado.' : 'Reativado.'); await lista.reload();
    } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Cadastros">{podeEditar && <button className="btn btn-primary" onClick={() => setEditando('novo')}>+ Novo</button>}</PageHeader>
      <Tabs abas={abas} atual={tipo} onChange={(t) => nav(`/cadastros/${t}`)} />
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setTermo(busca.trim()); }}>
        <Field label="Buscar"><input value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" /></Field>
        <Field label="Situação"><select value={ativo} onChange={(e) => setAtivo(e.target.value as typeof ativo)}><option value="true">Ativos</option><option value="false">Inativos</option><option value="">Todos</option></select></Field>
        <button className="btn">Buscar</button>
      </form>
      <ErrorAlert erro={lista.erro} />
      {lista.carregando ? <p>Carregando…</p> : !lista.data?.length ? <Empty /> : (
        <table className="table">
          <thead><tr>{cfg.campos.map((c) => <th key={c.chave}>{c.rotulo}</th>)}<th>Situação</th><th /></tr></thead>
          <tbody>{lista.data.map((r) => (
            <tr key={r.id}>
              {cfg.campos.map((c) => <td key={c.chave}>{exibir(c, r[c.chave])}</td>)}
              <td>{r.ativo ? <Badge tom="ok">Ativo</Badge> : <Badge>Inativo</Badge>}{r.especial && <Badge tom="info">Especial</Badge>}</td>
              <td className="actions">{podeEditar && <>
                <button className="btn btn-sm" onClick={() => setEditando(r)}>Editar</button>
                {!r.especial && <button className="btn btn-sm" onClick={() => alternarAtivo(r)}>{r.ativo ? 'Desativar' : 'Reativar'}</button>}
              </>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {editando && <EditarModal tipo={tipo} campos={cfg.campos} registro={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} onOk={async () => { toast('Salvo.'); await lista.reload(); }} />}
    </div>
  );
}

function exibir(c: Campo, v: unknown) {
  if (c.tipo === 'money') return <MoneyText value={v as string} />;
  if (c.tipo === 'bool') return v ? 'Sim' : 'Não';
  if (c.tipo === 'date') return formatDate(v as string);
  if (c.tipo === 'tel') return maskPhone(v as string); // minimização de PII em listas
  return String(v ?? '—');
}

function EditarModal({ tipo, campos, registro, onFechar, onOk }: { tipo: Tipo; campos: Campo[]; registro: Registro | null; onFechar: () => void; onOk: () => Promise<void> }) {
  const [vals, setVals] = useState<Record<string, string | boolean>>(() => Object.fromEntries(campos.map((c) => {
    const v = registro?.[c.chave];
    return [c.chave, c.tipo === 'bool' ? Boolean(v ?? true) : c.tipo === 'money' && v ? String(v).replace('.', ',') : String(v ?? '')];
  })));
  const [ciencia, setCiencia] = useState(!!registro);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const invalido = campos.some((c) => (c.tipo === 'text' && String(vals[c.chave]).trim().length < 2) || (c.tipo === 'money' && (tryCents(String(vals[c.chave])) ?? 0) <= 0)
    || (c.tipo === 'tel' && String(vals[c.chave]).replace(/\D/g, '').length < 10)) || (tipo === 'clientes' && !registro && !ciencia);

  async function salvar() {
    if (invalido) return;
    setEnviando(true); setErro(null);
    const dados: Record<string, unknown> = {};
    campos.forEach((c) => {
      const v = vals[c.chave];
      dados[c.chave] = c.tipo === 'money' ? fromCents(toCents(String(v))) : c.tipo === 'bool' ? v : c.tipo === 'date' ? (v || undefined) : String(v).trim();
    });
    try {
      if (tipo === 'clientes') {
        if (registro) await clientesApi.atualizar(registro.id, dados);
        else await clientesApi.criar({ id: uuid(), nome: String(dados.nome), telefone: String(dados.telefone), cienciaAviso: true });
      } else if (registro) await cadastrosApi.atualizar(tipo, registro.id, dados as never);
      else await cadastrosApi.criar(tipo, { ...dados, id: uuid() } as never);
      onFechar(); await onOk();
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }

  return (
    <Modal titulo={registro ? 'Editar' : 'Novo cadastro'} aberto onFechar={onFechar} largura="sm" fechavel={!enviando}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={invalido || enviando} onClick={salvar}>Salvar</button></>}>
      {campos.map((c) => c.tipo === 'bool'
        ? <label key={c.chave} className="check"><input type="checkbox" checked={!!vals[c.chave]} onChange={(e) => setVals({ ...vals, [c.chave]: e.target.checked })} /> {c.rotulo}</label>
        : <Field key={c.chave} label={c.rotulo}><input type={c.tipo === 'date' ? 'date' : c.tipo === 'tel' ? 'tel' : 'text'} inputMode={c.tipo === 'money' ? 'decimal' : undefined} value={String(vals[c.chave])} onChange={(e) => setVals({ ...vals, [c.chave]: e.target.value })} maxLength={120} /></Field>)}
      {tipo === 'clientes' && !registro && (
        <label className="check"><input type="checkbox" checked={ciencia} onChange={(e) => setCiencia(e.target.checked)} /> Cliente ciente do aviso de privacidade (finalidade: controle de fiado e contato sobre débitos).</label>
      )}
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
