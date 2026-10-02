/** Linha do tempo do item: lote, parceiro, transferências, vendas, estornos, baixas (rastreabilidade). */
import { useParams } from 'react-router-dom';
import { estoqueApi } from '../../api/modules';
import { useAsync } from '../../components/useAsync';
import { ErrorAlert, MoneyText, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const ROTULO: Record<string, string> = {
  TRIAGEM: 'Recebimento', ENTRADA: 'Entrada', TRANSFERENCIA: 'Transferência', VENDA: 'Venda', ESTORNO_VENDA: 'Estorno de venda',
  BAIXA: 'Baixa', AJUSTE_ENTRADA: 'Ajuste (+)', AJUSTE_SAIDA: 'Ajuste (−)',
};

export function HistoricoItemPage() {
  const { id = '' } = useParams();
  const { data, erro, carregando } = useAsync(() => estoqueApi.historico(id), [id]);
  if (carregando) return <div className="page">Carregando…</div>;
  if (!data) return <div className="page"><ErrorAlert erro={erro} /></div>;
  const { item, eventos } = data;
  return (
    <div className="page">
      <PageHeader titulo={item.descricao} />
      <p className="muted">
        {item.codigo && <>Código <strong>{item.codigo}</strong> · </>}{item.categoriaNome} · Lote #{item.loteNumero} · {[item.parceiroNome, item.campanhaNome].filter(Boolean).join(' · ')} · <MoneyText value={item.preco} />
      </p>
      <p>Saldo atual — Bazar: <strong>{item.saldoBazar}</strong> · Doações: <strong>{item.saldoDoacoes}</strong></p>
      <ol className="timeline">
        {eventos.map((e, i) => (
          <li key={i}>
            <time>{formatDateTime(e.ocorridoEm)}</time>
            <strong>{ROTULO[e.tipo] ?? e.tipo}</strong>
            <span>{e.descricao}</span>
            {e.quantidade !== 0 && <span className={e.quantidade > 0 ? 'txt-ok' : 'txt-erro'}>{e.quantidade > 0 ? '+' : ''}{e.quantidade} {e.local === 'BAZAR' ? 'Bazar' : e.local === 'DOACOES' ? 'Doações' : ''}</span>}
            {e.usuarioNome && <small>{e.usuarioNome}</small>}
          </li>
        ))}
      </ol>
    </div>
  );
}
