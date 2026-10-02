/**
 * Modal de pagamento: formas (pode dividir), valor recebido e troco, fiado com cliente e vencimento,
 * cadastro rápido de cliente e desconto dentro do limite do perfil (PA-08 pendente).
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { ErrorAlert, Field } from '../../components/ui';
import { FORMAS_PAGAMENTO, type CatalogoPdv, type FormaPagamento, type PagamentoRequest } from '../../api/types';
import { formatMoney, fromCents, toCents, tryCents } from '../../lib/money';
import { clientesApi } from '../../api/modules';
import { NetworkError, errorMessage } from '../../api/http';
import { enfileirarCliente } from '../../offline/queue';
import { uuid } from '../../lib/uuid';
import { maskPhone, todayLocal } from '../../lib/format';

/** Prazo padrão do fiado — PA-07 pendente; o valor oficial virá do parâmetro `fiado.prazo_dias`. */
const PRAZO_FIADO_DIAS = 30;

export interface ResultadoPagamento {
  pagamentos: PagamentoRequest[];
  descontoCents: number;
  clienteId?: string;
  clienteNome?: string;
  vencimentoFiado?: string;
  trocoCents: number;
}

interface Props {
  aberto: boolean;
  subtotalCents: number;
  limiteDescontoPct: number;
  online: boolean;
  clientesLocais: CatalogoPdv['clientesFiado'];
  onNovoClienteLocal: (c: { id: string; nome: string; telefone: string }) => void;
  onConfirmar: (r: ResultadoPagamento) => Promise<void>;
  onFechar: () => void;
}

/** Valor para exibir em input no padrão pt-BR ("55,00"). */
const paraInput = (cents: number) => fromCents(cents).replace('.', ',');

interface LinhaPg { forma: FormaPagamento; valor: string; recebido: string }

