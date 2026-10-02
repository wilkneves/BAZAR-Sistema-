/**
 * FIN — contas a pagar, contas a receber (fiado), recebimentos e estornos, extrato e resumo
 * (RF-FIN-01..08, RN-19, RN-25, RN-27, RN-32). Contrato: front-end src/api/modules/financeiro.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db } from '../../lib/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../lib/errors.js';
import { page, parse, skipTake, zData, zIdParam, zMoney, zMotivo, zPage, zPeriodo, zTexto, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { fromCents, money, toCents } from '../../lib/money.js';
import { fromDbDate, inicioDoDia, fimDoDiaExclusivo, toDbDate } from '../../lib/dates.js';
import { exigirUsuario } from '../../plugins/auth.js';
import { caixaAbertoDoOperador, registrarSangria, FORMAS, type Forma } from '../cxa/caixa.service.js';
import { obterClienteAtivo } from '../cad/clientes.routes.js';

const zValor = zMoney.refine((v) => toCents(v) > 0, 'valor maior que zero');

// ---------------- DTOs ----------------
const cpInclude = { categoriaDespesa: { select: { nome: true } } } as const;
type CpRow = Prisma.ContaPagarGetPayload<{ include: typeof cpInclude }>;
const contaPagarDto = (c: CpRow) => ({
  id: c.id, descricao: c.descricao, favorecido: c.favorecido ?? undefined,
  categoriaDespesaId: c.categoriaDespesaId ?? '', categoriaDespesaNome: c.categoriaDespesa?.nome ?? '',
  valor: money(c.valor), vencimento: fromDbDate(c.vencimento), status: c.status,
  pagaEm: c.pagoEm?.toISOString(), saiuDoCaixa: c.status === 'PAGA' ? !!c.caixaLancamentoId : undefined,
  loteId: c.loteId ?? undefined,
});

const crInclude = { cliente: { select: { nome: true } }, venda: { select: { numero: true } }, recebimentos: { where: { estornadoEm: null }, select: { valor: true } } } as const;
type CrRow = Prisma.ContaReceberGetPayload<{ include: typeof crInclude }>;
const contaReceberDto = (c: CrRow) => {
  const pago = c.recebimentos.reduce((s, r) => s + toCents(r.valor), 0);
  return {
    id: c.id, clienteId: c.clienteId, clienteNome: c.cliente.nome, vendaNumero: c.venda?.numero, descricao: c.descricao,
    valor: money(c.valor), saldo: c.status === 'CANCELADA' ? '0.00' : fromCents(toCents(c.valor) - pago),
    vencimento: fromDbDate(c.vencimento), status: c.status,
  };
};
type RecRow = { id: string; contaReceberId: string; valor: { toFixed(n: number): string }; recebidoEm: Date; sessaoId: string | null; estornadoEm: Date | null; forma: string };
const recebimentoDto = (r: RecRow) => ({
  id: r.id, contaReceberId: r.contaReceberId, valor: money(r.valor), recebidoEm: r.recebidoEm.toISOString(),
  caixaId: r.sessaoId ?? undefined, estornado: !!r.estornadoEm, forma: r.forma,
});

async function obterContaPagar(db: Db, id: string) {
  const c = await db.contaPagar.findUnique({ where: { id }, include: cpInclude });
  if (!c) naoEncontrado('Conta');
  return c!;
}

export async function rotasFinanceiro(app: FastifyInstance) {
  // ================= contas a pagar =================
  app.get('/contas-pagar', { config: { acesso: ['contas_pagar.gerenciar'] } }, async (req) => {
    const q = parse(zPage.merge(zPeriodo).extend({ status: z.enum(['ABERTA', 'PAGA', 'CANCELADA']).optional() }), req.query);
    const where: Prisma.ContaPagarWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.de || q.ate ? { vencimento: { ...(q.de ? { gte: toDbDate(q.de) } : {}), ...(q.ate ? { lte: toDbDate(q.ate) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.contaPagar.findMany({ where, include: cpInclude, orderBy: [{ vencimento: 'asc' }, { criadaEm: 'asc' }], ...skipTake(q) }),
      prisma.contaPagar.count({ where }),
    ]);
    return page(rows.map(contaPagarDto), q, total);
  });

  app.post('/contas-pagar', { config: { acesso: ['contas_pagar.gerenciar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({
      id: zUuid, descricao: zTexto(200), favorecido: z.string().trim().max(120).optional(),
      categoriaDespesaId: zUuid.optional().or(z.literal('').transform(() => undefined)), valor: zValor, vencimento: zData,
    }), req.body);
    const ja = await prisma.contaPagar.findUnique({ where: { id: b.id }, include: cpInclude });
    if (ja) return reply.code(200).send(contaPagarDto(ja));
    if (b.categoriaDespesaId && !(await prisma.categoriaDespesa.findFirst({ where: { id: b.categoriaDespesaId, ativa: true } }))) {
      throw new AppError(400, 'Categoria de despesa inexistente ou inativa', 'VALIDACAO');
    }
    const c = await prisma.$transaction(async (tx) => {
      const n = await tx.contaPagar.create({
        data: { id: b.id, descricao: b.descricao, favorecido: b.favorecido ?? null, categoriaDespesaId: b.categoriaDespesaId ?? null, valor: b.valor, vencimento: toDbDate(b.vencimento), criadaPorId: u.id },
        include: cpInclude,
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CONTA_PAGAR_CRIADA', 'conta_pagar', n.id, undefined, { valor: b.valor, vencimento: b.vencimento });
      return n;
    });
    return reply.code(201).send(contaPagarDto(c));
  });

  app.patch('/contas-pagar/:id', { config: { acesso: ['contas_pagar.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ descricao: zTexto(200).optional(), favorecido: z.string().trim().max(120).optional(), valor: zValor.optional(), vencimento: zData.optional(), categoriaDespesaId: zUuid.optional() }).strict(), req.body);
    const atual = await obterContaPagar(prisma, id);
    if (atual.status !== 'ABERTA') conflito('CONTA_NAO_ABERTA', 'Só conta em aberto pode ser editada'); // RN-32
    if (b.valor && atual.loteId && b.valor !== money(atual.valor)) conflito('ORIGEM_IMUTAVEL', 'Conta do lote de compra não muda de valor');
    const c = await prisma.$transaction(async (tx) => {
      const n = await tx.contaPagar.update({
        where: { id },
        data: { ...(b.descricao ? { descricao: b.descricao } : {}), ...(b.favorecido !== undefined ? { favorecido: b.favorecido } : {}),
          ...(b.valor ? { valor: b.valor } : {}), ...(b.vencimento ? { vencimento: toDbDate(b.vencimento) } : {}),
          ...(b.categoriaDespesaId ? { categoriaDespesaId: b.categoriaDespesaId } : {}) },
        include: cpInclude,
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CONTA_PAGAR_ALTERADA', 'conta_pagar', id,
        { valor: money(atual.valor), vencimento: fromDbDate(atual.vencimento) }, { valor: money(n.valor), vencimento: fromDbDate(n.vencimento) });
      return n;
    });
    return contaPagarDto(c);
  });

  app.post('/contas-pagar/:id/pagar', { config: { acesso: ['contas_pagar.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ saiuDoCaixa: z.boolean().default(false), formaPagamento: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']).optional() }), req.body ?? {});
    await prisma.$transaction(async (tx) => {
      const c = await obterContaPagar(tx, id);
      if (c.status !== 'ABERTA') conflito('CONTA_NAO_ABERTA', 'Conta não está aberta');
      let lancamentoId: string | null = null;
      if (b.saiuDoCaixa) {
        // RF-FIN-02 / RN-19: pago com dinheiro do caixa => sangria automática ligada à conta
        const cx = await caixaAbertoDoOperador(tx, u.id);
        if (!cx) conflito('SEM_CAIXA_ABERTO', 'Você não tem caixa aberto para registrar a sangria');
        await tx.$queryRaw`SELECT id FROM caixa_sessao WHERE id = ${cx!.id}::uuid FOR UPDATE`;
        lancamentoId = (await registrarSangria(tx, cx!.id, u.id, toCents(c.valor), `Pagamento: ${c.descricao}`)).id;
      }
      await tx.contaPagar.update({
        where: { id },
        data: { status: 'PAGA', pagoEm: new Date(), valorPago: c.valor, formaPagamento: b.saiuDoCaixa ? 'DINHEIRO' : b.formaPagamento ?? 'PIX', caixaLancamentoId: lancamentoId },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CONTA_PAGA', 'conta_pagar', id, { status: 'ABERTA' }, { status: 'PAGA', saiuDoCaixa: b.saiuDoCaixa });
    });
    return contaPagarDto(await obterContaPagar(prisma, id));
  });

  app.post('/contas-pagar/:id/cancelar', { config: { acesso: ['contas_pagar.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const c = await obterContaPagar(tx, id);
      if (c.status === 'CANCELADA') conflito('CONTA_NAO_ABERTA', 'Conta já cancelada');
      let suprimentoId: string | undefined;
      if (c.status === 'PAGA' && c.caixaLancamentoId) {
        // RN-32: o dinheiro que saiu do caixa volta como suprimento no caixa aberto
        const cx = await caixaAbertoDoOperador(tx, u.id);
        if (!cx) conflito('SEM_CAIXA_ABERTO', 'O valor saiu do caixa: abra um caixa para registrar o suprimento');
        suprimentoId = (await tx.caixaLancamento.create({ data: { sessaoId: cx!.id, tipo: 'SUPRIMENTO', valor: c.valorPago ?? c.valor, motivo: `Estorno do pagamento: ${c.descricao}`.slice(0, 300), usuarioId: u.id } })).id;
      }
      await tx.contaPagar.update({ where: { id }, data: { status: 'CANCELADA', observacao: motivo } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CONTA_PAGAR_CANCELADA', 'conta_pagar', id, { status: c.status }, { status: 'CANCELADA', motivo, suprimentoId });
    });
    return contaPagarDto(await obterContaPagar(prisma, id));
  });

  // ================= contas a receber =================
  app.get('/contas-receber', { config: { acesso: ['contas_receber.receber'] } }, async (req) => {
    const q = parse(zPage.extend({ status: z.enum(['ABERTA', 'PARCIAL', 'QUITADA', 'CANCELADA']).optional(), clienteId: zUuid.optional() }), req.query);
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.clienteId ? { clienteId: q.clienteId } : {}) };
    const [rows, total] = await Promise.all([
      prisma.contaReceber.findMany({ where, include: crInclude, orderBy: [{ vencimento: 'asc' }, { criadaEm: 'asc' }], ...skipTake(q) }),
      prisma.contaReceber.count({ where }),
    ]);
    return page(rows.map(contaReceberDto), q, total);
  });

  app.post('/contas-receber', { config: { acesso: ['contas_receber.lancar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid, clienteId: zUuid, descricao: zTexto(200), valor: zValor, vencimento: zData }), req.body);
    const ja = await prisma.contaReceber.findUnique({ where: { id: b.id }, include: crInclude });
    if (ja) return reply.code(200).send(contaReceberDto(ja));
    if (!(await obterClienteAtivo(prisma, b.clienteId))) throw new AppError(400, 'Cliente inexistente ou inativo', 'VALIDACAO');
    const c = await prisma.$transaction(async (tx) => {
      const n = await tx.contaReceber.create({ data: { id: b.id, clienteId: b.clienteId, descricao: b.descricao, valor: b.valor, vencimento: toDbDate(b.vencimento), criadaPorId: u.id }, include: crInclude });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CONTA_RECEBER_LANCADA', 'conta_receber', n.id, undefined, { valor: b.valor, clienteId: b.clienteId });
      return n;
    });
    return reply.code(201).send(contaReceberDto(c));
  });

  app.post('/contas-receber/:id/recebimentos', { config: { acesso: ['contas_receber.receber'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({
      id: zUuid, valor: zValor, caixaId: zUuid.optional(),
      forma: z.enum(['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO']).default('DINHEIRO'),
      observacao: z.string().trim().max(300).optional(),
    }), req.body);
    const ja = await prisma.recebimento.findUnique({ where: { id: b.id } });
    if (ja) {
      if (ja.contaReceberId !== id) conflito('ID_EM_USO', 'Identificador já usado');
      return reply.code(200).send(recebimentoDto(ja));
    }
    const r = await prisma.$transaction(async (tx) => {
      const conta = await tx.contaReceber.findUnique({ where: { id }, include: crInclude });
      if (!conta) naoEncontrado('Conta');
      if (conta!.status === 'CANCELADA' || conta!.status === 'QUITADA') conflito('CONTA_NAO_ABERTA', 'Conta não aceita recebimento');
      if (toCents(b.valor) > toCents(contaReceberDto(conta!).saldo)) conflito('RECEBIMENTO_ACIMA_SALDO', 'Valor maior que o saldo da conta');
      if (b.caixaId) {
        // RN-25: no caixa, só no caixa ABERTO do próprio operador (anti-IDOR)
        const cx = await tx.caixaSessao.findUnique({ where: { id: b.caixaId } });
        if (!cx || cx.abertoPorId !== u.id) throw new AppError(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
        if (cx.status !== 'ABERTO') conflito('CAIXA_FECHADO', 'Caixa fechado');
      }
      const n = await tx.recebimento.create({
        data: { id: b.id, contaReceberId: id, valor: b.valor, forma: b.forma, sessaoId: b.caixaId ?? null, usuarioId: u.id, observacao: b.observacao ?? null },
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'RECEBIMENTO', 'conta_receber', id, undefined, { recebimentoId: n.id, valor: b.valor, noCaixa: !!b.caixaId });
      return n;
    });
    return reply.code(201).send(recebimentoDto(r));
  });

  app.post('/recebimentos/:id/estornar', { config: { acesso: ['recebimento.estornar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const r = await tx.recebimento.findUnique({ where: { id }, include: { sessao: { select: { status: true } } } });
      if (!r) naoEncontrado('Recebimento');
      if (r!.estornadoEm) conflito('ESTORNO_DUPLICADO', 'Recebimento já estornado');
      let sangriaId: string | undefined;
      // RN-27: estorno de dinheiro de caixa JÁ FECHADO sai como sangria do caixa aberto.
      // Caixa ainda aberto: o recebimento estornado já sai do valor esperado.
      if (r!.forma === 'DINHEIRO' && r!.sessao && r!.sessao.status === 'FECHADO') {
        const cx = await caixaAbertoDoOperador(tx, u.id);
        if (!cx) conflito('SEM_CAIXA_ABERTO', 'O dinheiro entrou num caixa já fechado: abra um caixa para registrar a sangria');
        sangriaId = (await registrarSangria(tx, cx!.id, u.id, toCents(r!.valor), 'Estorno de recebimento de fiado')).id;
      }
      await tx.recebimento.update({ where: { id }, data: { estornadoEm: new Date(), estornadoPorId: u.id, motivoEstorno: motivo } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'RECEBIMENTO_ESTORNADO', 'recebimento', id, undefined, { motivo, sangriaId });
    });
    return reply.code(204).send();
  });

  app.get('/clientes/:id/extrato', { config: { acesso: ['contas_receber.receber'] } }, async (req) => {
    const { id } = parse(zIdParam, req.params);
    const cl = await prisma.cliente.findUnique({ where: { id }, select: { id: true, nome: true } });
    if (!cl) naoEncontrado('Cliente');
    const contas = await prisma.contaReceber.findMany({ where: { clienteId: id }, include: crInclude, orderBy: { vencimento: 'asc' } });
    const recebimentos = await prisma.recebimento.findMany({ where: { contaReceberId: { in: contas.map((c) => c.id) } }, orderBy: { recebidoEm: 'asc' } });
    const dtos = contas.map(contaReceberDto);
    return {
      cliente: cl, contas: dtos, recebimentos: recebimentos.map(recebimentoDto),
      saldoDevedor: fromCents(dtos.filter((c) => c.status !== 'CANCELADA').reduce((s, c) => s + toCents(c.saldo), 0)),
    };
  });

  // ================= resumo (RF-FIN-07) =================
  app.get('/financeiro/resumo', { config: { acesso: ['relatorios.consultar'] } }, async (req) => {
    const q = parse(z.object({ de: zData, ate: zData }).refine((x) => x.de <= x.ate, 'período inválido'), req.query);
    const ini = inicioDoDia(q.de), fim = fimDoDiaExclusivo(q.ate);
    const porForma = await prisma.$queryRaw<{ forma: Forma; total: string }[]>`
      SELECT p.forma::text AS forma, sum(p.valor)::text AS total FROM venda_pagamento p JOIN venda v ON v.id = p.venda_id
      WHERE v.status = 'FINALIZADA' AND v.ocorrida_em >= ${ini} AND v.ocorrida_em < ${fim} GROUP BY p.forma`;
    const receb = await prisma.recebimento.aggregate({ where: { estornadoEm: null, recebidoEm: { gte: ini, lt: fim } }, _sum: { valor: true } });
    const saidas = await prisma.contaPagar.aggregate({ where: { status: 'PAGA', pagoEm: { gte: ini, lt: fim } }, _sum: { valorPago: true } });
    const t = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<Forma, number>;
    for (const r of porForma) t[r.forma] = toCents(Number(r.total).toFixed(2));
    const recebidos = toCents(receb._sum.valor ?? null);
    const sai = toCents(saidas._sum.valorPago ?? null);
    // Fiado não é entrada de caixa: entra quando é recebido
    const entradas = t.DINHEIRO + t.PIX + t.CARTAO_DEBITO + t.CARTAO_CREDITO + recebidos;
    return {
      de: q.de, ate: q.ate,
      entradasPorForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(t[f])])),
      recebimentosFiado: fromCents(recebidos), saidas: fromCents(sai), resultado: fromCents(entradas - sai),
    };
  });
}
