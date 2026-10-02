/**
 * REL — relatórios em JSON (tela) e exportação PDF/CSV/XLSX (RF-REL-01..07).
 * Períodos por data local de America/Fortaleza (RN-31). Prestação de contas: por parceiro OU por
 * campanha (nunca somados), doação/compra/saldo inicial separados, blocos "recebido" e "movimentado".
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { parse, zData } from '../../lib/http.js';
import { fromCents, toCents } from '../../lib/money.js';
import { fimDoDiaExclusivo, inicioDoDia, localDate, TZ } from '../../lib/dates.js';
import { gerarCsv, gerarXlsx } from '../../lib/planilha.js';
import { auditar } from '../../lib/audit.js';
import { exigirUsuario } from '../../plugins/auth.js';

type Tipo = 'money' | 'number' | 'date' | 'text';
interface Coluna { chave: string; rotulo: string; tipo?: Tipo }
interface Relatorio { titulo: string; colunas: Coluna[]; linhas: Record<string, string | number | null>[]; totais?: Record<string, string | number> }

const zFiltro = z.object({
  de: zData, ate: zData,
  modo: z.enum(['parceiro', 'campanha']).default('parceiro'),
  local: z.enum(['BAZAR', 'DOACOES', '']).optional(),
  formato: z.enum(['json', 'pdf', 'csv', 'xlsx']).default('json'),
}).refine((f) => f.de <= f.ate, 'período inválido');
type Filtro = z.infer<typeof zFiltro>;

const cents = (v: unknown) => toCents(Number(v ?? 0).toFixed(2));
const ROTULO_TIPO: Record<string, string> = { DOACAO: 'Doação', COMPRA: 'Compra', SALDO_INICIAL: 'Saldo inicial' };

// ---------------- prestação de contas (RF-REL-01, RN-18) ----------------
async function prestacaoContas(f: Filtro): Promise<Relatorio> {
  const ini = inicioDoDia(f.de), fim = fimDoDiaExclusivo(f.ate);
  const col = f.modo === 'parceiro' ? 'parceiro_id' : 'campanha_id';
  const grupoLote = f.modo === 'parceiro' ? 'l.parceiro_id' : 'l.campanha_id';
  type Rec = { grupo: string | null; tipo: string; lotes: bigint; recebidos: bigint; valor: string };
  type Mov = { grupo: string | null; tipo: string; vendidos: bigint; receita: string; transf_doacoes: bigint; transf_bazar: bigint; baixados: bigint };
  type Sal = { grupo: string | null; tipo: string; bazar: bigint; doacoes: bigint };
  type Des = { grupo: string | null; tipo: string; descartados: bigint };

  // Prisma.sql não interpola identificadores: as duas variantes são fixas (sem input do usuário no SQL)
  const recebido = await prisma.$queryRawUnsafe<Rec[]>(`
    SELECT ${grupoLote}::text AS grupo, l.tipo::text AS tipo, count(DISTINCT l.id) AS lotes,
           coalesce(sum(i.quantidade_inicial), 0) AS recebidos, coalesce(sum(i.quantidade_inicial * i.valor_atribuido), 0)::text AS valor
    FROM lote_entrada l LEFT JOIN item i ON i.lote_id = l.id
    WHERE l.recebido_em >= $1 AND l.recebido_em < $2 GROUP BY 1, 2`, ini, fim);
  const descartes = await prisma.$queryRawUnsafe<Des[]>(`
    SELECT ${grupoLote}::text AS grupo, l.tipo::text AS tipo, count(*) AS descartados
    FROM descarte d JOIN lote_entrada l ON l.id = d.lote_id
    WHERE d.revertido_em IS NULL AND l.recebido_em >= $1 AND l.recebido_em < $2 GROUP BY 1, 2`, ini, fim);
  const movimentado = await prisma.$queryRawUnsafe<Mov[]>(`
    SELECT m.${col}::text AS grupo, m.tipo_entrada::text AS tipo,
      coalesce(sum(CASE m.tipo WHEN 'VENDA' THEN m.quantidade WHEN 'ESTORNO_VENDA' THEN -m.quantidade ELSE 0 END), 0) AS vendidos,
      coalesce(sum(m.receita), 0)::text AS receita,
      coalesce(sum(CASE WHEN m.tipo = 'TRANSFERENCIA' AND m.local_destino_id = 2 THEN m.quantidade ELSE 0 END), 0) AS transf_doacoes,
      coalesce(sum(CASE WHEN m.tipo = 'TRANSFERENCIA' AND m.local_destino_id = 1 THEN m.quantidade ELSE 0 END), 0) AS transf_bazar,
      coalesce(sum(CASE WHEN m.tipo = 'BAIXA' THEN m.quantidade ELSE 0 END), 0) AS baixados
    FROM vw_movimentacao_origem m WHERE m.ocorrido_em >= $1 AND m.ocorrido_em < $2 GROUP BY 1, 2`, ini, fim);
  const saldo = await prisma.$queryRawUnsafe<Sal[]>(`
    SELECT ${grupoLote}::text AS grupo, l.tipo::text AS tipo,
      coalesce(sum(s.saldo) FILTER (WHERE s.local_id = 1), 0) AS bazar, coalesce(sum(s.saldo) FILTER (WHERE s.local_id = 2), 0) AS doacoes
    FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id JOIN lote_entrada l ON l.id = i.lote_id GROUP BY 1, 2`);

  const nomes = new Map<string, string>(f.modo === 'parceiro'
    ? (await prisma.parceiro.findMany({ select: { id: true, nome: true } })).map((p) => [p.id, p.nome])
    : (await prisma.campanha.findMany({ select: { id: true, nome: true } })).map((c) => [c.id, c.nome]));
  const vazio = () => ({ lotes: 0, recebidos: 0, descartados: 0, valor: 0, vendidos: 0, receita: 0, transfDoacoes: 0, transfBazar: 0, baixados: 0, saldoBazar: 0, saldoDoacoes: 0 });
  const g = new Map<string, ReturnType<typeof vazio> & { grupo: string | null; tipo: string }>();
  const pega = (grupo: string | null, tipo: string) => {
    const k = `${grupo ?? '-'}|${tipo}`;
    if (!g.has(k)) g.set(k, { ...vazio(), grupo, tipo });
    return g.get(k)!;
  };
  for (const r of recebido) Object.assign(pega(r.grupo, r.tipo), { lotes: Number(r.lotes), recebidos: Number(r.recebidos), valor: cents(r.valor) });
  for (const r of descartes) pega(r.grupo, r.tipo).descartados = Number(r.descartados);
  for (const r of movimentado) Object.assign(pega(r.grupo, r.tipo), { vendidos: Number(r.vendidos), receita: cents(r.receita), transfDoacoes: Number(r.transf_doacoes), transfBazar: Number(r.transf_bazar), baixados: Number(r.baixados) });
  for (const r of saldo) Object.assign(pega(r.grupo, r.tipo), { saldoBazar: Number(r.bazar), saldoDoacoes: Number(r.doacoes) });

  const semGrupo = f.modo === 'parceiro' ? '(sem parceiro)' : '(sem campanha)';
  const linhas = [...g.values()]
    .filter((x) => x.lotes || x.recebidos || x.vendidos || x.receita || x.transfDoacoes || x.transfBazar || x.baixados || x.saldoBazar || x.saldoDoacoes || x.descartados)
    .map((x) => ({
      nome: x.grupo ? nomes.get(x.grupo) ?? '—' : semGrupo, tipoEntrada: ROTULO_TIPO[x.tipo] ?? x.tipo,
      lotes: x.lotes, recebidos: x.recebidos, descartados: x.descartados, valorAtribuido: fromCents(x.valor),
      vendidos: x.vendidos, receita: fromCents(x.receita), transfDoacoes: x.transfDoacoes, transfBazar: x.transfBazar, baixados: x.baixados,
      saldoBazar: x.saldoBazar, saldoDoacoes: x.saldoDoacoes,
    }))
    .sort((a, b) => a.tipoEntrada.localeCompare(b.tipoEntrada) || a.nome.localeCompare(b.nome));
  const soma = (k: keyof (typeof linhas)[number]) => linhas.reduce((s, l) => s + Number(l[k]), 0);
  return {
    titulo: `Prestação de contas por ${f.modo}`,
    colunas: [
      { chave: 'nome', rotulo: f.modo === 'parceiro' ? 'Parceiro' : 'Campanha' }, { chave: 'tipoEntrada', rotulo: 'Tipo de entrada' },
      { chave: 'lotes', rotulo: 'Lotes recebidos', tipo: 'number' }, { chave: 'recebidos', rotulo: 'Itens aprovados', tipo: 'number' },
      { chave: 'descartados', rotulo: 'Descartados', tipo: 'number' }, { chave: 'valorAtribuido', rotulo: 'Valor atribuído', tipo: 'money' },
      { chave: 'vendidos', rotulo: 'Vendidos no período', tipo: 'number' }, { chave: 'receita', rotulo: 'Receita no período', tipo: 'money' },
      { chave: 'transfDoacoes', rotulo: 'Transf. → doações', tipo: 'number' }, { chave: 'transfBazar', rotulo: 'Transf. → bazar', tipo: 'number' },
      { chave: 'baixados', rotulo: 'Baixados', tipo: 'number' },
      { chave: 'saldoBazar', rotulo: 'Saldo atual bazar', tipo: 'number' }, { chave: 'saldoDoacoes', rotulo: 'Saldo atual doações', tipo: 'number' },
    ],
    linhas,
    totais: {
      recebidos: soma('recebidos'), descartados: soma('descartados'), vendidos: soma('vendidos'),
      valorAtribuido: fromCents(linhas.reduce((s, l) => s + toCents(l.valorAtribuido), 0)),
      receita: fromCents(linhas.reduce((s, l) => s + toCents(l.receita), 0)),
    },
  };
}

// ---------------- vendas (RF-REL-02, RF-FIS-02) ----------------
async function vendas(f: Filtro): Promise<Relatorio> {
  const rows = await prisma.$queryRaw<{ numero: number; ocorrida_em: Date; operador: string; status: string; formas: string | null; total: string; imposto: string; categorias: string | null }[]>`
    SELECT v.numero, v.ocorrida_em, u.nome AS operador, v.status::text AS status,
      (SELECT string_agg(DISTINCT p.forma::text, ', ') FROM venda_pagamento p WHERE p.venda_id = v.id) AS formas,
      v.total::text AS total,
      (SELECT coalesce(sum(vi.valor_imposto), 0) FROM venda_item vi WHERE vi.venda_id = v.id)::text AS imposto,
      (SELECT string_agg(DISTINCT c.nome, ', ') FROM venda_item vi JOIN item i ON i.id = vi.item_id JOIN categoria c ON c.id = i.categoria_id WHERE vi.venda_id = v.id) AS categorias
    FROM venda v JOIN usuario u ON u.id = v.registrada_por_id
    WHERE v.ocorrida_em >= ${inicioDoDia(f.de)} AND v.ocorrida_em < ${fimDoDiaExclusivo(f.ate)}
    ORDER BY v.ocorrida_em, v.numero`;
  const conc = rows.filter((r) => r.status === 'FINALIZADA');
  return {
    titulo: 'Vendas no período',
    colunas: [
      { chave: 'numero', rotulo: 'Nº', tipo: 'number' }, { chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'operador', rotulo: 'Operador' },
      { chave: 'categorias', rotulo: 'Categorias' }, { chave: 'formas', rotulo: 'Formas de pagamento' }, { chave: 'status', rotulo: 'Status' },
      { chave: 'imposto', rotulo: 'Imposto calculado', tipo: 'money' }, { chave: 'total', rotulo: 'Total', tipo: 'money' },
    ],
    linhas: rows.map((r) => ({
      numero: r.numero, data: r.ocorrida_em.toISOString(), operador: r.operador, categorias: r.categorias ?? '', formas: r.formas ?? '',
      status: r.status === 'FINALIZADA' ? 'CONCLUIDA' : 'CANCELADA', imposto: Number(r.imposto).toFixed(2), total: Number(r.total).toFixed(2),
    })),
    totais: {
      total: fromCents(conc.reduce((s, r) => s + cents(r.total), 0)),
      imposto: fromCents(conc.reduce((s, r) => s + cents(r.imposto), 0)),
      canceladas: rows.length - conc.length,
    },
  };
}

// ---------------- posição de estoque (RF-REL-03) ----------------
async function estoque(f: Filtro): Promise<Relatorio> {
  const rows = await prisma.$queryRaw<{ categoria: string; local_id: number; qtd: bigint; atribuido: string; potencial: string }[]>`
    SELECT c.nome AS categoria, s.local_id, sum(s.saldo) AS qtd,
      sum(s.saldo * i.valor_atribuido)::text AS atribuido,
      sum(s.saldo * CASE WHEN i.tipo_controle = 'ETIQUETADO' THEN i.preco_venda ELSE coalesce(c.preco_padrao, 0) END)::text AS potencial
    FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id JOIN categoria c ON c.id = i.categoria_id
    WHERE s.saldo > 0 GROUP BY c.nome, s.local_id ORDER BY c.nome, s.local_id`;
  const filtrado = rows.filter((r) => !f.local || (f.local === 'BAZAR' ? r.local_id === 1 : r.local_id === 2));
  return {
    titulo: `Posição de estoque${f.local ? ` — ${f.local === 'BAZAR' ? 'bazar' : 'doações'}` : ''}`,
    colunas: [
      { chave: 'categoria', rotulo: 'Categoria' }, { chave: 'estoque', rotulo: 'Estoque' }, { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'number' },
      { chave: 'valorAtribuido', rotulo: 'Valor atribuído', tipo: 'money' }, { chave: 'valorPotencial', rotulo: 'Valor de venda potencial', tipo: 'money' },
    ],
    linhas: filtrado.map((r) => ({ categoria: r.categoria, estoque: r.local_id === 1 ? 'Bazar' : 'Doações', quantidade: Number(r.qtd), valorAtribuido: Number(r.atribuido).toFixed(2), valorPotencial: Number(r.potencial).toFixed(2) })),
    totais: {
      quantidade: filtrado.reduce((s, r) => s + Number(r.qtd), 0),
      valorAtribuido: fromCents(filtrado.reduce((s, r) => s + cents(r.atribuido), 0)),
      valorPotencial: fromCents(filtrado.reduce((s, r) => s + cents(r.potencial), 0)),
    },
  };
}

// ---------------- descartes (RF-REL-04) ----------------
async function descartesRel(f: Filtro): Promise<Relatorio> {
  const rows = await prisma.descarte.findMany({
    where: { revertidoEm: null, registradoEm: { gte: inicioDoDia(f.de), lt: fimDoDiaExclusivo(f.ate) } },
    include: { lote: { select: { numero: true, parceiro: { select: { nome: true } }, campanha: { select: { nome: true } } } }, categoria: { select: { nome: true } }, motivo: { select: { nome: true } } },
    orderBy: { registradoEm: 'asc' },
  });
  return {
    titulo: 'Descartes no período',
    colunas: [{ chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'lote', rotulo: 'Lote', tipo: 'number' }, { chave: 'parceiro', rotulo: 'Parceiro/Campanha' }, { chave: 'categoria', rotulo: 'Categoria' }, { chave: 'motivo', rotulo: 'Motivo' }],
    linhas: rows.map((d) => ({ data: d.registradoEm.toISOString(), lote: d.lote.numero, parceiro: d.lote.parceiro?.nome ?? d.lote.campanha?.nome ?? '—', categoria: d.categoria.nome, motivo: d.motivo.nome })),
    totais: { motivo: rows.length },
  };
}

// ---------------- transferências (RF-REL-05) ----------------
async function transferencias(f: Filtro): Promise<Relatorio> {
  const rows = await prisma.movimentacao.findMany({
    where: { tipo: 'TRANSFERENCIA', ocorridoEm: { gte: inicioDoDia(f.de), lt: fimDoDiaExclusivo(f.ate) } },
    include: { item: { select: { descricao: true, codigoBarras: true, categoria: { select: { nome: true } } } } },
    orderBy: { ocorridoEm: 'asc' },
  });
  const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.usuarioId))] } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
  return {
    titulo: 'Transferências entre bazar e doações',
    colunas: [{ chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'item', rotulo: 'Item' }, { chave: 'descricao', rotulo: 'Sentido' }, { chave: 'quantidade', rotulo: 'Qtd.', tipo: 'number' }, { chave: 'usuario', rotulo: 'Usuário' }, { chave: 'motivo', rotulo: 'Motivo' }],
    linhas: rows.map((m) => ({
      data: m.ocorridoEm.toISOString(), item: m.item.codigoBarras ? `${m.item.codigoBarras} — ${m.item.descricao ?? ''}` : m.item.descricao ?? m.item.categoria.nome,
      descricao: m.localOrigemId === 1 ? 'Bazar → Doações' : 'Doações → Bazar', quantidade: m.quantidade, usuario: nomes.get(m.usuarioId) ?? '—', motivo: m.motivo ?? '',
    })),
    totais: { quantidade: rows.reduce((s, r) => s + r.quantidade, 0) },
  };
}

// ---------------- fiado em aberto (RF-REL-06) ----------------
async function fiado(): Promise<Relatorio> {
  const hoje = localDate();
  const rows = await prisma.contaReceber.findMany({
    where: { status: { in: ['ABERTA', 'PARCIAL'] } },
    include: { cliente: { select: { nome: true } }, recebimentos: { where: { estornadoEm: null }, select: { valor: true } } },
    orderBy: [{ vencimento: 'asc' }],
  });
  const linhas = rows.map((c) => {
    const saldo = toCents(c.valor) - c.recebimentos.reduce((s, r) => s + toCents(r.valor), 0);
    const venc = c.vencimento.toISOString().slice(0, 10);
    return { cliente: c.cliente.nome, vencimento: venc, saldo: fromCents(saldo), status: c.status, vencido: venc < hoje ? 'Sim' : 'Não' };
  });
  return {
    titulo: `Fiado em aberto (referência ${hoje.split('-').reverse().join('/')})`,
    colunas: [{ chave: 'cliente', rotulo: 'Cliente' }, { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'date' }, { chave: 'saldo', rotulo: 'Saldo', tipo: 'money' }, { chave: 'status', rotulo: 'Status' }, { chave: 'vencido', rotulo: 'Vencido' }],
    linhas,
    totais: { saldo: fromCents(linhas.reduce((s, l) => s + toCents(l.saldo), 0)) },
  };
}

const RELATORIOS: Record<string, (f: Filtro) => Promise<Relatorio>> = {
  'prestacao-contas': prestacaoContas, vendas, estoque, descartes: descartesRel, transferencias, fiado: () => fiado(),
};

// ---------------- exportação (RF-REL-07) ----------------
const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
function valorExport(c: Coluna, v: unknown): string | number {
  if (v === null || v === undefined) return '';
  if (c.tipo === 'number') return Number(v);
  if (c.tipo === 'money') return Number(v).toFixed(2).replace('.', ',');
  if (c.tipo === 'date') return String(v).length === 10 ? String(v).split('-').reverse().join('/') : fmtData.format(new Date(String(v)));
  return String(v);
}

async function gerarPdf(r: Relatorio, f: Filtro, instituicao: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, info: { Title: r.titulo, Author: instituicao } });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const fim = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(partes))));
  const latin = (s: string) => s.replace(/→/g, '->').replace(/—/g, '-').replace(/[^\x20-\xFF]/g, '?');
  doc.fontSize(14).text(latin(instituicao));
  doc.fontSize(12).text(latin(r.titulo));
  doc.fontSize(9).fillColor('#444').text(`Período: ${f.de.split('-').reverse().join('/')} a ${f.ate.split('-').reverse().join('/')} · Gerado em ${fmtData.format(new Date())}`).fillColor('#000');
  doc.moveDown(0.5);
  const largura = doc.page.width - 60;
  const w = largura / r.colunas.length;
  const linha = (vals: string[], negrito = false) => {
    if (doc.y > doc.page.height - 50) doc.addPage();
    const y = doc.y;
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    let alt = 0;
    vals.forEach((v, i) => { alt = Math.max(alt, doc.heightOfString(latin(v), { width: w - 4 })); });
    vals.forEach((v, i) => doc.text(latin(v), 30 + i * w, y, { width: w - 4 }));
    doc.y = y + alt + 4; doc.x = 30;
  };
  linha(r.colunas.map((c) => c.rotulo), true);
  for (const l of r.linhas) linha(r.colunas.map((c) => String(valorExport(c, l[c.chave]))));
  if (r.totais) linha(r.colunas.map((c, i) => (i === 0 ? 'Totais' : r.totais![c.chave] !== undefined ? String(valorExport(c, r.totais![c.chave])) : '')), true);
  doc.moveDown().fontSize(8).fillColor('#666').text('Documento não fiscal. Gerado pelo Sistema de Bazar — Luz da Esperança.'.replace('—', '-'));
  doc.end();
  return fim;
}

export async function rotasRelatorios(app: FastifyInstance) {
  app.get('/relatorios/:tipo', { config: { acesso: ['relatorios.consultar'], rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { tipo } = parse(z.object({ tipo: z.string().max(40) }), req.params);
    const gerar = RELATORIOS[tipo];
    if (!gerar) throw new AppError(404, 'Relatório inexistente', 'RELATORIO_INEXISTENTE');
    const f = parse(zFiltro, req.query);
    const r = await gerar(f);
    if (f.formato === 'json') return r;

    const cab = r.colunas.map((c) => c.rotulo);
    const linhas = r.linhas.map((l) => r.colunas.map((c) => valorExport(c, l[c.chave])));
    const nome = `${tipo}_${f.de}_${f.ate}`;
    await auditar(prisma, { usuarioId: u.id, ip: req.ip }, 'RELATORIO_EXPORTADO', 'relatorio', tipo, undefined, { formato: f.formato, de: f.de, ate: f.ate });
    if (f.formato === 'csv') {
      return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${nome}.csv"`).send(gerarCsv(cab, linhas));
    }
    if (f.formato === 'xlsx') {
      return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${nome}.xlsx"`).send(await gerarXlsx(r.titulo, cab, linhas));
    }
    const inst = (await prisma.instituicao.findUnique({ where: { id: 1 }, select: { nome: true } }))?.nome ?? 'Luz da Esperança';
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${nome}.pdf"`).send(await gerarPdf(r, f, inst));
  });
}