export function PagamentoModal(p: Props) {
  const [desconto, setDesconto] = useState('');
  const [linhas, setLinhas] = useState<LinhaPg[]>([]);
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null);
  const [vencimento, setVencimento] = useState(todayLocal(PRAZO_FIADO_DIAS));
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const descontoCents = tryCents(desconto) ?? 0;
  const totalCents = Math.max(0, p.subtotalCents - descontoCents);
  const descontoPct = p.subtotalCents ? (descontoCents * 100) / p.subtotalCents : 0;
  const descontoInvalido = descontoCents < 0 || descontoCents > p.subtotalCents || descontoPct > p.limiteDescontoPct;

  // Ao abrir: uma linha em dinheiro com o total.
  useEffect(() => {
    if (p.aberto) { setLinhas([{ forma: 'DINHEIRO', valor: paraInput(p.subtotalCents), recebido: '' }]); setDesconto(''); setCliente(null); setErro(null); }
  }, [p.aberto, p.subtotalCents]);

  // Mantém a última linha ajustada ao total quando o desconto muda e há só uma forma.
  useEffect(() => {
    setLinhas((ls) => (ls.length === 1 ? [{ ...ls[0]!, valor: paraInput(totalCents) }] : ls));
  }, [totalCents]);

  const pagoCents = linhas.reduce((s, l) => s + (tryCents(l.valor) ?? 0), 0);
  const faltaCents = totalCents - pagoCents;
  const trocoCents = linhas.reduce((s, l) => {
    if (l.forma !== 'DINHEIRO') return s;
    const r = tryCents(l.recebido); const v = tryCents(l.valor) ?? 0;
    return r !== null && r > v ? s + (r - v) : s;
  }, 0);
  const temFiado = linhas.some((l) => l.forma === 'FIADO');
  const recebidoInsuficiente = linhas.some((l) => l.forma === 'DINHEIRO' && l.recebido !== '' && (tryCents(l.recebido) ?? 0) < (tryCents(l.valor) ?? 0));
  const podeConfirmar = !descontoInvalido && faltaCents === 0 && !recebidoInsuficiente && linhas.every((l) => (tryCents(l.valor) ?? 0) > 0) && (!temFiado || (cliente && vencimento));

  function atualizar(i: number, patch: Partial<LinhaPg>) { setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); }
  function adicionarForma() {
    const usadas = new Set(linhas.map((l) => l.forma));
    const forma = FORMAS_PAGAMENTO.find((f) => !usadas.has(f.value))?.value; if (!forma) return;
    setLinhas((ls) => [...ls, { forma, valor: paraInput(Math.max(0, faltaCents)), recebido: '' }]);
  }

  async function confirmar() {
    if (!podeConfirmar) return;
    setEnviando(true); setErro(null);
    try {
      await p.onConfirmar({
        descontoCents, trocoCents,
        pagamentos: linhas.map((l) => ({ forma: l.forma, valor: fromCents(toCents(l.valor)), ...(l.forma === 'DINHEIRO' && l.recebido ? { valorRecebido: fromCents(toCents(l.recebido)) } : {}) })),
        ...(temFiado && cliente ? { clienteId: cliente.id, clienteNome: cliente.nome, vencimentoFiado: vencimento } : {}),
      });
    } catch (e) { setErro(errorMessage(e)); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Pagamento" aberto={p.aberto} onFechar={p.onFechar} fechavel={!enviando} largura="lg"
      rodape={<>
        <button className="btn" onClick={p.onFechar} disabled={enviando}>Voltar (Esc)</button>
        <button className="btn btn-primary btn-lg" onClick={confirmar} disabled={!podeConfirmar || enviando}>{enviando ? 'Gravando…' : 'Finalizar venda (Enter)'}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); void confirmar(); }}>
        <div className="pg-resumo">
          <div><span>Subtotal</span><strong>{formatMoney(p.subtotalCents)}</strong></div>
          <div><span>Desconto</span><strong>{formatMoney(descontoCents)}</strong></div>
          <div className="pg-total"><span>Total</span><strong>{formatMoney(totalCents)}</strong></div>
        </div>
        {p.limiteDescontoPct > 0 && (
          <Field label={`Desconto em R$ (limite do perfil: ${p.limiteDescontoPct}%)`} erro={descontoInvalido ? 'Desconto acima do limite do seu perfil — peça autorização a um administrador.' : null}>
            <input inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" />
          </Field>
        )}
        {linhas.map((l, i) => (
          <div key={i} className="pg-linha">
            <Field label="Forma">
              <select value={l.forma} onChange={(e) => atualizar(i, { forma: e.target.value as FormaPagamento, recebido: '' })} autoFocus={i === 0}>
                {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Valor"><input inputMode="decimal" value={l.valor} onChange={(e) => atualizar(i, { valor: e.target.value })} /></Field>
            {l.forma === 'DINHEIRO' && <Field label="Valor recebido"><input inputMode="decimal" value={l.recebido} onChange={(e) => atualizar(i, { recebido: e.target.value })} placeholder="Opcional" /></Field>}
            {linhas.length > 1 && <button type="button" className="btn btn-ghost" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} aria-label="Remover forma">✕</button>}
          </div>
        ))}
        <div className="row">
          {faltaCents > 0 && linhas.length < FORMAS_PAGAMENTO.length && <button type="button" className="btn" onClick={adicionarForma}>+ Dividir pagamento</button>}
          {faltaCents !== 0 && <span className="badge badge-alerta">{faltaCents > 0 ? `Falta ${formatMoney(faltaCents)}` : `Excede em ${formatMoney(-faltaCents)}`}</span>}
          {recebidoInsuficiente && <span className="badge badge-erro">Valor recebido menor que o valor em dinheiro</span>}
        </div>
        {trocoCents > 0 && <div className="troco" aria-live="polite">Troco: <strong>{formatMoney(trocoCents)}</strong></div>}
        {temFiado && (
          <fieldset className="fiado">
            <legend>Fiado</legend>
            <SeletorCliente online={p.online} clientesLocais={p.clientesLocais} cliente={cliente} onSelecionar={setCliente} onNovoClienteLocal={p.onNovoClienteLocal} />
            <Field label="Vencimento"><input type="date" value={vencimento} min={todayLocal()} onChange={(e) => setVencimento(e.target.value)} /></Field>
          </fieldset>
        )}
        <ErrorAlert erro={erro} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Busca de cliente: online via POST /clientes/busca (sem PII na URL); offline no catálogo local. */
