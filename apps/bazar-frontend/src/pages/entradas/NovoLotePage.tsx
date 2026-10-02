/**
 * Novo lote: tipo, parceiro e/ou campanha (RN-04), documento e anexo.
 * Compra pede valor e se foi pago (cria conta a pagar no servidor, exige contas_pagar.gerenciar).
 * Anexo: checagem de tamanho/tipo aqui é só UX — o servidor valida magic bytes (RNF-18).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { cadastrosApi, lotesApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { TipoEntrada } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { ErrorAlert, Field, PageHeader } from '../../components/ui';
import { useAuth } from '../../auth/AuthContext';
import { fromCents, tryCents } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { todayLocal } from '../../lib/format';
import { useToast } from '../../components/Toast';

const MAX_MB = 5; // proposto; parâmetro anexo.tamanho_max_mb
const TIPOS_ACEITOS = ['application/pdf', 'image/png', 'image/jpeg'];

export function NovoLotePage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const ops = useAsync(() => Promise.all([cadastrosApi.listar('parceiros', { ativo: true }), cadastrosApi.listar('campanhas', { ativo: true })]), []);
  const [tipo, setTipo] = useState<TipoEntrada>('DOACAO');
  const [parceiroId, setParceiroId] = useState('');
  const [campanhaId, setCampanhaId] = useState('');
  const [documento, setDocumento] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [valor, setValor] = useState('');
  const [pago, setPago] = useState(false);
  const [vencimento, setVencimento] = useState(todayLocal(30));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const erroArquivo = arquivo && (arquivo.size > MAX_MB * 1024 * 1024 ? `Arquivo maior que ${MAX_MB} MB.` : !TIPOS_ACEITOS.includes(arquivo.type) ? 'Envie PDF, PNG ou JPEG.' : null);
  const valorCents = tryCents(valor);
  const valido = (parceiroId || campanhaId) && !erroArquivo && (tipo !== 'COMPRA' || (valorCents !== null && valorCents > 0));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true); setErro(null);
    const id = uuid();
    try {
      const lote = await lotesApi.criar({
        id, tipo, parceiroId: parceiroId || undefined, campanhaId: campanhaId || undefined, documento: documento.trim() || undefined,
        ...(tipo === 'COMPRA' ? { valorCompra: fromCents(valorCents!), pago, vencimento: pago ? undefined : vencimento } : {}),
      });
      if (arquivo) {
        try { await lotesApi.enviarDocumento(lote.id, arquivo); }
        catch (err) { toast(`Lote criado, mas o anexo falhou: ${errorMessage(err)}`, 'erro'); }
      }
      toast(`Lote #${lote.numero} criado.`);
      nav(`/entradas/${lote.id}/triagem`);
    } catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }

  return (
    <div className="page narrow">
      <PageHeader titulo="Novo lote de entrada" />
      <form className="card" onSubmit={salvar}>
        <Field label="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoEntrada)}>
            <option value="DOACAO">Doação</option>
            {can('contas_pagar.gerenciar') && <option value="COMPRA">Compra</option>}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Parceiro"><select value={parceiroId} onChange={(e) => setParceiroId(e.target.value)}><option value="">—</option>{ops.data?.[0].map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
          <Field label="Campanha"><select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}><option value="">—</option>{ops.data?.[1].map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
        </div>
        {!parceiroId && !campanhaId && <small className="hint">Informe parceiro e/ou campanha. Sem doador conhecido, use “Doador não identificado”.</small>}
        <Field label="Documento de origem (nº do termo, nota…)"><input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={80} /></Field>
        <Field label={`Anexo (PDF/PNG/JPEG, até ${MAX_MB} MB)`} erro={erroArquivo}>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </Field>
        {tipo === 'COMPRA' && (
          <fieldset>
            <legend>Compra</legend>
            <Field label="Valor da compra (R$)"><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
            <label className="check"><input type="checkbox" checked={pago} onChange={(e) => setPago(e.target.checked)} /> Já foi paga</label>
            {!pago && <Field label="Vencimento da conta a pagar"><input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Field>}
          </fieldset>
        )}
        <ErrorAlert erro={erro ?? ops.erro} />
        <div className="row"><button type="button" className="btn" onClick={() => nav(-1)}>Cancelar</button><button className="btn btn-primary" disabled={!valido || enviando}>Criar lote e triar</button></div>
      </form>
    </div>
  );
}
