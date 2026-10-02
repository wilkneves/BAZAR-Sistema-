/** Fila local de vendas e clientes criados offline. Apagada item a item após sync (RNF-09). */
import { idb, KV } from './idb';
import type { VendaRequest } from '../api/types';

export type VendaNaFila = VendaRequest & { id: string; enfileiradaEm: string };
export type ClienteNaFila = { id: string; nome: string; telefone: string; cienciaAviso: boolean };

type Listener = (n: number) => void;
const listeners = new Set<Listener>();
export function subscribeFila(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
async function notify() { const n = await tamanhoFila(); listeners.forEach((l) => l(n)); }

export async function enfileirarVenda(v: VendaRequest & { id: string }) {
  await idb.put('filaVendas', { ...v, enfileiradaEm: new Date().toISOString() } satisfies VendaNaFila);
  await notify();
}
export async function enfileirarCliente(c: ClienteNaFila) { await idb.put('filaClientes', c); await notify(); }
export const listarVendasFila = async () =>
  (await idb.getAll<VendaNaFila>('filaVendas')).sort((a, b) => a.ocorridaEm.localeCompare(b.ocorridaEm));
export const listarClientesFila = () => idb.getAll<ClienteNaFila>('filaClientes');
export async function removerVenda(id: string) { await idb.del('filaVendas', id); await notify(); }
export async function removerCliente(id: string) { await idb.del('filaClientes', id); await notify(); }
export async function tamanhoFila() {
  try { return (await idb.count('filaVendas')) + (await idb.count('filaClientes')); } catch { return 0; }
}

/** Número provisório da venda offline: "<4 primeiros do terminal>-<seq>" (exibido até receber o oficial). */
export async function proximoNumeroLocal(terminalId: string): Promise<string> {
  const seq = ((await idb.get<number>('kv', KV.seqLocal)) ?? 0) + 1;
  await idb.put('kv', seq, KV.seqLocal);
  return `OFF-${terminalId.slice(0, 4).toUpperCase()}-${String(seq).padStart(4, '0')}`;
}
