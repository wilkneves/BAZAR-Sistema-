/**
 * ENT/TRI — lotes de entrada, anexo do documento, triagem (itens aprovados e descartes),
 * encerramento/reabertura, reversão de descarte e etiquetas (RF-ENT-01..03, RF-TRI-01..05).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { prisma, type Db, type Tx } from '../../lib/prisma.js';
import { AppError, conflito, naoEncontrado, proibido } from '../../lib/errors.js';
import { page, parse, skipTake, zData, zIdParam, zMoney, zMotivo, zPage, zPeriodo, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { money, moneyOpt, toCents, fromCents } from '../../lib/money.js';
import { localDate, periodo, toDbDate } from '../../lib/dates.js';
import { paramNum } from '../../lib/parametros.js';
import { env } from '../../config/env.js';
import { exigirUsuario, tem } from '../../plugins/auth.js';

export const LOCAL_ID = { BAZAR: 1, DOACOES: 2 } as const;
export const LOCAL_COD: Record<number, 'BAZAR' | 'DOACOES'> = { 1: 'BAZAR', 2: 'DOACOES' };

const TIPOS_ANEXO: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };
const MIME_POR_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' };
const RE_CHAVE_ARQUIVO = /^lotes\/[0-9a-f-]{36}\.(pdf|png|jpg)$/;

// ---------------- DTO ----------------
const loteInclude = { parceiro: { select: { nome: true } }, campanha: { select: { nome: true } }, contaPagar: { select: { status: true } } } as const;
type LoteRow = Awaited<ReturnType<typeof prisma.loteEntrada.findFirstOrThrow<{ include: typeof loteInclude }>>>;
interface Resumo { aprovados: number; descartados: number; valor: number }

async function resumos(db: Db, ids: string[]): Promise<Map<string, Resumo>> {
  const m = new Map<string, Resumo>(ids.map((id) => [id, { aprovados: 0, descartados: 0, valor: 0 }]));
  if (!ids.length) return m;
  const itens = await db.item.groupBy({ by: ['loteId'], where: { loteId: { in: ids } }, _sum: { quantidadeInicial: true } });
  const valores = await db.$queryRaw<{ lote_id: string; v: string }[]>`
    SELECT lote_id::text, coalesce(sum(quantidade_inicial * valor_atribuido), 0)::text AS v FROM item WHERE lote_id = ANY(${ids}::uuid[]) GROUP BY lote_id`;
  const desc = await db.descarte.groupBy({ by: ['loteId'], where: { loteId: { in: ids }, revertidoEm: null }, _count: { _all: true } });
  for (const i of itens) m.get(i.loteId)!.aprovados = i._sum.quantidadeInicial ?? 0;
  for (const v of valores) m.get(v.lote_id)!.valor = toCents(Number(v.v).toFixed(2));
  for (const d of desc) m.get(d.loteId)!.descartados = d._count._all;
  return m;
}

function loteDto(l: LoteRow, r: Resumo) {
  return {
    id: l.id, numero: l.numero, tipo: l.tipo,
    parceiroId: l.parceiroId ?? undefined, parceiroNome: l.parceiro?.nome,
    campanhaId: l.campanhaId ?? undefined, campanhaNome: l.campanha?.nome,
    documento: l.documentoNumero ?? undefined, temAnexo: !!l.documentoArquivo,
    recebidoEm: l.recebidoEm.toISOString(),
    status: l.status === 'TRIADO' ? 'TRIADO' : 'ABERTO',
    aprovados: r.aprovados, descartados: r.descartados, valorAtribuido: fromCents(r.valor),
    valorCompra: moneyOpt(l.valorCompra),
    pago: l.contaPagar ? l.contaPagar.status === 'PAGA' : undefined,
  };
}

export async function obterLoteDto(db: Db, id: string) {
  const l = await db.loteEntrada.findUnique({ where: { id }, include: loteInclude });
  if (!l) naoEncontrado('Lote');
  return loteDto(l!, (await resumos(db, [id])).get(id)!);
}

type ItemRow = { id: string; codigoBarras: string | null; descricao: string | null; quantidadeInicial: number; precoVenda: { toFixed(n: number): string } | null; valorAtribuido: { toFixed(n: number): string }; categoria: { nome: string }; movimentacoes: { localDestinoId: number | null }[] };
const itemTriagemDto = (i: ItemRow) => ({
  id: i.id, codigo: i.codigoBarras ?? undefined, descricao: i.descricao ?? i.categoria.nome, categoriaNome: i.categoria.nome,
  quantidade: i.quantidadeInicial, preco: money(i.precoVenda ?? i.valorAtribuido),
  localDestino: LOCAL_COD[i.movimentacoes[0]?.localDestinoId ?? 1] ?? 'BAZAR',
});
const itemTriagemInclude = { categoria: { select: { nome: true } }, movimentacoes: { where: { tipo: 'ENTRADA' as const }, select: { localDestinoId: true }, take: 1 } };

type DescRow = { id: string; registradoEm: Date; revertidoEm: Date | null; categoria: { nome: string }; motivo: { nome: string } };
const descarteDto = (d: DescRow) => ({ id: d.id, categoriaNome: d.categoria.nome, motivoNome: d.motivo.nome, registradoEm: d.registradoEm.toISOString(), revertido: !!d.revertidoEm });
const descInclude = { categoria: { select: { nome: true } }, motivo: { select: { nome: true } } } as const;

/** Gera o próximo código de barras (BZ + 6 dígitos). */
export async function proximoCodigo(tx: Tx): Promise<string> {
  const [r] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_codigo_barras') AS n`;
  return `BZ${String(r!.n).padStart(6, '0')}`;
}

