/** Seleciona um item do estoque: código lido pelo leitor (Enter) ou busca por descrição. */
import { useState, type FormEvent } from 'react';
import { estoqueApi } from '../api/modules';
import { errorMessage } from '../api/http';
import type { ItemEstoque } from '../api/types';
import { ErrorAlert, Field, MoneyText } from './ui';

export function ItemPicker({ onSelecionar, rotulo = 'Código ou descrição do item' }: { onSelecionar: (i: ItemEstoque) => void; rotulo?: string }) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ItemEstoque[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    const t = termo.trim(); if (!t) return;
    setErro(null); setResultados(null);
    try {
      // Parece código de barras? tenta o lookup direto primeiro.
      if (/^[A-Z0-9-]{4,}$/i.test(t) && !/\s/.test(t)) {
        try { const it = await estoqueApi.porCodigo(t); onSelecionar(it); setTermo(''); return; } catch { /* cai na busca */ }
      }
      const r = await estoqueApi.listar({ busca: t, page: 1 });
      if (r.items.length === 1) { onSelecionar(r.items[0]!); setTermo(''); } else setResultados(r.items);
    } catch (err) { setErro(errorMessage(err)); }
  }

  return (
    <div>
      <form onSubmit={buscar} className="row">
        <Field label={rotulo}><input value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus autoComplete="off" /></Field>
        <button className="btn">Buscar</button>
      </form>
      <ErrorAlert erro={erro} />
      {resultados && (resultados.length === 0 ? <p className="empty">Nenhum item encontrado.</p> : (
        <ul className="lista-escolha">
          {resultados.map((i) => (
            <li key={i.id}><button type="button" className="btn btn-block" onClick={() => { onSelecionar(i); setResultados(null); setTermo(''); }}>
              {i.descricao} · lote #{i.loteNumero} · Bazar {i.saldoBazar} / Doações {i.saldoDoacoes} · <MoneyText value={i.preco} />
            </button></li>
          ))}
        </ul>
      ))}
    </div>
  );
}
