/** Relatórios: prestação de contas (parceiro OU campanha), vendas, estoque, descartes, transferências, fiado. Exporta PDF/CSV/XLSX. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { relatoriosApi, type FormatoExportacao } from '../api/modules';
import { errorMessage } from '../api/http';
import type { TipoRelatorio } from '../api/types';
import { useAsync } from '../components/useAsync';
import { Empty, ErrorAlert, Field, MoneyText, PageHeader, Tabs } from '../components/ui';
import { formatDate, todayLocal } from '../lib/format';
import { downloadBlob } from '../lib/download';
import { useToast } from '../components/Toast';

const ABAS: { id: TipoRelatorio; rotulo: string }[] = [
  { id: 'prestacao-contas', rotulo: 'Prestação de contas' }, { id: 'vendas', rotulo: 'Vendas' }, { id: 'estoque', rotulo: 'Estoque' },
  { id: 'descartes', rotulo: 'Descartes' }, { id: 'transferencias', rotulo: 'Transferências' }, { id: 'fiado', rotulo: 'Fiado em aberto' },
];

export function RelatoriosPage() {
  const { tipo = 'prestacao-contas' } = useParams();
  const t = (ABAS.some((a) => a.id === tipo) ? tipo : 'prestacao-contas') as TipoRelatorio;
  const nav = useNavigate();
  const toast = useToast();
  const [de, setDe] = useState(todayLocal(-30));
  const [ate, setAte] = useState(todayLocal());
  const [modo, setModo] = useState<'parceiro' | 'campanha'>('parceiro');
  const filtro = { de, ate, ...(t === 'prestacao-contas' ? { modo } : {}) };
  const { data, erro, carregando } = useAsync(() => relatoriosApi.consultar(t, filtro), [t, de, ate, modo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportar(fmt: FormatoExportacao) {
    try { downloadBlob(await relatoriosApi.exportar(t, filtro, fmt), `${t}_${de}_${ate}.${fmt}`); }
    catch (e) { toast(errorMessage(e), 'erro'); }
  }

  return (
    <div className="page">
      <PageHeader titulo="Relatórios">
        {(['pdf', 'csv', 'xlsx'] as const).map((f) => <button key={f} className="btn" onClick={() => exportar(f)}>Exportar {f.toUpperCase()}</button>)}
      </PageHeader>
      <Tabs abas={ABAS} atual={t} onChange={(id) => nav(`/relatorios/${id}`)} />
      <div className="filters">
        <Field label="De"><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
        {t === 'prestacao-contas' && (
          <Field label="Agrupar por"><select value={modo} onChange={(e) => setModo(e.target.value as typeof modo)}><option value="parceiro">Parceiro</option><option value="campanha">Campanha</option></select></Field>
        )}
      </div>
      {t === 'prestacao-contas' && <p className="muted">Recebido e descartado consideram lotes do período; vendido e receita consideram vendas do período; saldo é a posição atual. Valor oficial pendente de definição (PA-09).</p>}
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.linhas.length ? <Empty /> : (
        <table className="table">
          <caption>{data.titulo}</caption>
          <thead><tr>{data.colunas.map((c) => <th key={c.chave} className={c.tipo === 'money' || c.tipo === 'number' ? 'num' : ''}>{c.rotulo}</th>)}</tr></thead>
          <tbody>{data.linhas.map((l, i) => (
            <tr key={i}>{data.colunas.map((c) => {
              const v = l[c.chave];
              return <td key={c.chave} className={c.tipo === 'money' || c.tipo === 'number' ? 'num' : ''}>
                {c.tipo === 'money' ? <MoneyText value={v as string} /> : c.tipo === 'date' ? formatDate(v as string) : String(v ?? '—')}
              </td>;
            })}</tr>
          ))}</tbody>
          {data.totais && <tfoot><tr>{data.colunas.map((c, i) => <td key={c.chave} className="num">{i === 0 ? 'Total' : data.totais![c.chave] !== undefined ? (c.tipo === 'money' ? <MoneyText value={String(data.totais![c.chave])} /> : data.totais![c.chave]) : ''}</td>)}</tr></tfoot>}
        </table>
      )}
    </div>
  );
}
