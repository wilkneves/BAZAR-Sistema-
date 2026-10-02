/** Posição de estoque por estoque, categoria, parceiro, campanha, lote. Saldo vem da view do servidor. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cadastrosApi, estoqueApi } from '../../api/modules';
import type { LocalEstoque } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { Empty, ErrorAlert, Field, MoneyText, PageHeader, Pagination } from '../../components/ui';

export function EstoquePage() {
  const [f, setF] = useState({ local: '' as LocalEstoque | '', categoriaId: '', parceiroId: '', campanhaId: '', busca: '' });
  const [busca, setBusca] = useState('');
  const [page, setPage] = useState(1);
  const ops = useAsync(() => Promise.all([cadastrosApi.listar('categorias'), cadastrosApi.listar('parceiros'), cadastrosApi.listar('campanhas')]), []);
  const { data, erro, carregando } = useAsync(() => estoqueApi.listar({ ...f, local: f.local || undefined, page }), [f, page]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

  return (
    <div className="page">
      <PageHeader titulo="Estoque" />
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setF({ ...f, busca }); setPage(1); }}>
        <Field label="Buscar (descrição ou código)"><input value={busca} onChange={(e) => setBusca(e.target.value)} /></Field>
        <Field label="Estoque"><select value={f.local} onChange={set('local')}><option value="">Ambos</option><option value="BAZAR">Bazar</option><option value="DOACOES">Doações</option></select></Field>
        <Field label="Categoria"><select value={f.categoriaId} onChange={set('categoriaId')}><option value="">Todas</option>{ops.data?.[0].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <Field label="Parceiro"><select value={f.parceiroId} onChange={set('parceiroId')}><option value="">Todos</option>{ops.data?.[1].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <Field label="Campanha"><select value={f.campanhaId} onChange={set('campanhaId')}><option value="">Todas</option>{ops.data?.[2].map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
        <button className="btn">Filtrar</button>
      </form>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <table className="table">
          <thead><tr><th>Código</th><th>Descrição</th><th>Categoria</th><th>Lote</th><th>Origem</th><th className="num">Preço</th><th className="num">Bazar</th><th className="num">Doações</th></tr></thead>
          <tbody>{data.items.map((i) => (
            <tr key={i.id}>
              <td>{i.codigo ?? '—'}</td><td><Link to={`/estoque/itens/${i.id}`}>{i.descricao}</Link></td><td>{i.categoriaNome}</td>
              <td>#{i.loteNumero}</td><td>{[i.parceiroNome, i.campanhaNome].filter(Boolean).join(' · ')}</td>
              <td className="num"><MoneyText value={i.preco} /></td><td className="num">{i.saldoBazar}</td><td className="num">{i.saldoDoacoes}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </div>
  );
}