// ---------------- esquemas ----------------
const zNovoLote = z.object({
  id: zUuid,
  tipo: z.enum(['DOACAO', 'COMPRA', 'SALDO_INICIAL']),
  parceiroId: zUuid.optional().or(z.literal('').transform(() => undefined)),
  campanhaId: zUuid.optional().or(z.literal('').transform(() => undefined)),
  documento: z.string().trim().max(60).optional(),
  documentoTipo: z.enum(['NOTA_FISCAL', 'TERMO_DOACAO', 'RECIBO', 'OUTRO']).optional(),
  observacao: z.string().trim().max(500).optional(),
  valorCompra: zMoney.optional(),
  pago: z.boolean().optional(),
  formaPagamento: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']).optional(),
  vencimento: zData.optional(),
});
const zItem = z.object({
  id: zUuid,
  categoriaId: zUuid,
  controle: z.enum(['ETIQUETADO', 'CATEGORIA']),
  quantidade: z.number().int().min(1).max(10_000),
  preco: zMoney.refine((v) => toCents(v) > 0, 'preço deve ser maior que zero'),
  valorAtribuido: zMoney.optional(),
  descricao: z.string().trim().max(120).optional(),
  localDestino: z.enum(['BAZAR', 'DOACOES']),
  descarteOrigemId: zUuid.optional(),
});
const zDescarte = z.object({ id: zUuid, categoriaId: zUuid, motivoId: zUuid, observacao: z.string().trim().max(500).optional(), descricao: z.string().trim().max(120).optional() });

