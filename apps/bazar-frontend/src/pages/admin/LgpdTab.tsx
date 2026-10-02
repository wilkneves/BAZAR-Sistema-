/**
 * LGPD — direitos do titular: exportar dados (JSON) e anonimizar preservando vendas (RN-21/22).
 * A busca do titular é por POST (sem PII na URL). Anonimizar com débito exige segunda confirmação.
 */
import { useState } from 'react';
import { clientesApi, privacidadeApi } from '../../api/modules';
import { ApiError, errorMessage } from '../../api/http';
import type { Cliente } from '../../api/types';
import { ErrorAlert, Field } from '../../components/ui';
import { ConfirmMotivo } from '../../components/ConfirmMotivo';
import { Modal } from '../../components/Modal';
import { downloadBlob } from '../../lib/download';
import { maskPhone } from '../../lib/format';
import { useToast } from '../../components/Toast';

export function LgpdTab() {
  const toast = useToast();
  const [termo, setTermo] = useState('');
  const [lista, setLista] = useState<Cliente[]>([]);
  const [sel, setSel] = useState<Cliente | null>(null);
  const [anonimizar, setAnonimizar] = useState(false);
  const [confirmarDebito, setConfirmarDebito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() { setErro(null); try { setLista(await clientesApi.buscar(termo.trim())); } catch (e) { setErro(errorMessage(e)); } }
  async function exportar(c: Cliente) {
    try { downloadBlob(await privacidadeApi.exportar('cliente', c.id), `titular_${c.id.slice(0, 8)}.json`); toast('Exportação gerada. Entregue ao titular por canal seguro.'); }
    catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function executarAnonimizacao(motivo: string, confirmar = false) {
    try {
      await privacidadeApi.anonimizar('cliente', sel!.id, motivo, confirmar);
      toast('Titular anonimizado. Vendas e valores foram preservados.'); setSel(null); setLista([]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CLIENTE_COM_DEBITO') { setConfirmarDebito(motivo); return; }
      throw e;
    }
  }

  return (
    <section className="narrow">
      <div className="card">
        <div className="row">
          <Field label="Buscar titular (nome ou telefone)"><input value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} autoComplete="off" /></Field>
          <button className="btn" onClick={buscar}>Buscar</button>
        </div>
        <ErrorAlert erro={erro} />
        <ul className="lista-escolha">{lista.map((c) => <li key={c.id}><button className={`btn btn-block ${sel?.id === c.id ? 'active' : ''}`} onClick={() => setSel(c)}>{c.nome} <small>{maskPhone(c.telefone)}</small></button></li>)}</ul>
      </div>
      {sel && (
        <div className="card">
          <h2>{sel.nome}</h2>
          <div className="row">
            <button className="btn" onClick={() => exportar(sel)}>Exportar dados do titular</button>
            <button className="btn btn-danger" onClick={() => setAnonimizar(true)}>Anonimizar</button>
          </div>
        </div>
      )}
      <ConfirmMotivo aberto={anonimizar} titulo="Anonimizar titular" rotuloConfirmar="Anonimizar"
        descricao="Nome e telefone serão removidos de forma irreversível. Vendas e valores continuam no sistema sem identificar a pessoa."
        onFechar={() => setAnonimizar(false)} onConfirmar={(m) => executarAnonimizacao(m)} />
      <Modal titulo="Cliente com débito em aberto" aberto={!!confirmarDebito} onFechar={() => setConfirmarDebito(null)} largura="sm"
        rodape={<><button className="btn" onClick={() => setConfirmarDebito(null)}>Cancelar</button>
          <button className="btn btn-danger" onClick={() => { const m = confirmarDebito!; setConfirmarDebito(null); executarAnonimizacao(m, true).catch((e) => toast(errorMessage(e), 'erro')); }}>Anonimizar mesmo assim</button></>}>
        <p>Após anonimizar, não será mais possível identificar quem deve. Confirme somente se a cobrança não for mais necessária ou houver base legal.</p>
      </Modal>
    </section>
  );
}
