/** Baixa com motivo, ajuste de inventário, alteração de preço e carga inicial por planilha (Admin). Tudo auditado. */
import { useState } from 'react';
import { cadastrosApi, estoqueApi } from '../../api/modules';
import { errorMessage } from '../../api/http';
import type { CargaInicialResultado, ItemEstoque, LocalEstoque } from '../../api/types';
import { useAsync } from '../../components/useAsync';
import { ErrorAlert, Field, MoneyText, PageHeader, Tabs } from '../../components/ui';
import { ItemPicker } from '../../components/ItemPicker';
import { fromCents, tryCents } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { useToast } from '../../components/Toast';

type Aba = 'baixa' | 'ajuste' | 'preco' | 'carga';

export function AjustesPage() {
  const [aba, setAba] = useState<Aba>('baixa');
  return (
    <div className="page narrow">
      <PageHeader titulo="Baixa, ajuste e preço" />
      <Tabs atual={aba} onChange={setAba} abas={[{ id: 'baixa', rotulo: 'Baixa' }, { id: 'ajuste', rotulo: 'Ajuste de inventário' }, { id: 'preco', rotulo: 'Alterar preço' }, { id: 'carga', rotulo: 'Carga inicial' }]} />
      {aba === 'baixa' && <BaixaAjuste modo="baixa" />}
      {aba === 'ajuste' && <BaixaAjuste modo="ajuste" />}
      {aba === 'preco' && <Preco />}
      {aba === 'carga' && <CargaInicial />}
    </div>
  );
}