export async function rotasLotes(app: FastifyInstance) {
  app.get('/lotes', { config: { acesso: ['entrada.registrar'] } }, async (req) => {
    const q = parse(zPage.merge(zPeriodo).extend({ parceiroId: zUuid.optional(), campanhaId: zUuid.optional(), status: z.enum(['ABERTO', 'TRIADO']).optional() }), req.query);
    const where = {
      ...(q.parceiroId ? { parceiroId: q.parceiroId } : {}),
      ...(q.campanhaId ? { campanhaId: q.campanhaId } : {}),
      ...(q.status === 'TRIADO' ? { status: 'TRIADO' as const } : q.status === 'ABERTO' ? { status: { in: ['AGUARDANDO_TRIAGEM' as const, 'EM_TRIAGEM' as const] } } : {}),
      ...(periodo(q.de, q.ate) ? { recebidoEm: periodo(q.de, q.ate) } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.loteEntrada.findMany({ where, include: loteInclude, orderBy: { numero: 'desc' }, ...skipTake(q) }),
      prisma.loteEntrada.count({ where }),
    ]);
    const rs = await resumos(prisma, rows.map((l) => l.id));
    return page(rows.map((l) => loteDto(l, rs.get(l.id)!)), q, total);
  });

  app.get('/lotes/:id', { config: { acesso: ['entrada.registrar'] } }, async (req) => {
    const { id } = parse(zIdParam, req.params);
    const base = await obterLoteDto(prisma, id);
    const [itens, descartes] = await Promise.all([
      prisma.item.findMany({ where: { loteId: id }, include: itemTriagemInclude, orderBy: { criadoEm: 'asc' } }),
      prisma.descarte.findMany({ where: { loteId: id }, include: descInclude, orderBy: { registradoEm: 'asc' } }),
    ]);
    return { ...base, itens: itens.map(itemTriagemDto), descartes: descartes.map(descarteDto) };
  });

  app.post('/lotes', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zNovoLote, req.body);
    const existente = await prisma.loteEntrada.findUnique({ where: { id: b.id }, select: { id: true } });
    if (existente) return reply.code(200).send(await obterLoteDto(prisma, b.id)); // reenvio idempotente

    if (b.tipo === 'SALDO_INICIAL' && !tem(u, 'estoque.ajustar')) proibido('Lote de saldo inicial é criado pela carga inicial');
    if (b.tipo === 'DOACAO' && !b.parceiroId && !b.campanhaId) throw new AppError(400, 'Informe parceiro e/ou campanha', 'ORIGEM_OBRIGATORIA'); // RN-04
    if (b.tipo === 'COMPRA') {
      if (!tem(u, 'contas_pagar.gerenciar')) proibido('Registrar compra exige permissão de contas a pagar');
      if (!b.parceiroId) throw new AppError(400, 'Compra exige fornecedor', 'FORNECEDOR_OBRIGATORIO'); // RN-05
      if (!b.valorCompra || toCents(b.valorCompra) <= 0) throw new AppError(400, 'Compra exige valor pago', 'VALOR_OBRIGATORIO');
    }
    if (b.parceiroId && !(await prisma.parceiro.findFirst({ where: { id: b.parceiroId, ativo: true } }))) throw new AppError(400, 'Parceiro inexistente ou inativo', 'VALIDACAO');
    if (b.campanhaId && !(await prisma.campanha.findFirst({ where: { id: b.campanhaId, ativa: true } }))) throw new AppError(400, 'Campanha inexistente ou inativa', 'VALIDACAO');

    await prisma.$transaction(async (tx) => {
      const agora = new Date();
      const lote = await tx.loteEntrada.create({
        data: {
          id: b.id, tipo: b.tipo, parceiroId: b.parceiroId ?? null, campanhaId: b.campanhaId ?? null,
          recebidoEm: agora, recebidoPorId: u.id, documentoNumero: b.documento || null, documentoTipo: b.documentoTipo ?? null,
          observacao: b.observacao ?? null, valorCompra: b.tipo === 'COMPRA' ? b.valorCompra! : null,
        },
      });
      if (b.tipo === 'COMPRA') {
        // RN-05: a conta a pagar do fornecedor nasce na mesma transação, ligada ao lote
        await tx.contaPagar.create({
          data: {
            descricao: `Compra — lote ${lote.numero}`, valor: b.valorCompra!, loteId: lote.id, criadaPorId: u.id,
            vencimento: toDbDate(b.vencimento ?? localDate()),
            ...(b.pago ? { status: 'PAGA' as const, pagoEm: agora, valorPago: b.valorCompra!, formaPagamento: b.formaPagamento ?? 'PIX' } : {}),
          },
        });
      }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_CRIADO', 'lote_entrada', lote.id, undefined, { tipo: b.tipo, parceiroId: b.parceiroId, campanhaId: b.campanhaId });
    });
    return reply.code(201).send(await obterLoteDto(prisma, b.id));
  });

  // ---------------- anexo (RF-ENT-02, RNF-18) ----------------
  app.post('/lotes/:id/documento', { config: { acesso: ['entrada.registrar'], rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const lote = await prisma.loteEntrada.findUnique({ where: { id }, select: { id: true } });
    if (!lote) naoEncontrado('Lote');
    const maxMb = await paramNum(prisma, 'anexo.tamanho_max_mb', 5);
    const arquivo = await req.file();
    if (!arquivo || arquivo.fieldname !== 'arquivo') throw new AppError(400, 'Arquivo obrigatório (campo "arquivo")', 'ARQUIVO_OBRIGATORIO');
    const buf = await arquivo.toBuffer();
    if (buf.length === 0) throw new AppError(400, 'Arquivo vazio', 'ARQUIVO_OBRIGATORIO');
    if (buf.length > maxMb * 1024 * 1024) throw new AppError(413, `Arquivo maior que ${maxMb} MB`, 'ANEXO_GRANDE');
    // Tipo REAL pelos magic bytes — ignora extensão e Content-Type enviados
    const tipo = await fileTypeFromBuffer(buf);
    const ext = tipo ? TIPOS_ANEXO[tipo.mime] : undefined;
    if (!ext) throw new AppError(415, 'Tipo de arquivo não aceito (PDF, PNG ou JPEG)', 'TIPO_INVALIDO');
    const chave = `lotes/${randomUUID()}.${ext}`; // nome único, nunca o nome do usuário
    const destino = path.resolve(env.UPLOAD_DIR, chave);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, buf, { mode: 0o600, flag: 'wx' });
    await prisma.$transaction(async (tx) => {
      await tx.loteEntrada.update({ where: { id }, data: { documentoArquivo: chave } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_DOCUMENTO_ANEXADO', 'lote_entrada', id, undefined, { tipo: tipo!.mime, bytes: buf.length });
    });
    return reply.code(204).send();
  });

  app.get('/lotes/:id/documento', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const { id } = parse(zIdParam, req.params);
    const l = await prisma.loteEntrada.findUnique({ where: { id }, select: { numero: true, documentoArquivo: true } });
    if (!l || !l.documentoArquivo) naoEncontrado('Documento');
    const chave = l!.documentoArquivo!;
    if (!RE_CHAVE_ARQUIVO.test(chave)) naoEncontrado('Documento'); // defesa contra path traversal
    const ext = chave.split('.').pop()!;
    const buf = await readFile(path.resolve(env.UPLOAD_DIR, chave)).catch(() => null);
    if (!buf) naoEncontrado('Documento');
    return reply
      .header('Content-Type', MIME_POR_EXT[ext]!)
      .header('Content-Disposition', `attachment; filename="lote-${l!.numero}.${ext}"`)
      .send(buf);
  });

  // ---------------- triagem ----------------
  app.post('/lotes/:id/itens', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id: loteId } = parse(zIdParam, req.params);
    const b = parse(zItem, req.body);
    const ja = await prisma.item.findUnique({ where: { id: b.id }, include: itemTriagemInclude });
    if (ja) {
      if ((await prisma.item.findUnique({ where: { id: b.id }, select: { loteId: true } }))!.loteId !== loteId) conflito('ID_EM_USO', 'Identificador já usado em outro lote');
      return reply.code(200).send(itemTriagemDto(ja));
    }
    if (b.controle === 'ETIQUETADO' && b.quantidade !== 1) throw new AppError(400, 'Peça etiquetada tem quantidade 1', 'ETIQUETADO_QTD'); // RN-08
    const lote = await prisma.loteEntrada.findUnique({ where: { id: loteId }, select: { numero: true, status: true, tipo: true } });
    if (!lote) naoEncontrado('Lote');
    if (lote!.status === 'TRIADO' && !b.descarteOrigemId) conflito('LOTE_TRIADO', 'Lote já triado não aceita registros');
    const cat = await prisma.categoria.findFirst({ where: { id: b.categoriaId, ativa: true } });
    if (!cat) throw new AppError(400, 'Categoria inexistente ou inativa', 'VALIDACAO');

    const item = await prisma.$transaction(async (tx) => {
      const codigo = b.controle === 'ETIQUETADO' ? await proximoCodigo(tx) : null;
      const novo = await tx.item.create({
        data: {
          id: b.id, loteId, categoriaId: b.categoriaId, tipoControle: b.controle, codigoBarras: codigo,
          descricao: b.descricao || `${cat!.nome} (lote ${lote!.numero})`,
          valorAtribuido: b.valorAtribuido ?? b.preco, // RN-33: sugerido pelo preço, editável
          precoVenda: b.controle === 'ETIQUETADO' ? b.preco : null,
          quantidadeInicial: b.quantidade, descarteOrigemId: b.descarteOrigemId ?? null, criadoPorId: u.id,
        },
      });
      await tx.movimentacao.create({
        data: { itemId: novo.id, tipo: 'ENTRADA', localDestinoId: LOCAL_ID[b.localDestino], quantidade: b.quantidade, usuarioId: u.id, motivo: `Triagem do lote ${lote!.numero}` },
      });
      return tx.item.findUniqueOrThrow({ where: { id: novo.id }, include: itemTriagemInclude });
    });
    return reply.code(201).send(itemTriagemDto(item));
  });

  app.post('/lotes/:id/descartes', { config: { acesso: ['entrada.registrar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id: loteId } = parse(zIdParam, req.params);
    const b = parse(zDescarte, req.body);
    const ja = await prisma.descarte.findUnique({ where: { id: b.id }, include: descInclude });
    if (ja) return reply.code(200).send(descarteDto(ja));
    const lote = await prisma.loteEntrada.findUnique({ where: { id: loteId }, select: { status: true } });
    if (!lote) naoEncontrado('Lote');
    if (lote!.status === 'TRIADO') conflito('LOTE_TRIADO', 'Lote já triado não aceita registros');
    if (!(await prisma.categoria.findUnique({ where: { id: b.categoriaId } }))) throw new AppError(400, 'Categoria inexistente', 'VALIDACAO');
    if (!(await prisma.motivoDescarte.findFirst({ where: { id: b.motivoId, ativo: true } }))) throw new AppError(400, 'Motivo inexistente ou inativo', 'VALIDACAO');
    // RN-01: descarte NUNCA gera movimentação de estoque
    const d = await prisma.descarte.create({
      data: { id: b.id, loteId, categoriaId: b.categoriaId, motivoId: b.motivoId, observacao: b.observacao ?? null, descricao: b.descricao ?? null, registradoPorId: u.id },
      include: descInclude,
    });
    return reply.code(201).send(descarteDto(d));
  });

  app.post('/lotes/:id/encerrar', { config: { acesso: ['entrada.registrar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    await prisma.$transaction(async (tx) => {
      const l = await tx.loteEntrada.findUnique({ where: { id }, select: { status: true } });
      if (!l) naoEncontrado('Lote');
      if (l!.status === 'TRIADO') conflito('LOTE_TRIADO', 'Lote já está triado');
      await tx.loteEntrada.update({ where: { id }, data: { status: 'TRIADO' } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_ENCERRADO', 'lote_entrada', id, { status: l!.status }, { status: 'TRIADO' });
    });
    return obterLoteDto(prisma, id);
  });

  app.post('/lotes/:id/reabrir', { config: { acesso: ['triagem.reabrir'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const l = await tx.loteEntrada.findUnique({ where: { id }, select: { status: true } });
      if (!l) naoEncontrado('Lote');
      if (l!.status !== 'TRIADO') conflito('LOTE_ABERTO', 'Lote não está triado');
      await tx.loteEntrada.update({ where: { id }, data: { status: 'EM_TRIAGEM' } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'LOTE_REABERTO', 'lote_entrada', id, { status: 'TRIADO' }, { status: 'EM_TRIAGEM', motivo });
    });
    return obterLoteDto(prisma, id);
  });

  app.post('/descartes/:id/reverter', { config: { acesso: ['triagem.reabrir'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const d = await tx.descarte.findUnique({ where: { id } });
      if (!d) naoEncontrado('Descarte');
      if (d!.revertidoEm) conflito('DESCARTE_REVERTIDO', 'Descarte já revertido');
      await tx.descarte.update({ where: { id }, data: { revertidoEm: new Date(), revertidoPorId: u.id } });
      // RN-20: o item só volta por nova triagem — o lote fica aberto para registrá-la
      await tx.loteEntrada.updateMany({ where: { id: d!.loteId, status: 'TRIADO' }, data: { status: 'EM_TRIAGEM' } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'DESCARTE_REVERTIDO', 'descarte', id, undefined, { loteId: d!.loteId, motivo });
    });
    return reply.code(204).send();
  });

  app.get('/etiquetas', { config: { acesso: ['entrada.registrar'] } }, async (req) => {
    const q = parse(z.object({ itens: z.string().max(200 * 37) }), req.query);
    const ids = q.itens.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 200 || !ids.every((x) => zUuid.safeParse(x).success)) throw new AppError(400, 'Lista de itens inválida (até 200 ids)', 'VALIDACAO');
    const itens = await prisma.item.findMany({ where: { id: { in: ids }, tipoControle: 'ETIQUETADO' }, orderBy: { codigoBarras: 'asc' } });
    return itens.map((i) => ({ itemId: i.id, codigo: i.codigoBarras!, descricao: i.descricao ?? '', preco: money(i.precoVenda) }));
  });
}