function SeletorCliente({ online, clientesLocais, cliente, onSelecionar, onNovoClienteLocal }: {
  online: boolean; clientesLocais: CatalogoPdv['clientesFiado']; cliente: { id: string; nome: string } | null;
  onSelecionar: (c: { id: string; nome: string } | null) => void; onNovoClienteLocal: Props['onNovoClienteLocal'];
}) {
  const [termo, setTermo] = useState('');
  const [remotos, setRemotos] = useState<{ id: string; nome: string; telefone: string }[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState(''); const [tel, setTel] = useState(''); const [ciencia, setCiencia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const locais = useMemo(() => {
    const t = termo.trim().toLowerCase();
    return t.length < 2 ? [] : clientesLocais.filter((c) => c.nome.toLowerCase().includes(t) || c.telefone.replace(/\D/g, '').endsWith(t.replace(/\D/g, '') || '§')).slice(0, 8);
  }, [termo, clientesLocais]);

  useEffect(() => {
    if (!online || termo.trim().length < 2) { setRemotos(null); return; }
    const t = setTimeout(() => { clientesApi.buscar(termo.trim(), true).then(setRemotos).catch(() => setRemotos(null)); }, 300);
    return () => clearTimeout(t);
  }, [termo, online]);

  async function cadastrar() {
    setErro(null);
    const digitos = tel.replace(/\D/g, '');
    if (nome.trim().length < 3 || digitos.length < 10 || !ciencia) { setErro('Informe nome, telefone com DDD e a ciência do aviso de privacidade.'); return; }
    const c = { id: uuid(), nome: nome.trim(), telefone: tel.trim(), cienciaAviso: true };
    try {
      if (online) await clientesApi.criar(c); else await enfileirarCliente(c);
    } catch (e) {
      if (e instanceof NetworkError) await enfileirarCliente(c); else { setErro(errorMessage(e)); return; }
    }
    onNovoClienteLocal(c); onSelecionar({ id: c.id, nome: c.nome }); setNovo(false); setNome(''); setTel(''); setCiencia(false);
  }

  if (cliente) return <div className="row"><span>Cliente: <strong>{cliente.nome}</strong></span><button type="button" className="btn btn-ghost" onClick={() => onSelecionar(null)}>Trocar</button></div>;
  const lista = remotos ?? locais;
  return (
    <div>
      {!novo ? (<>
        <Field label="Buscar cliente (nome ou final do telefone)"><input value={termo} onChange={(e) => setTermo(e.target.value)} autoComplete="off" /></Field>
        <ul className="lista-clientes">
          {lista.map((c) => <li key={c.id}><button type="button" className="btn btn-block" onClick={() => onSelecionar(c)}>{c.nome} <small>{maskPhone(c.telefone)}</small></button></li>)}
        </ul>
        <button type="button" className="btn" onClick={() => setNovo(true)}>+ Cadastro rápido</button>
      </>) : (
        <div className="card-inset">
          <Field label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus /></Field>
          <Field label="Telefone com DDD"><input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" maxLength={20} /></Field>
          <label className="check"><input type="checkbox" checked={ciencia} onChange={(e) => setCiencia(e.target.checked)} /> Cliente ciente do aviso de privacidade: nome e telefone usados só para controle do fiado (LGPD).</label>
          <ErrorAlert erro={erro} />
          <div className="row"><button type="button" className="btn" onClick={() => setNovo(false)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={cadastrar}>Cadastrar</button></div>
          {!online && <small className="hint">Sem conexão: o cliente será enviado na próxima sincronização.</small>}
        </div>
      )}
    </div>
  );
}
