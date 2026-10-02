/** Lista de lotes: status, aprovados, descartados, valor atribuído; filtros por parceiro, campanha, período. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cadastrosApi, lotesApi } from '../../api/modules';
import { useAsync } from '../../components/useAsync';
import { Badge, Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination } from '../../components/ui';
import { formatDate } from '../../lib/format';

const TIPO: Record<string, string> = { DOACAO: 'Doação', COMPRA: 'Compra', SALDO_INICIAL: 'Saldo inicial' };

export function LotesPage() {
  const [f, setF] = useState({ parceiroId: '', campanhaId: '', status: '', de: '', ate: '' });
  const [page, setPage] = useState(1);
  const ops = useAsync(() => Promise.all([cadastrosApi.listar('parceiros'), cadastrosApi.listar('campanhas')]), []);
  const { data, erro, carregando } = useAsync(() => lotesApi.listar({ ...f, page }), [f, page]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <div className="page">
      <PageHeader titulo="Lotes de entrada"><Link to="/entradas/novo" className="btn btn-primary">+ Novo lote</Link></PageHeader>
      <div className="filters">
        <Field label="Parceiro"><select value={f.parceiroId} onChange={set('parceiroId')}><option value="">Todos</option>{ops.data?.[0].map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
        <Field label="Campanha"><select value={f.campanhaId} onChange={set('campanhaId')}><option value="">Todas</option>{ops.data?.[1].map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
        <Field label="Status"><select value={f.status} onChange={set('status')}><option value="">Todos</option><option value="ABERTO">Aguardando triagem</option><option value="TRIADO">Triado</option></select></Field>
        <Field label="De"><input type="date" value={f.de} onChange={set('de')} /></Field>
        <Field label="Até"><input type="date" value={f.ate} onChange={set('ate')} /></Field>
      </div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <table className="table">
          <thead><tr><th>Lote</th><th>Recebido</th><th>Tipo</th><th>Parceiro / campanha</th><th>Status</th><th className="num">Aprovados</th><th className="num">Descartados</th><th className="num">Valor atribuído</th><th /></tr></thead>
          <tbody>
            {data.items.map((l) => (
              <tr key={l.id}>
                <td>#{l.numero}</td><td>{formatDate(l.recebidoEm)}</td><td>{TIPO[l.tipo]}</td>
                <td>{[l.parceiroNome, l.campanhaNome].filter(Boolean).join(' · ')}</td>
                <td>{l.status === 'ABERTO' ? <Badge tom="alerta">Aguardando triagem</Badge> : <Badge tom="ok">Triado</Badge>}</td>
                <td className="num">{l.aprovados}</td><td className="num">{l.descartados}</td><td className="num"><MoneyText value={l.valorAtribuido} /></td>
                <td><Link className="btn btn-sm" to={`/entradas/${l.id}/triagem`}>{l.status === 'ABERTO' ? 'Triar' : 'Ver'}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}
