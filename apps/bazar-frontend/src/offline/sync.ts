/**
 * Sincronização do PDV offline -> POST /sync/lote.
 * - Envia em ordem: clientes novos e depois vendas por `ocorridaEm` (o servidor também processa em ordem).
 * - Idempotente: o id da venda é a chave; reenvio após falha devolve JA_EXISTENTE.
 * - PENDENCIA: o servidor PRESERVA a venda em pendencia_sincronizacao (RN-26) e o Admin resolve;
 *   por isso a cópia local é removida também nesse caso (minimização — RNF-09).
 * - Trava simples para não rodar duas sincronizações em paralelo.
 */
import { pdvApi } from '../api/modules';
import { NetworkError } from '../api/http';
import { isOnline, subscribeConnectivity } from '../lib/connectivity';
import { listarClientesFila, listarVendasFila, removerCliente, removerVenda } from './queue';

export interface SyncResultado { gravadas: number; pendencias: { id: string; motivo?: string }[] }
let emAndamento: Promise<SyncResultado> | null = null;

export function sincronizarAgora(): Promise<SyncResultado> {
  emAndamento ??= (async () => {
    const res: SyncResultado = { gravadas: 0, pendencias: [] };
    try {
      const [clientes, vendas] = await Promise.all([listarClientesFila(), listarVendasFila()]);
      if (!clientes.length && !vendas.length) return res;
      // Lotes de até 50 vendas para não estourar o timeout em reconexões longas.
      for (let i = 0; i < Math.max(vendas.length, 1); i += 50) {
        const fatia = vendas.slice(i, i + 50).map(({ enfileiradaEm: _e, ...v }) => v);
        const r = await pdvApi.sincronizar({ clientes: i === 0 ? clientes : [], vendas: fatia });
        for (const item of r.resultados) {
          if (item.tipo === 'cliente') { await removerCliente(item.id); continue; }
          await removerVenda(item.id);
          if (item.status === 'PENDENCIA') res.pendencias.push({ id: item.id, motivo: item.motivo });
          else res.gravadas++;
        }
      }
      return res;
    } finally {
      emAndamento = null;
    }
  })();
  return emAndamento;
}

/** Liga a sincronização automática: na reconexão e a cada 30 s enquanto houver fila. */
export function iniciarSyncAutomatico(onResultado: (r: SyncResultado) => void): () => void {
  const tentar = () => {
    if (!isOnline()) return;
    sincronizarAgora().then((r) => { if (r.gravadas || r.pendencias.length) onResultado(r); })
      .catch((e) => { if (!(e instanceof NetworkError)) console.warn('[sync] falha ao sincronizar'); });
  };
  const unsub = subscribeConnectivity((on) => { if (on) tentar(); });
  const timer = setInterval(tentar, 30_000);
  tentar();
  return () => { unsub(); clearInterval(timer); };
}
