/**
 * Triagem do lote — duas colunas rápidas:
 *  Aprovar: categoria, controle (etiquetado/categoria), quantidade, preço (sugerido pela categoria), estoque destino.
 *  Descartar: item a item com motivo (nunca entra no estoque — RN-01).
 * Contador em tempo real, impressão de etiquetas Code 39, encerrar/reabrir lote, reverter descarte.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cadastrosApi, lotesApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { Etiqueta, LocalEstoque, TipoControle } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { Badge, ErrorAlert, Field, MoneyText, PageHeader } from '../../components/ui';
import { ConfirmMotivo } from '../../components/ConfirmMotivo';
import { Modal } from '../../components/Modal';
import { Barcode } from '../../components/Barcode';
import { Can } from '../../auth/guards';
import { formatDateTime } from '../../lib/format';
import { formatMoney, fromCents, toCents, tryCents } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { useToast } from '../../components/Toast';

export function TriagemPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const lote = useAsync(() => lotesApi.obter(id), [id]);
  const ops = useAsync(() => Promise.all([cadastrosApi.listar('categorias', { ativo: true }), cadastrosApi.listar('motivos-descarte', { ativo: true })]), []);
  const [reabrir, setReabrir] = useState(false);
  const [reverter, setReverter] = useState<string | null>(null);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null);

  const l = lote.data;
  const categorias = ops.data?.[0] ?? [];
  const motivos = ops.data?.[1] ?? [];
  const aberto = l?.status === 'ABERTO';
  const etiquetaveis = useMemo(() => l?.itens.filter((i) => i.codigo).map((i) => i.id) ?? [], [l]);

  async function encerrar() {
    try { await lotesApi.encerrar(id); toast('Lote encerrado.'); await lote.reload(); } catch (e) { toast(errorMessage(e), 'erro'); }
  }
  async function imprimirEtiquetas(ids: string[]) {
    try { setEtiquetas(await lotesApi.etiquetas(ids)); } catch (e) { toast(errorMessage(e), 'erro'); }
  }

  if (lote.carregando && !l) return <div className="page">Carregando…</div>;
  if (!l) return <div className="page"><ErrorAlert erro={lote.erro} /></div>;

  return (
    <div className="page">
      <PageHeader titulo={`Triagem — lote #${l.numero}`}>
        {etiquetaveis.length > 0 && <button className="btn" onClick={() => imprimirEtiquetas(etiquetaveis)}>Imprimir etiquetas ({etiquetaveis.length})</button>}
        {aberto ? <button className="btn btn-primary" onClick={encerrar}>Encerrar lote</button>
          : <Can perm="triagem.reabrir"><button className="btn" onClick={() => setReabrir(true)}>Reabrir lote</button></Can>}
      </PageHeader>
      <p className="muted">
        {[l.parceiroNome, l.campanhaNome].filter(Boolean).join(' · ')} · recebido em {formatDateTime(l.recebidoEm)} {l.documento && `· ${l.documento}`}{' '}
        {aberto ? <Badge tom="alerta">Aguardando triagem</Badge> : <Badge tom="ok">Triado</Badge>}
      </p>
      <div className="contadores" aria-live="polite">
        <div className="card"><span>Aprovados</span><strong>{l.aprovados}</strong></div>
        <div className="card"><span>Descartados</span><strong>{l.descartados}</strong></div>
        <div className="card"><span>Valor atribuído</span><strong><MoneyText value={l.valorAtribuido} /></strong></div>
      </div>
      <ErrorAlert erro={ops.erro} />

      {aberto && (
        <div className="grid-2 triagem">
          <FormAprovar loteId={id} categorias={categorias} onOk={async (novoId, etiquetado) => { await lote.reload(); if (etiquetado) void imprimirEtiquetas([novoId]); }} />
          <FormDescartar loteId={id} categorias={categorias} motivos={motivos} onOk={() => lote.reload()} />
        </div>
      )}

      <div className="grid-2">
        <section>
          <h2>Itens aprovados</h2>
          <table className="table compact">
            <thead><tr><th>Código</th><th>Descrição</th><th className="num">Qtd.</th><th className="num">Preço</th><th>Destino</th></tr></thead>
            <tbody>{l.itens.map((i) => <tr key={i.id}><td>{i.codigo ?? '—'}</td><td><Link to={`/estoque/itens/${i.id}`}>{i.descricao}</Link></td><td className="num">{i.quantidade}</td><td className="num"><MoneyText value={i.preco} /></td><td>{i.localDestino === 'BAZAR' ? 'Bazar' : 'Doações'}</td></tr>)}</tbody>
          </table>
        </section>
        <section>
          <h2>Descartes</h2>
          <table className="table compact">
            <thead><tr><th>Quando</th><th>Categoria</th><th>Motivo</th><th /></tr></thead>
            <tbody>{l.descartes.map((d) => (
              <tr key={d.id} className={d.revertido ? 'riscado' : ''}>
                <td>{formatDateTime(d.registradoEm)}</td><td>{d.categoriaNome}</td><td>{d.motivoNome}{d.revertido && ' (revertido)'}</td>
                <td><Can perm="triagem.reabrir">{!d.revertido && <button className="btn btn-sm" onClick={() => setReverter(d.id)}>Reverter</button>}</Can></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      </div>

      <ConfirmMotivo aberto={reabrir} titulo="Reabrir lote" descricao="O lote voltará a aceitar aprovações e descartes." onFechar={() => setReabrir(false)}
        onConfirmar={async (m) => { await lotesApi.reabrir(id, m); toast('Lote reaberto.'); await lote.reload(); }} />
      <ConfirmMotivo aberto={!!reverter} titulo="Reverter descarte" descricao="O item precisará passar por nova triagem (o lote será reaberto)." onFechar={() => setReverter(null)}
        onConfirmar={async (m) => { await lotesApi.reverterDescarte(reverter!, m); toast('Descarte revertido.'); await lote.reload(); }} />
      <Modal titulo="Etiquetas" aberto={!!etiquetas} onFechar={() => setEtiquetas(null)} largura="lg"
        rodape={<><button className="btn" onClick={() => setEtiquetas(null)}>Fechar</button><button className="btn btn-primary" onClick={() => window.print()}>Imprimir</button></>}>
        <div className="print-area etiquetas">
          {etiquetas?.map((e) => (
            <div key={e.itemId} className="etiqueta">
              <div className="etq-desc">{e.descricao}</div>
              <Barcode value={e.codigo} />
              <div className="etq-rodape"><code>{e.codigo}</code><strong>{formatMoney(e.preco)}</strong></div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function FormAprovar({ loteId, categorias, onOk }: { loteId: string; categorias: { id: string; nome: string; precoPadrao: string }[]; onOk: (id: string, etiquetado: boolean) => Promise<void> }) {
  const [categoriaId, setCategoriaId] = useState('');
  const [controle, setControle] = useState<TipoControle>('CATEGORIA');
  const [qtd, setQtd] = useState('1');
  const [preco, setPreco] = useState('');
  const [descricao, setDescricao] = useState('');
  const [destino, setDestino] = useState<LocalEstoque>('BAZAR');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cat = categorias.find((c) => c.id === categoriaId);
  const precoCents = tryCents(preco) ?? (cat ? toCents(cat.precoPadrao) : null);
  const q = controle === 'ETIQUETADO' ? 1 : Number.parseInt(qtd, 10);
  const valido = cat && precoCents !== null && precoCents > 0 && Number.isInteger(q) && q > 0 && (controle === 'CATEGORIA' || descricao.trim().length >= 3);

  async function aprovar(e: FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setEnviando(true); setErro(null);
    try {
      const r = await lotesApi.aprovarItem(loteId, { id: uuid(), categoriaId, controle, quantidade: q, preco: fromCents(precoCents!), descricao: descricao.trim() || undefined, localDestino: destino });
      setQtd('1'); setDescricao(''); setPreco('');
      await onOk(r.id, controle === 'ETIQUETADO');
    } catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }

  return (
    <form className="card col-aprovar" onSubmit={aprovar}>
      <h2>Aprovar</h2>
      <Field label="Categoria"><select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} autoFocus><option value="">Selecione…</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
      <div className="row" role="radiogroup" aria-label="Controle">
        <label className="check"><input type="radio" checked={controle === 'CATEGORIA'} onChange={() => setControle('CATEGORIA')} /> Por categoria</label>
        <label className="check"><input type="radio" checked={controle === 'ETIQUETADO'} onChange={() => setControle('ETIQUETADO')} /> Etiquetado (peça única)</label>
      </div>
      {controle === 'ETIQUETADO'
        ? <Field label="Descrição da peça"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={120} /></Field>
        : <Field label="Quantidade"><input inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>}
      <Field label="Preço (R$)" hint={cat ? `Sugerido pela categoria: ${formatMoney(cat.precoPadrao)}` : undefined}>
        <input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder={cat ? cat.precoPadrao.replace('.', ',') : ''} />
      </Field>
      <Field label="Estoque de destino"><select value={destino} onChange={(e) => setDestino(e.target.value as LocalEstoque)}><option value="BAZAR">Bazar</option><option value="DOACOES">Doações</option></select></Field>
      {cat && precoCents && <p className="muted">Valor sugerido: {formatMoney(precoCents * (q || 0))}</p>}
      <ErrorAlert erro={erro} />
      <button className="btn btn-primary btn-lg btn-block" disabled={!valido || enviando}>Aprovar</button>
    </form>
  );
}

function FormDescartar({ loteId, categorias, motivos, onOk }: { loteId: string; categorias: { id: string; nome: string }[]; motivos: { id: string; nome: string }[]; onOk: () => Promise<void> }) {
  const [categoriaId, setCategoriaId] = useState('');
  const [motivoId, setMotivoId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function descartar(e: FormEvent) {
    e.preventDefault();
    if (!categoriaId || !motivoId) return;
    setEnviando(true); setErro(null);
    try { await lotesApi.descartar(loteId, { id: uuid(), categoriaId, motivoId }); await onOk(); }
    catch (err) { setErro(errorMessage(err)); } finally { setEnviando(false); }
  }
  return (
    <form className="card col-descartar" onSubmit={descartar}>
      <h2>Descartar</h2>
      <p className="muted">Um registro por item. Itens descartados nunca entram no estoque.</p>
      <Field label="Categoria"><select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}><option value="">Selecione…</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
      <Field label="Motivo"><select value={motivoId} onChange={(e) => setMotivoId(e.target.value)}><option value="">Selecione…</option>{motivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></Field>
      <ErrorAlert erro={erro} />
      <button className="btn btn-danger btn-lg btn-block" disabled={!categoriaId || !motivoId || enviando}>Descartar 1 item</button>
    </form>
  );
}