function BaixaAjuste({ modo }: { modo: 'baixa' | 'ajuste' }) {
  const toast = useToast();
  const motivos = useAsync(() => cadastrosApi.listar('motivos-baixa', { ativo: true }), []);
  const [item, setItem] = useState<ItemEstoque | null>(null);
  const [local, setLocal] = useState<LocalEstoque>('BAZAR');
  const [tipo, setTipo] = useState<'AJUSTE_ENTRADA' | 'AJUSTE_SAIDA'>('AJUSTE_SAIDA');
  const [qtd, setQtd] = useState('1');
  const [motivoId, setMotivoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const q = Number.parseInt(qtd, 10);
  const saldo = item ? (local === 'BAZAR' ? item.saldoBazar : item.saldoDoacoes) : 0;
  const saida = modo === 'baixa' || tipo === 'AJUSTE_SAIDA';
  const valido = item && q > 0 && (!saida || q <= saldo) && (modo === 'baixa' ? !!motivoId : motivo.trim().length >= 5);

  async function salvar() {
    if (!valido || !item) return;
    setErro(null);
    try {
      if (modo === 'baixa') await estoqueApi.baixa({ id: uuid(), itemId: item.id, quantidade: q, local, motivoId });
      else await estoqueApi.ajuste({ id: uuid(), itemId: item.id, local, tipo, quantidade: q, motivo: motivo.trim() });
      toast(modo === 'baixa' ? 'Baixa registrada.' : 'Ajuste registrado.');
      setItem(null); setQtd('1'); setMotivo('');
    } catch (e) { setErro(errorMessage(e)); }
  }

  return (
    <div className="card">
      <ItemPicker onSelecionar={setItem} />
      {item && (<>
        <h3>{item.descricao}</h3>
        <p>Bazar: {item.saldoBazar} · Doações: {item.saldoDoacoes}</p>
        <div className="grid-2">
          <Field label="Estoque"><select value={local} onChange={(e) => setLocal(e.target.value as LocalEstoque)}><option value="BAZAR">Bazar</option><option value="DOACOES">Doações</option></select></Field>
          {modo === 'ajuste' && <Field label="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}><option value="AJUSTE_SAIDA">Saída (faltou na contagem)</option><option value="AJUSTE_ENTRADA">Entrada (sobrou na contagem)</option></select></Field>}
        </div>
        <Field label="Quantidade" erro={saida && q > saldo ? 'Maior que o saldo' : null}><input inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value.replace(/\D/g, ''))} /></Field>
        {modo === 'baixa'
          ? <Field label="Motivo da baixa"><select value={motivoId} onChange={(e) => setMotivoId(e.target.value)}><option value="">Selecione…</option>{motivos.data?.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></Field>
          : <Field label="Motivo do ajuste (mín. 5 caracteres)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>}
        <ErrorAlert erro={erro} />
        <button className="btn btn-primary" disabled={!valido} onClick={salvar}>Registrar</button>
      </>)}
    </div>
  );
}

function Preco() {
  const toast = useToast();
  const cats = useAsync(() => cadastrosApi.listar('categorias', { ativo: true }), []);
  const [alvo, setAlvo] = useState<'item' | 'categoria'>('item');
  const [item, setItem] = useState<ItemEstoque | null>(null);
  const [categoriaId, setCategoriaId] = useState('');
  const [preco, setPreco] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const cents = tryCents(preco);
  const valido = cents !== null && cents > 0 && motivo.trim().length >= 5 && (alvo === 'item' ? !!item : !!categoriaId);

  async function salvar() {
    if (!valido) return;
    setErro(null);
    try {
      if (alvo === 'item') await estoqueApi.precoItem(item!.id, fromCents(cents!), motivo.trim());
      else await estoqueApi.precoCategoria(categoriaId, fromCents(cents!), motivo.trim());
      toast('Preço alterado. Vendas já registradas não mudam.');
      setPreco(''); setMotivo(''); setItem(null);
    } catch (e) { setErro(errorMessage(e)); }
  }
  return (
    <div className="card">
      <div className="row" role="radiogroup">
        <label className="check"><input type="radio" checked={alvo === 'item'} onChange={() => setAlvo('item')} /> Um item</label>
        <label className="check"><input type="radio" checked={alvo === 'categoria'} onChange={() => setAlvo('categoria')} /> Preço padrão da categoria</label>
      </div>
      {alvo === 'item' ? (item ? <p><strong>{item.descricao}</strong> — atual <MoneyText value={item.preco} /> <button className="btn btn-ghost" onClick={() => setItem(null)}>Trocar</button></p> : <ItemPicker onSelecionar={setItem} />)
        : <Field label="Categoria"><select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}><option value="">Selecione…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.nome} (atual {c.precoPadrao.replace('.', ',')})</option>)}</select></Field>}
      <Field label="Novo preço (R$)"><input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></Field>
      <Field label="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} /></Field>
      <ErrorAlert erro={erro} />
      <button className="btn btn-primary" disabled={!valido} onClick={salvar}>Salvar preço</button>
    </div>
  );
}

function CargaInicial() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [res, setRes] = useState<CargaInicialResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (!arquivo) return;
    setEnviando(true); setErro(null); setRes(null);
    try { setRes(await estoqueApi.cargaInicial(arquivo)); } catch (e) { setErro(errorMessage(e)); } finally { setEnviando(false); }
  }
  return (
    <div className="card">
      <p>Envie a planilha (XLSX ou CSV) com o saldo inicial. Se houver qualquer erro, <strong>nada é gravado</strong> e o sistema lista os erros por linha.</p>
      <Field label="Planilha"><input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></Field>
      <button className="btn btn-primary" disabled={!arquivo || enviando} onClick={enviar}>{enviando ? 'Validando…' : 'Enviar'}</button>
      <ErrorAlert erro={erro} />
      {res && (res.gravado ? <div className="alert alert-ok">Carga gravada: {res.linhas} linha(s).</div> : (
        <div className="alert alert-error"><p>Nada foi gravado. Corrija e reenvie:</p><ul>{res.erros.map((e) => <li key={e.linha}>Linha {e.linha}: {e.mensagem}</li>)}</ul></div>
      ))}
    </div>
  );
}
