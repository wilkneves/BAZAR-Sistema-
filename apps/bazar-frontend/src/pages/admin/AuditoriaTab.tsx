/** Trilha de auditoria (somente leitura, sem PII). */
import { useState } from 'react';
import { auditoriaApi } from '../../api/modules';
import { useAsync } from '../../components/useAsync';
import { Empty, ErrorAlert, Field, Pagination } from '../../components/ui';
import { formatDateTime, todayLocal } from '../../lib/format';

export function AuditoriaTab() {
  const [f, setF] = useState({ acao: '', entidade: '', de: todayLocal(-7), ate: todayLocal() });
  const [page, setPage] = useState(1);
  const { data, erro, carregando } = useAsync(() => auditoriaApi.listar({ ...f, page }), [f, page]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <section>
      <div className="filters">
        <Field label="Ação contém"><input value={f.acao} onChange={set('acao')} /></Field>
        <Field label="Entidade"><input value={f.entidade} onChange={set('entidade')} placeholder="ex.: venda" /></Field>
        <Field label="De"><input type="date" value={f.de} onChange={set('de')} /></Field>
        <Field label="Até"><input type="date" value={f.ate} onChange={set('ate')} /></Field>
      </div>
      <ErrorAlert erro={erro} />
      {carregando ? <p>Carregando…</p> : !data?.items.length ? <Empty /> : (
        <table className="table compact">
          <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Id</th></tr></thead>
          <tbody>{data.items.map((a) => <tr key={a.id}><td>{formatDateTime(a.ocorridoEm)}</td><td>{a.usuarioNome}</td><td><code>{a.acao}</code></td><td>{a.entidade}</td><td><code>{a.entidadeId.slice(0, 8)}…</code></td></tr>)}</tbody>
        </table>
      )}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </section>
  );
}
