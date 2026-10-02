/** Vendas do dia/período: reimpressão e cancelamento com motivo (Admin). */
import { useState } from 'react';
import { pdvApi } from '../api/modules';
import { errorMessage } from '../api/http';
import type { Venda } from '../api/types';
import { useAsync } from '../components/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination } from '../components/ui';
import { ConfirmMotivo } from '../components/ConfirmMotivo';
import { ComprovanteModal } from './pdv/ComprovanteModal';
import { Can } from '../auth/guards';
import { formatDateTime, todayLocal } from '../lib/format';
import { useToast } from '../components/Toast';

export function VendasPage() {
  const toast = useToast();
  const [de, setDe] = useState(todayLocal());
  const [ate, setAte] = useState(todayLocal());
  const [page, setPage] = useState(1);
  const [cancelar, setCancelar] = useState<Venda | null>(null);
  const [reimprimir, setReimprimir] = useState<Venda | null>(null);
  const { data, erro, carregando, reload } = useAsync(() => pdvApi.listarVendas({ de, ate, page }), [de, ate, page]);

  async function abrirComprovante(v: Venda) {
    try { setReimprimir(await pdvApi.comprovante(v.id)); } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Vendas" />
      <div className="filters">
        <Field label="De"><input type="date" value={de} onChange={(e) => { setDe(e.target.value); setPage(1); }} /></Field>
        <Field label="Até"><input type="date" value={ate} onChange={(e) => { setAte(e.target.value); setPage(1); }} /></Field>
      </div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <table className="table">
          <thead><tr><th>Nº</th><th>Data/hora</th><th>Operador</th><th>Origem</th><th>Status</th><th className="num">Total</th><th /></tr></thead>
          <tbody>
            {data.items.map((v) => (
              <tr key={v.id}>
                <td>{v.numero ?? v.numeroLocal}</td>
                <td>{formatDateTime(v.ocorridaEm)}</td>
                <td>{v.operadorNome}</td>
                <td>{v.origem === 'OFFLINE' ? <Badge tom="info">Offline</Badge> : 'Online'}</td>
                <td>{v.status === 'CANCELADA' ? <Badge tom="erro">Cancelada</Badge> : <Badge tom="ok">Concluída</Badge>}</td>
                <td className="num"><MoneyText value={v.total} /></td>
                <td className="actions">
                  <button className="btn btn-sm" onClick={() => abrirComprovante(v)}>Reimprimir</button>
                  <Can perm="venda.cancelar">{v.status === 'CONCLUIDA' && <button className="btn btn-sm btn-danger" onClick={() => setCancelar(v)}>Cancelar</button>}</Can>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      <ConfirmMotivo aberto={!!cancelar} titulo={`Cancelar venda ${cancelar?.numero ?? ''}`}
        descricao="O estoque será estornado. Reembolso em dinheiro vira sangria no seu caixa aberto. Esta ação fica registrada na auditoria."
        rotuloConfirmar="Cancelar venda" onFechar={() => setCancelar(null)}
        onConfirmar={async (motivo) => { await pdvApi.cancelar(cancelar!.id, motivo); toast('Venda cancelada.'); await reload(); }} />
      <ComprovanteModal venda={reimprimir} onFechar={() => setReimprimir(null)} />
    </div>
  );
}
