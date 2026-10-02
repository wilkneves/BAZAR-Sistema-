/**
 * EST — consulta de estoque (saldo só por vw_saldo_estoque), histórico do item, transferência
 * bazar ⇄ doações, baixa, ajuste, preço e carga inicial (RF-EST-01..08).
 * O banco recusa saldo negativo e peça etiquetada com mais de 1 unidade (tg_valida_movimentacao).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db } from '../../lib/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../lib/errors.js';
import { page, parse, zIdParam, zMoney, zMotivo, zPage, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { money, toCents } from '../../lib/money.js';
import { reservarChave } from '../../lib/idempotencia.js';
import { lerPlanilha } from '../../lib/planilha.js';
import { exigirUsuario } from '../../plugins/auth.js';
import { LOCAL_COD, LOCAL_ID, proximoCodigo } from '../ent/lotes.routes.js';

const zLocal = z.enum(['BAZAR', 'DOACOES']);

interface ItemSql {
  id: string; codigo_barras: string | null; descricao: string | null; categoria_id: string; categoria_nome: string;
  tipo_controle: 'ETIQUETADO' | 'CATEGORIA'; preco: string | null; lote_id: string; lote_numero: number;
  parceiro_nome: string | null; campanha_nome: string | null; saldo_bazar: number; saldo_doacoes: number; total?: bigint;
}
const itemDto = (r: ItemSql) => ({
  id: r.id, codigo: r.codigo_barras ?? undefined, descricao: r.descricao ?? r.categoria_nome,
  categoriaId: r.categoria_id, categoriaNome: r.categoria_nome, controle: r.tipo_controle,
  preco: r.preco === null ? '0.00' : Number(r.preco).toFixed(2),
  loteId: r.lote_id, loteNumero: r.lote_numero,
  parceiroNome: r.parceiro_nome ?? undefined, campanhaNome: r.campanha_nome ?? undefined,
  saldoBazar: Number(r.saldo_bazar), saldoDoacoes: Number(r.saldo_doacoes),
});

/** Preço vigente: peça etiquetada = preço próprio; por categoria = preço padrão ATUAL da categoria (RN-08). */
const SELECT_ITEM = Prisma.sql`
  SELECT i.id::text, i.codigo_barras, i.descricao, i.categoria_id::text, c.nome AS categoria_nome, i.tipo_controle::text AS tipo_controle,
         (CASE WHEN i.tipo_controle = 'ETIQUETADO' THEN i.preco_venda ELSE c.preco_padrao END)::text AS preco,
         l.id::text AS lote_id, l.numero AS lote_numero, p.nome AS parceiro_nome, cp.nome AS campanha_nome,
         coalesce(s.b, 0)::int AS saldo_bazar, coalesce(s.d, 0)::int AS saldo_doacoes
  FROM item i
  JOIN categoria c ON c.id = i.categoria_id
  JOIN lote_entrada l ON l.id = i.lote_id
  LEFT JOIN parceiro p ON p.id = l.parceiro_id
  LEFT JOIN campanha cp ON cp.id = l.campanha_id
  LEFT JOIN (SELECT item_id, sum(saldo) FILTER (WHERE local_id = 1) AS b, sum(saldo) FILTER (WHERE local_id = 2) AS d
             FROM vw_saldo_estoque GROUP BY item_id) s ON s.item_id = i.id`;

export async function itemPorId(db: Db, id: string) {
  const [r] = await db.$queryRaw<ItemSql[]>`${SELECT_ITEM} WHERE i.id = ${id}::uuid`;
  return r ? itemDto(r) : null;
}
async function itemPorCodigo(db: Db, codigo: string) {
  const [r] = await db.$queryRaw<ItemSql[]>`${SELECT_ITEM} WHERE i.codigo_barras = ${codigo}`;
  return r ? itemDto(r) : null;
}

/** Resolve o item por id ou código (RF-EST-02: transferência por código da peça ou por item). */
async function acharItemId(db: Db, b: { itemId?: string | undefined; codigo?: string | undefined }): Promise<string> {
  const i = b.itemId
    ? await db.item.findUnique({ where: { id: b.itemId }, select: { id: true } })
    : b.codigo ? await db.item.findUnique({ where: { codigoBarras: b.codigo.toUpperCase() }, select: { id: true } }) : null;
  if (!i) throw new AppError(404, 'Item não encontrado', 'ITEM_INEXISTENTE');
  return i.id;
}

