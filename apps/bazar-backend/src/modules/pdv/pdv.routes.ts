/**
 * PDV — catálogo do terminal (ETag), venda idempotente, sincronização offline,
 * listagem/comprovante, cancelamento e pendências de sincronização
 * (RF-PDV-01..13, RN-14, RN-26). Contrato: front-end src/api/modules/pdv.ts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { AppError, conflito, naoEncontrado, traduzirErroBanco } from '../../lib/errors.js';
import { page, parse, skipTake, zIdParam, zMotivo, zPage, zPeriodo, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { fromCents, toCents } from '../../lib/money.js';
import { localDate, periodo } from '../../lib/dates.js';
import { paramNum } from '../../lib/parametros.js';
import { exigirUsuario, tem, type UsuarioCtx } from '../../plugins/auth.js';
import { criarCliente, zNovoCliente } from '../cad/clientes.routes.js';
import { regraDto, regrasVigentes } from '../fis/fiscal.service.js';
import { caixaAbertoDoOperador, registrarSangria } from '../cxa/caixa.service.js';
import { carregarVenda, emTransacao, processarVenda, zVendaRequest, type Operador, type VendaRequest } from './vendas.service.js';
import type { Permissao } from '../../lib/permissoes.js';

const opDe = (u: UsuarioCtx): Operador => ({ id: u.id, nome: u.nome, permissoes: u.permissoes, limiteDescontoPct: u.limiteDescontoPct });

/** Venda alheia só para quem administra vendas ou relatórios (anti-IDOR). */
function podeVerTodas(u: UsuarioCtx) { return tem(u, 'venda.cancelar') || tem(u, 'relatorios.consultar'); }

const STATUS_PEND = { PENDENTE: 'ABERTA', RESOLVIDA: 'REPROCESSADA', DESCARTADA: 'DESCARTADA' } as const;
const STATUS_PEND_INV = { ABERTA: 'PENDENTE', REPROCESSADA: 'RESOLVIDA', DESCARTADA: 'DESCARTADA' } as const;

interface PayloadPendencia { venda: Record<string, unknown>; operadorId: string; operadorNome: string; codigo: string }

type PendRow = Awaited<ReturnType<typeof prisma.pendenciaSincronizacao.findFirstOrThrow<{ include: { terminal: { select: { nome: true } } } }>>>;
function pendenciaDto(p: PendRow) {
  const pl = p.payload as unknown as PayloadPendencia;
  const v = pl.venda ?? {};
  const pags = Array.isArray(v.pagamentos) ? (v.pagamentos as { valor?: unknown }[]) : [];
  let total = 0;
  for (const x of pags) { try { total += toCents(String(x.valor ?? '0')); } catch { /* payload inválido */ } }
  return {
    id: p.id, vendaId: p.referenciaId, numeroLocal: typeof v.numeroLocal === 'string' ? v.numeroLocal : undefined,
    terminalNome: p.terminal.nome, operadorNome: pl.operadorNome ?? '—',
    ocorridaEm: typeof v.ocorridaEm === 'string' ? v.ocorridaEm : p.criadaEm.toISOString(),
    total: fromCents(total), codigo: pl.codigo ?? 'ERRO', motivo: p.motivo, status: STATUS_PEND[p.status],
  };
}

