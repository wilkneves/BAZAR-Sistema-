/**
 * Fechamento: esperado × contado × diferença, totais por forma. Observação obrigatória se houver diferença.
 * Bloqueado enquanto houver fila offline neste terminal (o servidor também recusa com 409).
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { caixaApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import { FORMAS_PAGAMENTO, type CaixaSessao, type PreviaFechamento } from '../../api/types';
import { ErrorAlert, Field, MoneyText } from '../../components/ui';
import { formatMoney, fromCents, toCents, tryCents } from '../../lib/money';
import { idb, KV } from '../../offline/idb';
import { useOnline, useTamanhoFila } from '../../offline/hooks';
import { sincronizarAgora } from '../../offline/sync';
import { formatDateTime } from '../../lib/format';

export function FecharCaixaPage() {
  const nav = useNavigate();
  const online = useOnline();
  const fila = useTamanhoFila();
  const [caixa, setCaixa] = useState<CaixaSessao | null>(null);
  const [previa, setPrevia] = useState<PreviaFechamento | null>(null);
  const [contado, setContado] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [fechado, setFechado] = useState<CaixaSessao | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const cx = await caixaApi.atual(); setCaixa(cx);
      setPrevia(await caixaApi.previaFechamento(cx.id));
    } catch (e) { setErro(errorMessage(e)); }
  }
  useEffect(() => { if (online) void carregar(); }, [online]);

  const contadoCents = tryCents(contado);
  const difCents = previa && contadoCents !== null ? contadoCents - toCents(previa.esperadoDinheiro) : null;
  const precisaObs = difCents !== null && difCents !== 0;
  const pode = online && fila === 0 && caixa && contadoCents !== null && contadoCents >= 0 && (!precisaObs || obs.trim().length >= 5);

  async function fechar() {
    if (!pode || !caixa) return;
    setEnviando(true); setErro(null);
    try {
      const r = await caixaApi.fechar(caixa.id, fromCents(contadoCents!), obs.trim() || undefined);
      await idb.del('kv', KV.caixaAtual); await idb.del('kv', KV.carrinho);
      setFechado(r);
    } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }

  if (fechado) {
    return (
      <div className="center-page"><div className="card login-card">
        <h1>Caixa fechado</h1>
        <p>{fechado.terminalNome} · {formatDateTime(fechado.fechadoEm)}</p>
        <p>Esperado: <MoneyText value={fechado.esperado} /> · Contado: <MoneyText value={fechado.contado} /></p>
        <p>Diferença: <strong className={fechado.diferenca !== '0.00' ? 'txt-erro' : 'txt-ok'}><MoneyText value={fechado.diferenca} /></strong></p>
        <Link to="/" className="btn btn-primary btn-block">Ir para o início</Link>
      </div></div>
    );
  }

  return (
    <div className="center-page">
      <div className="card fechamento">
        <h1>Fechamento de caixa</h1>
        {!online && <div className="alert alert-warn">O fechamento exige conexão.</div>}
        {fila > 0 && (
          <div className="alert alert-warn" role="alert">
            Há {fila} registro(s) offline neste terminal. Sincronize antes de fechar.
            <button className="btn" disabled={!online} onClick={() => sincronizarAgora().then(carregar).catch((e) => setErro(errorMessage(e)))}>Sincronizar agora</button>
          </div>
        )}
        {previa && (
          <>
            <table className="table">
              <tbody>
                <tr><td>Fundo de troco</td><td className="num"><MoneyText value={previa.fundoTroco} /></td></tr>
                {FORMAS_PAGAMENTO.map((f) => <tr key={f.value}><td>Vendas — {f.label}</td><td className="num"><MoneyText value={previa.totaisPorForma[f.value]} /></td></tr>)}
                <tr><td>Suprimentos</td><td className="num"><MoneyText value={previa.suprimentos} /></td></tr>
                <tr><td>Sangrias</td><td className="num">− <MoneyText value={previa.sangrias} /></td></tr>
                <tr className="destaque"><td>Dinheiro esperado na gaveta</td><td className="num"><MoneyText value={previa.esperadoDinheiro} /></td></tr>
              </tbody>
            </table>
            <p className="muted">{previa.quantidadeVendas} venda(s) neste caixa.</p>
            <Field label="Dinheiro contado (R$)"><input inputMode="decimal" value={contado} onChange={(e) => setContado(e.target.value)} autoFocus /></Field>
            {difCents !== null && <p>Diferença: <strong className={difCents ? 'txt-erro' : 'txt-ok'}>{formatMoney(difCents)}</strong> {difCents > 0 ? '(sobra)' : difCents < 0 ? '(falta)' : ''}</p>}
            {precisaObs && <Field label="Justificativa da diferença (obrigatória)"><textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} maxLength={500} /></Field>}
          </>
        )}
        <ErrorAlert erro={erro} />
        <div className="row">
          <Link to="/pdv" className="btn">Voltar ao PDV</Link>
          <button className="btn btn-primary btn-lg grow" onClick={fechar} disabled={!pode || enviando}>{enviando ? 'Fechando…' : 'Fechar caixa'}</button>
        </div>
        <button className="btn btn-ghost" onClick={() => nav('/')}>Ir ao Backoffice sem fechar</button>
      </div>
    </div>
  );
}