const zTransf = z.object({
  id: zUuid, itemId: zUuid.optional(), codigo: z.string().trim().max(40).optional(), quantidade: z.number().int().min(1).max(100_000),
  origem: zLocal, destino: zLocal, motivo: z.string().trim().max(300).optional(),
}).refine((b) => b.itemId || b.codigo, 'informe itemId ou codigo').refine((b) => b.origem !== b.destino, 'origem e destino devem ser diferentes');
const zBaixa = z.object({ id: zUuid, itemId: zUuid, quantidade: z.number().int().min(1).max(100_000), local: zLocal, motivoId: zUuid, observacao: z.string().trim().max(300).optional() });
const zAjuste = z.object({ id: zUuid, itemId: zUuid, local: zLocal, tipo: z.enum(['AJUSTE_ENTRADA', 'AJUSTE_SAIDA']), quantidade: z.number().int().min(1).max(100_000), motivo: zMotivo });
const zPreco = z.object({ preco: zMoney.refine((v) => toCents(v) > 0, 'preço deve ser maior que zero'), motivo: zMotivo });

export async function rotasEstoque(app: FastifyInstance) {
  app.get('/estoque', { config: { acesso: ['estoque.consultar'] } }, async (req) => {
    const q = parse(zPage.extend({
      local: zLocal.optional(), categoriaId: zUuid.optional(), parceiroId: zUuid.optional(), campanhaId: zUuid.optional(),
      loteId: zUuid.optional(), busca: z.string().trim().max(100).optional(),
    }), req.query);
    const conds: Prisma.Sql[] = [Prisma.sql`coalesce(s.b, 0) + coalesce(s.d, 0) > 0`];
    if (q.local === 'BAZAR') conds.push(Prisma.sql`coalesce(s.b, 0) > 0`);
    if (q.local === 'DOACOES') conds.push(Prisma.sql`coalesce(s.d, 0) > 0`);
    if (q.categoriaId) conds.push(Prisma.sql`i.categoria_id = ${q.categoriaId}::uuid`);
    if (q.parceiroId) conds.push(Prisma.sql`l.parceiro_id = ${q.parceiroId}::uuid`);
    if (q.campanhaId) conds.push(Prisma.sql`l.campanha_id = ${q.campanhaId}::uuid`);
    if (q.loteId) conds.push(Prisma.sql`l.id = ${q.loteId}::uuid`);
    if (q.busca) {
      const like = `%${q.busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(Prisma.sql`(i.descricao ILIKE ${like} OR i.codigo_barras ILIKE ${like} OR c.nome ILIKE ${like})`);
    }
    const where = Prisma.join(conds, ' AND ');
    const rows = await prisma.$queryRaw<ItemSql[]>`
      SELECT x.*, count(*) OVER () AS total FROM (${SELECT_ITEM} WHERE ${where}) x
      ORDER BY x.categoria_nome, x.descricao, x.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
    return page(rows.map(itemDto), q, rows.length ? Number(rows[0]!.total) : 0);
  });

  app.get('/itens/codigo/:codigo', { config: { acesso: ['estoque.consultar', 'caixa.operar'] } }, async (req) => {
    const { codigo } = parse(z.object({ codigo: z.string().trim().min(1).max(40) }), req.params);
    const i = await itemPorCodigo(prisma, codigo.toUpperCase());
    if (!i) throw new AppError(404, 'Código não encontrado', 'CODIGO_INEXISTENTE');
    return i;
  });

  app.get('/itens/:id/historico', { config: { acesso: ['estoque.consultar'] } }, async (req) => {
    const { id } = parse(zIdParam, req.params);
    const item = await itemPorId(prisma, id);
    if (!item) naoEncontrado('Item');
    const lote = await prisma.loteEntrada.findUniqueOrThrow({ where: { id: item!.loteId }, include: { parceiro: { select: { nome: true } }, campanha: { select: { nome: true } } } });
    const movs = await prisma.movimentacao.findMany({ where: { itemId: id }, orderBy: [{ ocorridoEm: 'asc' }, { id: 'asc' }], include: { motivoBaixa: { select: { nome: true } } } });
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.usuarioId))] } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    const origem = [lote.parceiro?.nome, lote.campanha?.nome].filter(Boolean).join(' / ') || (lote.tipo === 'SALDO_INICIAL' ? 'Saldo inicial' : '—');
    const eventos: Record<string, unknown>[] = [
      { ocorridoEm: lote.recebidoEm.toISOString(), tipo: 'TRIAGEM', descricao: `Lote ${lote.numero} recebido — ${origem}`, quantidade: 0 },
    ];
    for (const m of movs) {
      const base = { ocorridoEm: m.ocorridoEm.toISOString(), tipo: m.tipo, usuarioNome: nomes.get(m.usuarioId) };
      const o = m.localOrigemId ? LOCAL_COD[m.localOrigemId] : undefined;
      const d = m.localDestinoId ? LOCAL_COD[m.localDestinoId] : undefined;
      const extra = m.motivoBaixa ? `: ${m.motivoBaixa.nome}` : m.motivo ? ` (${m.motivo})` : '';
      if (m.tipo === 'TRANSFERENCIA') {
        eventos.push({ ...base, descricao: `Transferência ${o} → ${d}${extra}`, quantidade: -m.quantidade, local: o });
        eventos.push({ ...base, descricao: `Transferência ${o} → ${d}`, quantidade: m.quantidade, local: d });
      } else {
        const rotulo: Record<string, string> = { ENTRADA: 'Entrada pela triagem', VENDA: 'Venda', ESTORNO_VENDA: 'Estorno de venda', BAIXA: 'Baixa', AJUSTE_ENTRADA: 'Ajuste de inventário (+)', AJUSTE_SAIDA: 'Ajuste de inventário (−)' };
        eventos.push({ ...base, descricao: `${rotulo[m.tipo]}${extra}`, quantidade: o ? -m.quantidade : m.quantidade, local: o ?? d });
      }
    }
    return { item, eventos };
  });

  app.post('/transferencias', { config: { acesso: ['estoque.transferir'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zTransf, req.body);
    await prisma.$transaction(async (tx) => {
      if (!(await reservarChave(tx, b.id, 'transferencia', u.id))) return; // reenvio: já feito
      const itemId = await acharItemId(tx, b);
      // RN-23: origem, destino, quantidade, usuário, data/hora e motivo opcional — numa única linha
      await tx.movimentacao.create({
        data: { itemId, tipo: 'TRANSFERENCIA', localOrigemId: LOCAL_ID[b.origem], localDestinoId: LOCAL_ID[b.destino], quantidade: b.quantidade, motivo: b.motivo || null, usuarioId: u.id },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TRANSFERENCIA', 'item', itemId, undefined, { origem: b.origem, destino: b.destino, quantidade: b.quantidade });
    });
    return reply.code(204).send();
  });

  app.post('/baixas', { config: { acesso: ['estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zBaixa, req.body);
    await prisma.$transaction(async (tx) => {
      if (!(await reservarChave(tx, b.id, 'baixa', u.id))) return;
      if (!(await tx.motivoBaixa.findFirst({ where: { id: b.motivoId, ativo: true } }))) throw new AppError(400, 'Motivo de baixa inexistente ou inativo', 'VALIDACAO');
      await tx.movimentacao.create({
        data: { itemId: await acharItemId(tx, b), tipo: 'BAIXA', localOrigemId: LOCAL_ID[b.local], quantidade: b.quantidade, motivoBaixaId: b.motivoId, motivo: b.observacao || null, usuarioId: u.id },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'BAIXA', 'item', b.itemId, undefined, { local: b.local, quantidade: b.quantidade, motivoId: b.motivoId });
    });
    return reply.code(204).send();
  });

  app.post('/ajustes', { config: { acesso: ['estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zAjuste, req.body);
    await prisma.$transaction(async (tx) => {
      if (!(await reservarChave(tx, b.id, 'ajuste', u.id))) return;
      const loc = LOCAL_ID[b.local];
      await tx.movimentacao.create({
        data: {
          itemId: await acharItemId(tx, b), tipo: b.tipo, quantidade: b.quantidade, motivo: b.motivo, usuarioId: u.id,
          ...(b.tipo === 'AJUSTE_ENTRADA' ? { localDestinoId: loc } : { localOrigemId: loc }),
        },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, b.tipo, 'item', b.itemId, undefined, { local: b.local, quantidade: b.quantidade, motivo: b.motivo });
    });
    return reply.code(204).send();
  });

  app.patch('/itens/:id/preco', { config: { acesso: ['estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(zPreco, req.body);
    await prisma.$transaction(async (tx) => {
      const i = await tx.item.findUnique({ where: { id }, select: { tipoControle: true, precoVenda: true } });
      if (!i) naoEncontrado('Item');
      if (i!.tipoControle !== 'ETIQUETADO') conflito('PRECO_DA_CATEGORIA', 'Item por categoria usa o preço padrão da categoria');
      await tx.item.update({ where: { id }, data: { precoVenda: b.preco } });
      // RF-EST-07: histórico do preço na auditoria
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'PRECO_ITEM', 'item', id, { preco: money(i!.precoVenda) }, { preco: b.preco, motivo: b.motivo });
    });
    return reply.code(204).send();
  });

  app.patch('/categorias/:id/preco', { config: { acesso: ['estoque.ajustar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(zPreco, req.body);
    await prisma.$transaction(async (tx) => {
      const c = await tx.categoria.findUnique({ where: { id }, select: { precoPadrao: true } });
      if (!c) naoEncontrado('Categoria');
      await tx.categoria.update({ where: { id }, data: { precoPadrao: b.preco } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'PRECO_CATEGORIA', 'categoria', id, { preco: money(c!.precoPadrao) }, { preco: b.preco, motivo: b.motivo });
    });
    return reply.code(204).send();
  });

  // ---------------- carga inicial (RF-EST-08): tudo ou nada ----------------
  app.post('/carga-inicial', { config: { acesso: ['estoque.ajustar'], rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const u = exigirUsuario(req);
    const arq = await req.file();
    if (!arq || arq.fieldname !== 'arquivo') throw new AppError(400, 'Arquivo obrigatório (campo "arquivo")', 'ARQUIVO_OBRIGATORIO');
    const pl = await lerPlanilha(await arq.toBuffer());
    const faltando = ['categoria', 'quantidade', 'preco', 'estoque'].filter((c) => !pl.cabecalho.includes(c));
    if (faltando.length) throw new AppError(400, 'Planilha fora do modelo', 'PLANILHA_INVALIDA', `Colunas obrigatórias ausentes: ${faltando.join(', ')}`);

    const cats = await prisma.categoria.findMany();
    const porNome = new Map(cats.map((c) => [c.nome.trim().toLowerCase(), c]));
    const erros: { linha: number; mensagem: string }[] = [];
    const validas: { cat: (typeof cats)[number]; descricao: string; quantidade: number; preco: string; valor: string; local: 'BAZAR' | 'DOACOES'; controle: 'ETIQUETADO' | 'CATEGORIA' }[] = [];
    for (const { numero, valores: v } of pl.linhas) {
      const cat = porNome.get((v.categoria ?? '').toLowerCase());
      const qtd = Number(v.quantidade);
      const precoTxt = (v.preco ?? '').replace(',', '.');
      const valorTxt = (v.valor_atribuido || v.preco || '').replace(',', '.');
      const local = (v.estoque ?? '').toUpperCase().replace('Õ', 'O').replace('DOAÇÕES', 'DOACOES');
      const controle = (v.controle ?? '').toUpperCase() || (cat?.vendaPorCategoria ? 'CATEGORIA' : 'ETIQUETADO');
      const e: string[] = [];
      if (!cat) e.push(`Categoria "${(v.categoria ?? '').slice(0, 60)}" não cadastrada`);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 100_000) e.push('Quantidade inválida');
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(precoTxt) || Number(precoTxt) <= 0) e.push(`Preço inválido: "${(v.preco ?? '').slice(0, 20)}"`);
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(valorTxt)) e.push('Valor atribuído inválido');
      if (local !== 'BAZAR' && local !== 'DOACOES') e.push('Estoque deve ser BAZAR ou DOACOES');
      if (controle !== 'ETIQUETADO' && controle !== 'CATEGORIA') e.push('Controle deve ser ETIQUETADO ou CATEGORIA');
      if (controle === 'ETIQUETADO' && qtd !== 1) e.push('Peça etiquetada tem quantidade 1 (uma linha por peça)');
      if (e.length) erros.push({ linha: numero, mensagem: e.join('; ') });
      else validas.push({ cat: cat!, descricao: (v.descricao ?? '').slice(0, 120), quantidade: qtd, preco: precoTxt, valor: valorTxt, local: local as 'BAZAR' | 'DOACOES', controle: controle as 'ETIQUETADO' | 'CATEGORIA' });
    }
    if (erros.length) return { gravado: false, linhas: pl.linhas.length, erros: erros.slice(0, 500) };

    await prisma.$transaction(async (tx) => {
      const lote = await tx.loteEntrada.create({ data: { tipo: 'SALDO_INICIAL', recebidoEm: new Date(), recebidoPorId: u.id, observacao: 'Carga inicial da implantação' } });
      for (const l of validas) {
        const codigo = l.controle === 'ETIQUETADO' ? await proximoCodigo(tx) : null;
        const it = await tx.item.create({
          data: {
            loteId: lote.id, categoriaId: l.cat.id, tipoControle: l.controle, codigoBarras: codigo, descricao: l.descricao || `${l.cat.nome} (saldo inicial)`,
            valorAtribuido: l.valor, precoVenda: l.controle === 'ETIQUETADO' ? l.preco : null, quantidadeInicial: l.quantidade, criadoPorId: u.id,
          },
        });
        await tx.movimentacao.create({ data: { itemId: it.id, tipo: 'ENTRADA', localDestinoId: LOCAL_ID[l.local], quantidade: l.quantidade, usuarioId: u.id, motivo: 'Saldo inicial' } });
      }
      await tx.loteEntrada.update({ where: { id: lote.id }, data: { status: 'TRIADO' } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CARGA_INICIAL', 'lote_entrada', lote.id, undefined, { linhas: validas.length });
    }, { timeout: 120_000 });
    return { gravado: true, linhas: pl.linhas.length, erros: [] };
  });
}
