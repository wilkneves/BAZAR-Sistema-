/** Contas a pagar: vencidas em destaque; lançar, pagar (opção "saiu do caixa" gera sangria), cancelar. */
import { useState } from 'react';
import { cadastrosApi, contasPagarApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { ContaPagar } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { ConfirmMotivo } from '../../components/ConfirmMotivo';
import { formatDate, todayLocal } from '../../lib/format';
import { fromCents, tryCents } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { useToast } from '../../components/Toast';

export function ContasPagarPage() {
  const toast = useToast();
  const [status, setStatus] = useState('ABERTA');
  const [page, setPage] = useState(1);
  const [novo, setNovo] = useState(false);
  const [pagar, setPagar] = useState<ContaPagar | null>(null);
  const [cancelar, setCancelar] = useState<ContaPagar | null>(null);
  const { data, erro, carregando, reload } = useAsync(() => contasPagarApi.listar({ status: status || undefined, page }), [status, page]);
  const hoje = todayLocal();

  return (
    <div className="page">
      <PageHeader titulo="Contas a pagar"><button className="btn btn-primary" onClick={() => setNovo(true)}>+ Lançar conta</button></PageHeader>
      <div className="filters">
        <Field label="Status"><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option><option value="ABERTA">Abertas</option><option value="PAGA">Pagas</option><option value="CANCELADA">Canceladas</option></select></Field>
      </div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <table className="table">
          <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Status</th><th className="num">Valor</th><th /></tr></thead>
          <tbody>{data.items.map((c) => {
            const vencida = c.status === 'ABERTA' && c.vencimento < hoje;
            return (
              <tr key={c.id} className={vencida ? 'linha-vencida' : ''}>
                <td>{formatDate(c.vencimento)} {vencida && <Badge tom="erro">Vencida</Badge>}</td>
                <td>{c.descricao}</td><td>{c.categoriaDespesaNome}</td>
                <td>{c.status === 'PAGA' ? <Badge tom="ok">Paga{c.saiuDoCaixa ? ' (caixa)' : ''}</Badge> : c.status === 'CANCELADA' ? <Badge>Cancelada</Badge> : <Badge tom="alerta">Aberta</Badge>}</td>
                <td className="num"><MoneyText value={c.valor} /></td>
                <td className="actions">{c.status === 'ABERTA' && <><button className="btn btn-sm btn-primary" onClick={() => setPagar(c)}>Pagar</button><button className="btn btn-sm" onClick={() => setCancelar(c)}>Cancelar</button></>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      <NovaContaModal aberto={novo} onFechar={() => setNovo(false)} onOk={async () => { toast('Conta lançada.'); await reload(); }} />
      <PagarModal conta={pagar} onFechar={() => setPagar(null)} onOk={async () => { toast('Pagamento registrado.'); await reload(); }} />
      <ConfirmMotivo aberto={!!cancelar} titulo="Cancelar conta a pagar" descricao={cancelar?.descricao ?? ''} onFechar={() => setCancelar(null)}
        onConfirmar={async (m) => { await contasPagarApi.cancelar(cancelar!.id, m); toast('Conta cancelada.'); await reload(); }} />
    </div>
  );
}

function NovaContaModal({ aberto, onFechar, onOk }: { aberto: boolean; onFechar: () => void; onOk: () => Promise<void> }) {
  const cats = useAsync(() => cadastrosApi.listar('categorias-despesa', { ativo: true }), []);
  const [descricao, setDescricao] = useState(''); const [cat, setCat] = useState(''); const [valor, setValor] = useState(''); const [venc, setVenc] = useState(todayLocal(7));
  const [erro, setErro] = useState<string | null>(null);
  const cents = tryCents(valor);
  const valido = descricao.trim().length >= 3 && cat && cents !== null && cents > 0 && venc;
  async function salvar() {
    if (!valido) return; setErro(null);
    try { await contasPagarApi.criar({ id: uuid(), descricao: descricao.trim(), categoriaDespesaId: cat, valor: fromCents(cents!), vencimento: venc }); setDescricao(''); setValor(''); onFechar(); await onOk(); }
    catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo="Lançar conta a pagar" aberto={aberto} onFechar={onFechar} largura="sm"
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" disabled={!valido} onClick={salvar}>Salvar</button></>}>
      <Field label="Descrição"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={150} autoFocus /></Field>
      <Field label="Categoria de despesa"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Selecione…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
      <div className="grid-2">
        <Field label="Valor (R$)"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
        <Field label="Vencimento"><input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} /></Field>
      </div>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}

function PagarModal({ conta, onFechar, onOk }: { conta: ContaPagar | null; onFechar: () => void; onOk: () => Promise<void> }) {
  const [doCaixa, setDoCaixa] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function pagar() {
    setErro(null);
    try { await contasPagarApi.pagar(conta!.id, doCaixa); setDoCaixa(false); onFechar(); await onOk(); } catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <Modal titulo="Pagar conta" aberto={!!conta} onFechar={onFechar} largura="sm"
      rodape={<><button className="btn" onClick={onFechar}>Voltar</button><button className="btn btn-primary" onClick={pagar}>Confirmar pagamento</button></>}>
      <p>{conta?.descricao} — <MoneyText value={conta?.valor} /></p>
      <label className="check"><input type="checkbox" checked={doCaixa} onChange={(e) => setDoCaixa(e.target.checked)} /> O dinheiro saiu do caixa (gera sangria no seu caixa aberto)</label>
      <ErrorAlert erro={erro} />
    </Modal>
  );
}