export async function rotasPdv(app: FastifyInstance) {
  // ---------------- catálogo do terminal (RF-PDV-10, RNF-19: só o necessário) ----------------
  app.get('/pdv/catalogo', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const [categorias, etiquetadas, clientes, regras, prazo] = await Promise.all([
      // RN-30: categoria inativa continua vendável enquanto tiver saldo por categoria no bazar
      prisma.$queryRaw<{ id: string; nome: string; preco_padrao: string | null; venda_por_categoria: boolean; ativa: boolean }[]>`
        SELECT c.id::text, c.nome, c.preco_padrao::text, c.venda_por_categoria, c.ativa FROM categoria c
        WHERE (c.ativa AND c.venda_por_categoria) OR EXISTS (
          SELECT 1 FROM item i JOIN vw_saldo_estoque s ON s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0
          WHERE i.categoria_id = c.id AND i.tipo_controle = 'CATEGORIA')
        ORDER BY c.nome`,
      prisma.$queryRaw<{ id: string; codigo_barras: string; descricao: string | null; preco_venda: string }[]>`
        SELECT i.id::text, i.codigo_barras, i.descricao, i.preco_venda::text FROM item i
        JOIN vw_saldo_estoque s ON s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0
        WHERE i.tipo_controle = 'ETIQUETADO' ORDER BY i.codigo_barras`,
      prisma.cliente.findMany({ where: { ativo: true, anonimizadoEm: null }, select: { id: true, nome: true, telefone: true }, orderBy: { nome: 'asc' } }),
      regrasVigentes(prisma, localDate()),
      paramNum(prisma, 'fiado.prazo_dias', 0),
    ]);
    const corpo = {
      categorias: categorias.map((c) => ({ id: c.id, nome: c.nome, precoPadrao: c.preco_padrao ? Number(c.preco_padrao).toFixed(2) : '0.00', vendaPorCategoria: c.venda_por_categoria, ativo: c.ativa })),
      itensEtiquetados: etiquetadas.map((i) => ({ itemId: i.id, codigo: i.codigo_barras, descricao: i.descricao ?? '', preco: Number(i.preco_venda).toFixed(2) })),
      clientesFiado: clientes,
      regrasFiscais: regras.map(regraDto),
      fiadoPrazoDias: prazo || undefined,
    };
    const etag = `"${createHash('sha256').update(JSON.stringify(corpo)).digest('base64url').slice(0, 27)}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return { versao: etag, ...corpo };
  });

  // ---------------- venda online, idempotente (RF-PDV-03, RN-26) ----------------
  app.put('/vendas/:id', { config: { acesso: ['caixa.operar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const body = parse(zVendaRequest, req.body);
    let r;
    try {
      r = await emTransacao((tx) => processarVenda(tx, id, body, opDe(u), body.origem === 'OFFLINE' ? 'SYNC' : 'ONLINE'));
    } catch (e) {
      // corrida: o mesmo id gravado por outra requisição simultânea => devolve a venda já gravada
      const t = traduzirErroBanco(e);
      if (t?.code === 'DUPLICADO' && (await prisma.venda.findUnique({ where: { id }, select: { registradaPorId: true } }))?.registradaPorId === u.id) {
        r = { id, numero: 0, jaExistia: true };
      } else throw e;
    }
    const v = await carregarVenda(prisma, id);
    return reply.code(r.jaExistia ? 200 : 201).send(v!.dto);
  });

  // ---------------- sincronização da fila offline (RF-PDV-12/13) ----------------
  const zSync = z.object({
    clientes: z.array(z.unknown()).max(200).default([]),
    vendas: z.array(z.unknown()).max(200).default([]),
  });
  app.post('/sync/lote', { bodyLimit: 4 * 1024 * 1024, config: { acesso: ['caixa.operar'], rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const u = exigirUsuario(req);
    const b = parse(zSync, req.body);
    const resultados: { id: string; tipo: 'cliente' | 'venda'; status: 'GRAVADA' | 'JA_EXISTENTE' | 'PENDENCIA'; numero?: number; motivo?: string }[] = [];

    // 1) clientes cadastrados sem internet vêm antes das vendas que os usam (RN-26)
    for (const raw of b.clientes) {
      const idBruto = String((raw as { id?: unknown })?.id ?? '').slice(0, 64);
      const c = zNovoCliente.safeParse(raw);
      if (!c.success) {
        // cliente inválido não trava a fila: a venda que depende dele vira pendência
        resultados.push({ id: idBruto, tipo: 'cliente', status: 'PENDENCIA', motivo: 'Cadastro do cliente inválido' });
        continue;
      }
      const r = await prisma.$transaction((tx) => criarCliente(tx, u.id, req.ip, c.data));
      resultados.push({ id: c.data.id, tipo: 'cliente', status: r.criado ? 'GRAVADA' : 'JA_EXISTENTE' });
    }

    // 2) vendas em ordem cronológica do terminal
    const vendas = b.vendas
      .map((raw) => ({ raw, id: typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '' }))
      .sort((a, b2) => String((a.raw as { ocorridaEm?: string }).ocorridaEm ?? '').localeCompare(String((b2.raw as { ocorridaEm?: string }).ocorridaEm ?? '')));
    for (const { raw, id } of vendas) {
      if (!zUuid.safeParse(id).success) {
        resultados.push({ id: id.slice(0, 64), tipo: 'venda', status: 'PENDENCIA', motivo: 'Venda sem identificador válido' });
        continue;
      }
      const ja = await prisma.venda.findUnique({ where: { id }, select: { numero: true, registradaPorId: true } });
      if (ja && ja.registradaPorId === u.id) { resultados.push({ id, tipo: 'venda', status: 'JA_EXISTENTE', numero: ja.numero }); continue; }
      try {
        const v = parse(zVendaRequest, raw);
        const r = await emTransacao((tx) => processarVenda(tx, id, v, opDe(u), 'SYNC'));
        resultados.push({ id, tipo: 'venda', status: r.jaExistia ? 'JA_EXISTENTE' : 'GRAVADA', numero: r.numero });
      } catch (e) {
        const err = traduzirErroBanco(e);
        if (!err || err.status >= 500) throw e; // falha técnica: a fila do terminal tenta de novo
        // RN-26: nenhuma venda se perde — vira pendência com os dados preservados
        await registrarPendencia(req, u, id, raw, err.code ?? 'ERRO', err.detail ?? err.title);
        resultados.push({ id, tipo: 'venda', status: 'PENDENCIA', motivo: err.detail ?? err.title });
      }
    }
    return { resultados };
  });

  async function registrarPendencia(req: FastifyRequest, u: UsuarioCtx, vendaId: string, raw: unknown, codigo: string, motivo: string) {
    const v = (raw ?? {}) as Record<string, unknown>;
    // terminal do payload se existir; senão, o do último caixa do operador
    let terminalId = typeof v.terminalId === 'string' && zUuid.safeParse(v.terminalId).success
      ? (await prisma.terminal.findUnique({ where: { id: v.terminalId }, select: { id: true } }))?.id : undefined;
    terminalId ??= (await prisma.caixaSessao.findFirst({ where: { abertoPorId: u.id }, orderBy: { abertoEm: 'desc' }, select: { terminalId: true } }))?.terminalId;
    if (!terminalId) throw new AppError(400, 'Venda da fila sem terminal válido', 'TERMINAL_INVALIDO');
    const payload: PayloadPendencia = { venda: v, operadorId: u.id, operadorNome: u.nome, codigo };
    await prisma.pendenciaSincronizacao.upsert({
      where: { tipo_referenciaId: { tipo: 'VENDA', referenciaId: vendaId } },
      create: { terminalId, tipo: 'VENDA', referenciaId: vendaId, payload: payload as never, motivo: motivo.slice(0, 500) },
      update: {}, // reenvio da mesma venda não duplica a pendência
    });
    req.log.info({ evento: 'pendencia_sincronizacao', codigo }, 'venda offline virou pendência');
  }

  // ---------------- listagem e comprovante (RF-PDV-08/09) ----------------
  app.get('/vendas', { config: { acesso: ['caixa.operar', 'venda.cancelar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const q = parse(zPage.merge(zPeriodo).extend({ caixaId: zUuid.optional() }), req.query);
    const where = {
      ...(podeVerTodas(u) ? {} : { registradaPorId: u.id }),
      ...(q.caixaId ? { sessaoId: q.caixaId } : {}),
      ...(periodo(q.de, q.ate) ? { ocorridaEm: periodo(q.de, q.ate) } : {}),
    };
    const [ids, total] = await Promise.all([
      prisma.venda.findMany({ where, select: { id: true }, orderBy: [{ ocorridaEm: 'desc' }, { numero: 'desc' }], ...skipTake(q) }),
      prisma.venda.count({ where }),
    ]);
    const itens = [];
    for (const { id } of ids) itens.push((await carregarVenda(prisma, id))!.dto);
    return page(itens, q, total);
  });

  app.get('/vendas/:id/comprovante', { config: { acesso: ['caixa.operar', 'venda.cancelar', 'relatorios.consultar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const v = await carregarVenda(prisma, id);
    if (!v || (!podeVerTodas(u) && v.venda.registradaPorId !== u.id)) naoEncontrado('Venda'); // 404 em vez de 403: não revela existência
    return v!.dto;
  });

  // ---------------- cancelamento (RF-PDV-07, RN-14) ----------------
  app.post('/vendas/:id/cancelar', { config: { acesso: ['venda.cancelar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { motivo } = parse(z.object({ motivo: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const v = await tx.venda.findUnique({ where: { id }, include: { sessao: { select: { status: true } }, pagamentos: true } });
      if (!v) naoEncontrado('Venda');
      if (v!.status === 'CANCELADA') conflito('VENDA_CANCELADA', 'Venda já cancelada');
      const dinheiro = v!.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + toCents(p.valor), 0);
      let sangriaId: string | undefined;
      // Caixa da venda fechado não reabre: reembolso em dinheiro sai do caixa aberto (RN-14).
      // Caixa ainda aberto: a venda cancelada já sai do valor esperado, sem sangria.
      if (dinheiro > 0 && v!.sessao.status === 'FECHADO') {
        const cx = await caixaAbertoDoOperador(tx, u.id);
        if (!cx) conflito('SEM_CAIXA_ABERTO', 'Reembolso em dinheiro exige um caixa aberto', 'Abra um caixa antes de cancelar esta venda');
        sangriaId = (await registrarSangria(tx, cx!.id, u.id, dinheiro, `Reembolso da venda nº ${v!.numero}`)).id;
      }
      // O banco devolve os itens ao estoque de origem e cancela a conta a receber (tg_estorna_venda_cancelada);
      // recusa se houver recebimento de fiado ativo (FIADO_COM_RECEBIMENTO).
      await tx.venda.update({ where: { id }, data: { status: 'CANCELADA', canceladaPorId: u.id, canceladaEm: new Date(), motivoCancelamento: motivo } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'VENDA_CANCELADA', 'venda', id, { status: 'FINALIZADA' },
        { status: 'CANCELADA', motivo, reembolsoDinheiro: fromCents(dinheiro), sangriaId });
    });
    return (await carregarVenda(prisma, id))!.dto;
  });

  // ---------------- pendências (RF-PDV-13) ----------------
  const incTerm = { terminal: { select: { nome: true } } } as const;
  app.get('/pendencias', { config: { acesso: ['sincronizacao.resolver'] } }, async (req) => {
    const q = parse(zPage.extend({ status: z.enum(['ABERTA', 'REPROCESSADA', 'DESCARTADA']).optional() }), req.query);
    const where = q.status ? { status: STATUS_PEND_INV[q.status] } : {};
    const [rows, total] = await Promise.all([
      prisma.pendenciaSincronizacao.findMany({ where, include: incTerm, orderBy: { criadaEm: 'desc' }, ...skipTake(q) }),
      prisma.pendenciaSincronizacao.count({ where }),
    ]);
    return page(rows.map(pendenciaDto), q, total);
  });

  app.post('/pendencias/:id/reprocessar', { config: { acesso: ['sincronizacao.resolver'] } }, async (req) => {
    const admin = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const p = await prisma.pendenciaSincronizacao.findUnique({ where: { id }, include: incTerm });
    if (!p) naoEncontrado('Pendência');
    if (p!.status !== 'PENDENTE') conflito('PENDENCIA_RESOLVIDA', 'Pendência já resolvida');
    const pl = p!.payload as unknown as PayloadPendencia;
    // a venda continua em nome do operador original, com o limite de desconto do perfil dele
    const opDb = await prisma.usuario.findUnique({
      where: { id: pl.operadorId },
      select: { id: true, nome: true, perfil: { select: { limiteDescontoPct: true, permissoes: { select: { permissaoCodigo: true } } } } },
    });
    if (!opDb) conflito('OPERADOR_INEXISTENTE', 'Operador da venda não existe mais');
    const op: Operador = {
      id: opDb!.id, nome: opDb!.nome, limiteDescontoPct: opDb!.perfil.limiteDescontoPct ? Number(opDb!.perfil.limiteDescontoPct.toFixed(2)) : 0,
      permissoes: new Set(opDb!.perfil.permissoes.map((x) => x.permissaoCodigo as Permissao)),
    };
    let venda: VendaRequest;
    try { venda = parse(zVendaRequest, pl.venda); } catch { return conflito('PAYLOAD_INVALIDO', 'Dados da venda inválidos: descarte a pendência com justificativa'); }
    try {
      await emTransacao(async (tx) => {
        await processarVenda(tx, p!.referenciaId, venda, op, 'REPROCESSO');
        await tx.pendenciaSincronizacao.update({ where: { id }, data: { status: 'RESOLVIDA', resolvidaPorId: admin.id, resolvidaEm: new Date(), resolucao: 'Venda reprocessada' } });
        await auditar(tx, { usuarioId: admin.id, ip: req.ip }, 'PENDENCIA_REPROCESSADA', 'pendencia', id, undefined, { vendaId: p!.referenciaId });
      });
    } catch (e) {
      const err = traduzirErroBanco(e);
      if (err && err.status < 500) {
        // guarda o motivo atual para o Administrador ver o que ainda impede a gravação
        await prisma.pendenciaSincronizacao.update({ where: { id }, data: { motivo: (err.detail ?? err.title).slice(0, 500), payload: { ...pl, codigo: err.code ?? pl.codigo } as never } });
      }
      throw e;
    }
    return pendenciaDto((await prisma.pendenciaSincronizacao.findUniqueOrThrow({ where: { id }, include: incTerm })));
  });

  app.post('/pendencias/:id/descartar', { config: { acesso: ['sincronizacao.resolver'] } }, async (req) => {
    const admin = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const { justificativa } = parse(z.object({ justificativa: zMotivo }), req.body);
    await prisma.$transaction(async (tx) => {
      const p = await tx.pendenciaSincronizacao.findUnique({ where: { id } });
      if (!p) naoEncontrado('Pendência');
      if (p!.status !== 'PENDENTE') conflito('PENDENCIA_RESOLVIDA', 'Pendência já resolvida');
      await tx.pendenciaSincronizacao.update({ where: { id }, data: { status: 'DESCARTADA', resolvidaPorId: admin.id, resolvidaEm: new Date(), resolucao: justificativa } });
      await auditar(tx, { usuarioId: admin.id, ip: req.ip }, 'PENDENCIA_DESCARTADA', 'pendencia', id, undefined, { justificativa });
    });
    return pendenciaDto(await prisma.pendenciaSincronizacao.findUniqueOrThrow({ where: { id }, include: incTerm }));
  });

}
