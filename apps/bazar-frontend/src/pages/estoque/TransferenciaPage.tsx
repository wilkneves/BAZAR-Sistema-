/** Transferência Bazar ⇄ Doações por código (leitor) ou item/quantidade, com motivo opcional. */
import { useState } from 'react';
import { estoqueApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { ItemEstoque, LocalEstoque } from '../../api/types';
import { ErrorAlert, Field, PageHeader } from '../../components/ui';
import { ItemPicker } from '../../components/ItemPicker';
import { uuid } from '../../lib/uuid';
import { useToast } from '../../components/Toast';

export function TransferenciaPage() {
  const toast = useToast();
  const [item, setItem] = useState<ItemEstoque | null>(null);
  const [origem, setOrigem] = useState<LocalEstoque>('BAZAR');
  const [qtd, setQtd] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const destino: LocalEstoque = origem === 'BAZAR' ? 'DOACOES' : 'BAZAR';
  const saldoOrigem = item ? (origem === 'BAZAR' ? item.saldoBazar : item.saldoDoacoes) : 0;
  const q = Number.parseInt(qtd, 10);

  function selecionar(it: ItemEstoque) { setItem(it); setOrigem(it.saldoBazar > 0 ? 'BAZAR' : 'DOACOES'); setQtd('1'); setErro(null); }

  async function transferir() {
    if (!item || !(q > 0) || q > saldoOrigem) return;
    setEnviando(true); setErro(null);
    try {
      await estoqueApi.transferir({ id: uuid(), itemId: item.id, quantidade: q, origem, destino, motivo: motivo.trim() || undefined });
      toast(`${q} un. transferida(s) para ${destino === 'BAZAR' ? 'Bazar' : 'Doações'}.`);
      setItem(null); setMotivo('');
    } catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }

  return (
    <div className="page narrow">
      <PageHeader titulo="Transferência entre estoques" />
      <div className="card"><ItemPicker onSelecionar={selecionar} /></div>
      {item && (
        <div className="card">
          <h2>{item.descricao}</h2>
          <p>Bazar: <strong>{item.saldoBazar}</strong> · Doações: <strong>{item.saldoDoacoes}</strong></p>
          <Field label="Sentido">
            <select value={origem} onChange={(e) => setOrigem(e.target.value as LocalEstoque)}>
              <option value="BAZAR">Bazar → Doações</option><option value="DOACOES">Doações → Bazar</option>
            </select>
          </Field>
          <Field label="Quantidade" erro={q > saldoOrigem ? 'Quantidade maior que o saldo na origem' : null}>
            <input inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ''))} disabled={item.controle === 'ETIQUETADO'} />
          </Field>
          <Field label="Motivo (opcional)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>
          <button className="btn btn-primary" onClick={transferir} disabled={enviando || !(q > 0) || q > saldoOrigem}>Transferir</button>
        </div>
      )}
      <ErrorAlert erro={erro} />
    </div>
  );
}
