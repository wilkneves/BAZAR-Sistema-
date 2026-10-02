/** CXA — terminais e sessões de caixa (RF-CXA-01..05, RN-12, RN-13, RN-19). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Db } from '../../lib/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../lib/errors.js';
import { page, parse, skipTake, zBoolQuery, zIdParam, zMoney, zPage, zPeriodo, zTexto, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { fromCents, toCents } from '../../lib/money.js';
import { periodo } from '../../lib/dates.js';
import { exigirUsuario, tem, type UsuarioCtx } from '../../plugins/auth.js';
import { caixaDto, calcularPrevia, registrarSangria } from './caixa.service.js';

const incTerminal = { terminal: { select: { nome: true } } } as const;

/** Caixa do próprio operador e aberto (anti-IDOR: caixaId da URL é conferido contra o usuário). */
async function meuCaixaAberto(db: Db, u: UsuarioCtx, id: string) {
  const c = await db.caixaSessao.findUnique({ where: { id }, include: incTerminal });
  if (!c) naoEncontrado('Caixa');
  if (c!.abertoPorId !== u.id) throw new AppError(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
  if (c!.status !== 'ABERTO') conflito('CAIXA_FECHADO', 'Caixa fechado');
  return c!;
}

export async function rotasCaixa(app: FastifyInstance) {
  // ---------------- terminais ----------------
  // caixa.operar lê os ativos para escolher o terminal na abertura (divergência 1 do README do front)
  app.get('/terminais', { config: { acesso: ['terminais.gerenciar', 'caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(z.object({ ativo: zBoolQuery.optional() }), req.query);
    const ativo = tem(u, 'terminais.gerenciar') ? q.ativo : true;
    const ts = await prisma.terminal.findMany({ where: ativo !== undefined ? { ativo } : {}, orderBy: { nome: 'asc' } });
    return ts.map((t) => ({ id: t.id, nome: t.nome, ativo: t.ativo }));
  });

  app.post('/terminais', { config: { acesso: ['terminais.gerenciar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid.optional(), nome: zTexto(60) }), req.body);
    if (b.id) {
      const ja = await prisma.terminal.findUnique({ where: { id: b.id } });
      if (ja) return reply.code(200).send({ id: ja.id, nome: ja.nome, ativo: ja.ativo });
    }
    const t = await prisma.$transaction(async (tx) => {
      const n = await tx.terminal.create({ data: { ...(b.id ? { id: b.id } : {}), nome: b.nome } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TERMINAL_CRIADO', 'terminal', n.id);
      return n;
    });
    return reply.code(201).send({ id: t.id, nome: t.nome, ativo: t.ativo });
  });

  app.patch('/terminais/:id', { config: { acesso: ['terminais.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ nome: zTexto(60).optional(), ativo: z.boolean().optional() }).strict(), req.body);
    const antes = await prisma.terminal.findUnique({ where: { id } });
    if (!antes) naoEncontrado('Terminal');
    const t = await prisma.$transaction(async (tx) => {
      const n = await tx.terminal.update({ where: { id }, data: b });
      if (b.ativo === false) {
        // RNF-19: sessões ligadas ao terminal são revogadas; o PDV apaga os dados locais ao receber TERMINAL_DESATIVADO
        await tx.sessaoUsuario.updateMany({ where: { terminalId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
      }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TERMINAL_ALTERADO', 'terminal', id, { ativo: antes!.ativo }, { ativo: n.ativo });
      return n;
    });
    return { id: t.id, nome: t.nome, ativo: t.ativo };
  });

  // ---------------- sessão de caixa ----------------
  app.get('/caixas/atual', { config: { acesso: ['caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const c = await prisma.caixaSessao.findFirst({ where: { abertoPorId: u.id, status: 'ABERTO' }, include: { terminal: true } });
    if (!c) naoEncontrado('Caixa aberto');
    if (!c!.terminal.ativo) conflito('TERMINAL_DESATIVADO', 'Este terminal foi desativado pelo Administrador');
    return caixaDto(c!, u.nome);
  });

  app.post('/caixas', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid, terminalId: zUuid, fundoTroco: zMoney }), req.body);
    const ja = await prisma.caixaSessao.findUnique({ where: { id: b.id }, include: incTerminal });
    if (ja) {
      if (ja.abertoPorId !== u.id) conflito('ID_EM_USO', 'Identificador já usado');
      return reply.code(200).send(caixaDto(ja, u.nome));
    }
    const t = await prisma.terminal.findFirst({ where: { id: b.terminalId, ativo: true } });
    if (!t) throw new AppError(400, 'Terminal inexistente ou desativado', 'VALIDACAO');
    // RN-13: um caixa aberto por terminal e por operador (índices únicos parciais garantem na corrida)
    const aberto = await prisma.caixaSessao.findFirst({ where: { status: 'ABERTO', OR: [{ terminalId: t.id }, { abertoPorId: u.id }] } });
    if (aberto) conflito('CAIXA_JA_ABERTO', 'Já existe caixa aberto neste terminal ou para este operador');
    const c = await prisma.$transaction(async (tx) => {
      const n = await tx.caixaSessao.create({ data: { id: b.id, terminalId: t.id, abertoPorId: u.id, valorAbertura: b.fundoTroco }, include: incTerminal });
      await tx.sessaoUsuario.update({ where: { id: u.sessaoId }, data: { terminalId: t.id } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CAIXA_ABERTO', 'caixa_sessao', n.id, undefined, { terminalId: t.id, fundoTroco: b.fundoTroco });
      return n;
    });
    return reply.code(201).send(caixaDto(c, u.nome));
  });

  app.post('/caixas/:id/lancamentos', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ id: zUuid, tipo: z.enum(['SANGRIA', 'SUPRIMENTO']), valor: zMoney.refine((v) => toCents(v) > 0, 'valor maior que zero'), motivo: zTexto(300) }), req.body);
    await prisma.$transaction(async (tx) => {
      const ja = await tx.caixaLancamento.findUnique({ where: { id: b.id } });
      if (ja) { if (ja.sessaoId !== id) conflito('ID_EM_USO', 'Identificador já usado'); return; } // reenvio idempotente
      const c = await meuCaixaAberto(tx, u, id);
      // trava a sessão para duas sangrias simultâneas não passarem do saldo
      await tx.$queryRaw`SELECT id FROM caixa_sessao WHERE id = ${c.id}::uuid FOR UPDATE`;
      if (b.tipo === 'SANGRIA') await registrarSangria(tx, c.id, u.id, toCents(b.valor), b.motivo, b.id);
      else await tx.caixaLancamento.create({ data: { id: b.id, sessaoId: c.id, tipo: 'SUPRIMENTO', valor: b.valor, motivo: b.motivo, usuarioId: u.id } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, b.tipo, 'caixa_sessao', c.id, undefined, { valor: b.valor });
    });
    return reply.code(204).send();
  });

  app.get('/caixas/:id/previa-fechamento', { config: { acesso: ['caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    await meuCaixaAberto(prisma, u, id);
    return (await calcularPrevia(prisma, id)).dto;
  });

  app.post('/caixas/:id/fechar', { config: { acesso: ['caixa.operar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ contado: zMoney, observacao: z.string().trim().max(500).optional() }), req.body);
    const c = await prisma.$transaction(async (tx) => {
      await meuCaixaAberto(tx, u, id);
      await tx.$queryRaw`SELECT id FROM caixa_sessao WHERE id = ${id}::uuid FOR UPDATE`;
      const { esperadoCents } = await calcularPrevia(tx, id);
      const contado = toCents(b.contado);
      const dif = contado - esperadoCents;
      if (dif !== 0 && (b.observacao ?? '').length < 5) {
        throw new AppError(400, 'Diferença de caixa exige observação', 'OBSERVACAO_OBRIGATORIA', `Esperado ${fromCents(esperadoCents)}, contado ${b.contado}`);
      }
      const n = await tx.caixaSessao.update({
        where: { id },
        data: { status: 'FECHADO', fechadoPorId: u.id, fechadoEm: new Date(), valorEsperado: fromCents(esperadoCents), valorContado: fromCents(contado), diferenca: fromCents(dif), observacao: b.observacao || null },
        include: incTerminal,
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CAIXA_FECHADO', 'caixa_sessao', id, undefined, { esperado: fromCents(esperadoCents), contado: b.contado, diferenca: fromCents(dif) });
      return n;
    });
    return caixaDto(c, u.nome);
  });

  app.get('/caixas', { config: { acesso: ['relatorios.consultar'] } }, async (req) => {
    const q = parse(zPage.merge(zPeriodo).extend({ operadorId: zUuid.optional(), terminalId: zUuid.optional() }), req.query);
    const where = {
      ...(periodo(q.de, q.ate) ? { abertoEm: periodo(q.de, q.ate) } : {}),
      ...(q.operadorId ? { abertoPorId: q.operadorId } : {}), ...(q.terminalId ? { terminalId: q.terminalId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.caixaSessao.findMany({ where, include: incTerminal, orderBy: { abertoEm: 'desc' }, ...skipTake(q) }),
      prisma.caixaSessao.count({ where }),
    ]);
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.abertoPorId))] } }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]));
    return page(rows.map((r) => caixaDto(r, nomes.get(r.abertoPorId) ?? '—')), q, total);
  });

}
