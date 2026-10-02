/** Comprovante NÃO FISCAL (aviso explícito). Venda offline mostra número provisório. */
import { Modal } from '../../components/Modal';
import type { Venda } from '../../api/types';
import { FORMAS_PAGAMENTO } from '../../api/types';
import { formatMoney } from '../../lib/money';
import { formatDate, formatDateTime } from '../../lib/format';

export function ComprovanteModal({ venda, onFechar }: { venda: Venda | null; onFechar: () => void }) {
  if (!venda) return null;
  const provisoria = venda.numero === null;
  return (
    <Modal titulo="Venda concluída" aberto onFechar={onFechar} largura="sm"
      rodape={<><button className="btn" onClick={() => window.print()}>Imprimir</button><button className="btn btn-primary" onClick={onFechar} autoFocus>Nova venda (Enter)</button></>}>
      <div className="print-area comprovante">
        <h3>Bazar Luz da Esperança</h3>
        <p className="aviso-nao-fiscal">DOCUMENTO NÃO FISCAL — SEM VALOR FISCAL</p>
        <p>
          {provisoria ? <>Nº provisório: <strong>{venda.numeroLocal}</strong><br /><small>Venda offline — receberá o número oficial ao sincronizar.</small></>
            : <>Venda nº <strong>{venda.numero}</strong></>}
          <br />{formatDateTime(venda.ocorridaEm)} · {venda.operadorNome}
        </p>
        <table>
          <tbody>
            {venda.itens.map((i, k) => <tr key={k}><td>{i.quantidade}× {i.descricao}</td><td className="num">{formatMoney(i.total)}</td></tr>)}
          </tbody>
        </table>
        {venda.desconto !== '0.00' && <p className="linha">Desconto <span>{formatMoney(venda.desconto)}</span></p>}
        <p className="linha total">Total <span>{formatMoney(venda.total)}</span></p>
        {venda.pagamentos.map((p, k) => <p key={k} className="linha">{FORMAS_PAGAMENTO.find((f) => f.value === p.forma)?.label} <span>{formatMoney(p.valorRecebido ?? p.valor)}</span></p>)}
        {venda.troco !== '0.00' && <p className="linha troco">Troco <span>{formatMoney(venda.troco)}</span></p>}
        {venda.clienteNome && <p>Fiado: {venda.clienteNome} · vence {formatDate(venda.vencimentoFiado)}</p>}
        <p className="muted">Obrigado por apoiar a Luz da Esperança!</p>
      </div>
    </Modal>
  );
}
