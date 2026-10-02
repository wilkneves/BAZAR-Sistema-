/**
 * Contas a receber / fiado: lista por cliente; receber total/parcial com ou sem caixa; extrato; estorno (Admin);
 * lançamento manual (contas_receber.lancar).
 */
import { useEffect, useState } from 'react';
import { caixaApi, clientesApi, contasReceberApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { CaixaSessao, Cliente, ContaReceber, ExtratoCliente } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { ConfirmMotivo } from '../../components/ConfirmMotivo';
import { Can } from '../../auth/guards';
import { formatDate, formatDateTime, maskPhone, todayLocal } from '../../lib/format';
import { fromCents, toCents, tryCents } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { useToast } from '../../components/Toast';

const TOM: Record<string, 'alerta' | 'info' | 'ok' | 'neutro'> = { ABERTA: 'alerta', PARCIAL: 'info', QUITADA: 'ok', CANCELADA: 'neutro' };

export function ContasReceberPage() {
  const toast = useToast();
  const [status, setStatus] = useState('ABERTA');
  const [page, setPage] = useState(1);
  const [receber, setReceber] = useState<ContaReceber | null>(null);
  const [extratoDe, setExtratoDe] = useState<string | null>(null);
  const [lancar, setLancar] = useState(false);
  const { data, erro, carregando, reload } = useAsync(() => contasReceberApi.listar({ status: status || undefined, page }), [status, page]);
  const hoje = todayLocal();

  return (
    <div className="page">
      <PageHeader titulo="Contas a receber / fiado"><Can perm="contas_receber.lancar"><button className="btn btn-primary" onClick={() => setLancar(true)}>+ Lançamento manual</button></Can></PageHeader>
      <div className="filters">
        <Field label="Status"><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option><option value="ABERTA">Abertas</option><option value="PARCIAL">Parciais</option><option value="QUITADA">Quitadas</option><option value="CANCELADA">Canceladas</option></select></Field>
      </div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <table className="table">
          <thead><tr><th>Cliente</th><th>Origem</th><th>Vencimento</th><th>Status</th><th className="num">Valor</th><th className="num">Saldo</th><th /></tr></thead>
          <tbody>{data.items.map((c) => (
            <tr key={c.id} className={(c.status === 'ABERTA' || c.status === 'PARCIAL') && c.vencimento < hoje ? 'linha-vencida' : ''}>
              <td><button className="link" onClick={() => setExtratoDe(c.clienteId)}>{c.clienteNome}</button></td>
              <td>{c.vendaNumero ? `Venda ${c.vendaNumero}` : c.descricao ?? 'Manual'}</td>
              <td>{formatDate(c.vencimento)}</td><td><Badge tom={TOM[c.status]}>{c.status}</Badge></td>
              <td className="num"><MoneyText value={c.valor} /></td><td className="num"><MoneyText value={c.saldo} /></td>
              <td>{(c.status === 'ABERTA' || c.status === 'PARCIAL') && <button className="btn btn-sm btn-primary" onClick={() => setReceber(c)}>Receber</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      <ReceberModal conta={receber} onFechar={() => setReceber(null)} onOk={async () => { toast('Recebimento registrado.'); await reload(); }} />
      <ExtratoModal clienteId={extratoDe} onFechar={() => setExtratoDe(null)} onAlterou={reload} />
      <LancarModal aberto={lancar} onFechar={() => setLancar(false)} onOk={async () => { toast('Conta lançada.'); await reload(); }} />
    </div>
  );
}

function ReceberModal({ conta, onFechar, onOk }: { conta: ContaReceber | null; onFechar: () => void; onOk: () => Promise<void> }) {
  const [valor, setValor] = useState('');
  const [noCaixa, setNoCaixa] = useState(true);
  const [caixa, setCaixa] = useState<CaixaSessao | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  // Descobre se o operador tem caixa aberto (para oferecer "receber no caixa").
  useEffect(() => {
    if (!conta) return;
    setValor(conta.saldo.replace('.', ',')); setCaixa(undefined); setErro(null);
    caixaApi.atual().then(setCaixa).catch(() => setCaixa(null));
  }, [conta]);
  const cents = tryCents(valor);
  const valido = conta && cents !== null && cents > 0 && cents <= toCents(conta.saldo);
  async function salvar() {
    if (!valido) return; setErro(null);
    try { await contasReceberApi.receber(conta!.id, { id: uuid(), valor: fromCents(cents!), caixaId: noCaixa && caixa ? caixa.id : undefined }); onFechar(); await onOk(); }
    catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo={`Receber de ${conta?.clienteNome ?? ''}`} aberto={!!conta} onFechar={onFechar} largura="sm"
      rodape={<><button className="btn" onClick={onFechar}>Voltar</button><button className="btn btn-primary" disabled={!valido} onClick={salvar}>Registrar</button></>}>
      <p>Saldo: <MoneyText value={conta?.saldo} /></p>
      <Field label="Valor recebido (R$)" hint="Pode ser parcial." erro={cents !== null && conta && cents > toCents(conta.saldo) ? 'Maior que o saldo' : null}>
        <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
      </Field>
      {caixa ? <label className="check"><input type="checkbox" checked={noCaixa} onChange={(e) => setNoCaixa(e.target.checked)} /> Entrou no caixa aberto ({caixa.terminalNome})</label>
        : caixa === null && <p className="muted">Sem caixa aberto: será registrado como recebimento fora do caixa.</p>}
      <ErrorAlert erro={erro} />
    </Modal>
  );
}

function ExtratoModal({ clienteId, onFechar, onAlterou }: { clienteId: string | null; onFechar: () => void; onAlterou: () => Promise<void> }) {
  const toast = useToast();
  const [estornar, setEstornar] = useState<string | null>(null);
  const ext = useAsync<ExtratoCliente | null>(() => (clienteId ? contasReceberApi.extrato(clienteId) : Promise.resolve(null)), [clienteId]);
  return (
    <Modal titulo={`Extrato — ${ext.data?.cliente.nome ?? ''}`} aberto={!!clienteId} onFechar={onFechar} largura="lg">
      <ErrorAlert erro={ext.erro} />
      {ext.data && (<>
        <p>Saldo devedor: <strong><MoneyText value={ext.data.saldoDevedor} /></strong></p>
        <h3>Contas</h3>
        <table className="table compact"><thead><tr><th>Origem</th><th>Vencimento</th><th>Status</th><th className="num">Valor</th><th className="num">Saldo</th></tr></thead>
          <tbody>{ext.data.contas.map((c) => <tr key={c.id}><td>{c.vendaNumero ? `Venda ${c.vendaNumero}` : c.descricao}</td><td>{formatDate(c.vencimento)}</td><td>{c.status}</td><td className="num"><MoneyText value={c.valor} /></td><td className="num"><MoneyText value={c.saldo} /></td></tr>)}</tbody></table>
        <h3>Recebimentos</h3>
        <table className="table compact"><thead><tr><th>Data</th><th>Onde</th><th className="num">Valor</th><th /></tr></thead>
          <tbody>{ext.data.recebimentos.map((r) => (
            <tr key={r.id} className={r.estornado ? 'riscado' : ''}><td>{formatDateTime(r.recebidoEm)}</td><td>{r.caixaId ? 'No caixa' : 'Fora do caixa'}{r.estornado && ' · estornado'}</td><td className="num"><MoneyText value={r.valor} /></td>
              <td><Can perm="recebimento.estornar">{!r.estornado && <button className="btn btn-sm btn-danger" onClick={() => setEstornar(r.id)}>Estornar</button>}</Can></td></tr>
          ))}</tbody></table>
      </>)}
      <ConfirmMotivo aberto={!!estornar} titulo="Estornar recebimento" descricao="O estorno é do valor inteiro e só pode ser feito uma vez." rotuloConfirmar="Estornar" onFechar={() => setEstornar(null)}
        onConfirmar={async (m) => { await contasReceberApi.estornar(estornar!, m); toast('Recebimento estornado.'); await ext.reload(); await onAlterou(); }} />
    </Modal>
  );
}

function LancarModal({ aberto, onFechar, onOk }: { aberto: boolean; onFechar: () => void; onOk: () => Promise<void> }) {
  const [termo, setTermo] = useState(''); const [clientes, setClientes] = useState<Cliente[]>([]); const [cliente, setCliente] = useState<Cliente | null>(null);
  const [descricao, setDescricao] = useState(''); const [valor, setValor] = useState(''); const [venc, setVenc] = useState(todayLocal(30));
  const [erro, setErro] = useState<string | null>(null);
  const cents = tryCents(valor);
  const valido = cliente && descricao.trim().length >= 3 && cents !== null && cents > 0;
  async function buscar() { try { setClientes(await clientesApi.buscar(termo, true)); } catch (e) { setErro(errorMessage(e)); } }
  async function salvar() {
    if (!valido) return; setErro(null);
    try { await contasReceberApi.lancar({ id: uuid(), clienteId: cliente!.id, descricao: descricao.trim(), valor: fromCents(cents!), vencimento: venc }); setCliente(null); setValor(''); setDescricao(''); onFechar(); await onOk(); }
    catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo="Lançamento manual a receber" aberto={aberto} onFechar={onFechar}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido} onClick={salvar}>Salvar</button></>}>
      {cliente ? <p>Cliente: <strong>{cliente.nome}</strong> <button className="btn btn-ghost" onClick={() => setCliente(null)}>Trocar</button></p> : (<>
        <div className="row"><Field label="Buscar cliente"><input value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscar(); } }} /></Field><button className="btn" onClick={buscar}>Buscar</button></div>
        <ul className="lista-escolha">{clientes.map((c) => <li key={c.id}><button className="btn btn-block" onClick={() => setCliente(c)}>{c.nome} <small>{maskPhone(c.telefone)}</small></button></li>)}</ul>
      </>)}
      <Field label="Descrição"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={150} /></Field>
      <div className="grid-2">
        <Field label="Valor (R$)"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
        <Field label="Vencimento"><input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} /></Field>
      </div>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
