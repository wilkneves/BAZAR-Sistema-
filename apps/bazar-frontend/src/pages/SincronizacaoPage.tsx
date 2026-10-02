/** Pendências de sincronização (RN-26): venda preservada + motivo; reprocessar ou descartar com justificativa. */
import { useState } from 'react';
import { pendenciasApi } from '../api/modules';
import { errorMessage } from '../api/http';
import type { Pendencia } from '../api/types';
import { useAsync } from '../components/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination } from '../components/ui';
import { ConfirmMotivo } from '../components/ConfirmMotivo';
import { formatDateTime } from '../lib/format';
import { useToast } from '../components/Toast';
import { useTamanhoFila } from '../offline/hooks';

export function SincronizacaoPage() {
  const toast = useToast();
  const filaLocal = useTamanhoFila();
  const [status, setStatus] = useState('ABERTA');
  const [page, setPage] = useState(1);
  const [descartar, setDescartar] = useState<Pendencia | null>(null);
  const { data, erro, carregando, reload } = useAsync(() => pendenciasApi.listar({ status: status || undefined, page }), [status, page]);

  async function reprocessar(p: Pendencia) {
    try { await pendenciasApi.reprocessar(p.id); toast('Venda reprocessada e gravada.'); await reload(); }
    catch (e) { toast(`Ainda recusada: ${errorMessage(e)}`, 'erro'); await reload(); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Pendências de sincronização" />
      {filaLocal > 0 && <div className="alert alert-warn">Este dispositivo ainda tem {filaLocal} registro(s) na fila local.</div>}
      <div className="filters">
        <Field label="Status"><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todas</option><option value="ABERTA">Abertas</option><option value="REPROCESSADA">Reprocessadas</option><option value="DESCARTADA">Descartadas</option></select></Field>
      </div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty>Nenhuma pendência.</Empty> : (
        <table className="table">
          <thead><tr><th>Nº provisório</th><th>Ocorrida em</th><th>Terminal / operador</th><th>Motivo da recusa</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
          <tbody>{data.items.map((p) => (
            <tr key={p.id}>
              <td>{p.numeroLocal ?? '—'}</td><td>{formatDateTime(p.ocorridaEm)}</td><td>{p.terminalNome} · {p.operadorNome}</td>
              <td><code>{p.codigo}</code> {p.motivo}</td><td className="num"><MoneyText value={p.total} /></td>
              <td><Badge tom={p.status === 'ABERTA' ? 'alerta' : p.status === 'REPROCESSADA' ? 'ok' : 'neutro'}>{p.status}</Badge></td>
              <td className="actions">{p.status === 'ABERTA' && <><button className="btn btn-sm btn-primary" onClick={() => reprocessar(p)}>Reprocessar</button><button className="btn btn-sm btn-danger" onClick={() => setDescartar(p)}>Descartar</button></>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      <ConfirmMotivo aberto={!!descartar} titulo="Descartar pendência" descricao="A venda offline não será registrada. Use só depois de conferir com o operador (ex.: peça vendida em dois caixas)." rotuloConfirmar="Descartar" rotuloMotivo="Justificativa"
        onFechar={() => setDescartar(null)} onConfirmar={async (j) => { await pendenciasApi.descartar(descartar!.id, j); toast('Pendência descartada.'); await reload(); }} />
    </div>
  );
}
