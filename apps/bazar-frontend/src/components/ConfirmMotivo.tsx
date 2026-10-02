/**
 * Confirmação de ação destrutiva com motivo obrigatório
 * (cancelar venda, estornar, reabrir lote, descartar pendência, anonimizar — diretriz de UX).
 */
import { useState } from 'react';
import { Modal } from './Modal';
import { errorMessage } from '../api/http';

interface Props {
  aberto: boolean;
  titulo: string;
  descricao: string;
  rotuloConfirmar?: string;
  rotuloMotivo?: string;
  minimo?: number;
  onConfirmar: (motivo: string) => Promise<void>;
  onFechar: () => void;
}

export function ConfirmMotivo({ aberto, titulo, descricao, rotuloConfirmar = 'Confirmar', rotuloMotivo = 'Motivo', minimo = 5, onConfirmar, onFechar }: Props) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const valido = motivo.trim().length >= minimo;

  async function confirmar() {
    if (!valido) return;
    setEnviando(true); setErro(null);
    try { await onConfirmar(motivo.trim()); setMotivo(''); onFechar(); }
    catch (e) { setErro(errorMessage(e)); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={titulo} aberto={aberto} onFechar={onFechar} fechavel={!enviando} largura="sm"
      rodape={<>
        <button className="btn" onClick={onFechar} disabled={enviando}>Voltar</button>
        <button className="btn btn-danger" onClick={confirmar} disabled={!valido || enviando}>{enviando ? 'Gravando…' : rotuloConfirmar}</button>
      </>}>
      <p>{descricao}</p>
      <label className="field">
        <span>{rotuloMotivo} (mín. {minimo} caracteres)</span>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500} autoFocus />
      </label>
      {erro && <div className="alert alert-error" role="alert">{erro}</div>}
    </Modal>
  );
}
