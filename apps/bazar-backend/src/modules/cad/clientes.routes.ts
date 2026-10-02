/**
 * CAD — clientes (RF-CAD-04, RF-PDV-05, RF-PRV-01) e dados da instituição (RF-CAD-07).
 * LGPD: busca por nome/telefone vai no CORPO (POST /clientes/busca), nunca na URL;
 * dados mínimos (RN-21); ciência do aviso de privacidade registrada em `consentimento`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Db, type Tx } from '../../lib/prisma.js';
import { conflito, naoEncontrado } from '../../lib/errors.js';
import { parse, zIdParam, zTexto, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { exigirUsuario } from '../../plugins/auth.js';

export const VERSAO_AVISO = 'v1-2026-10';
export const FINALIDADE_CLIENTE = 'Venda fiada (crediário) e contato de cobrança';

export const zTelefone = z.string().trim().max(20).transform((s) => s.replace(/\D/g, '')).refine((s) => /^\d{10,11}$/.test(s), 'telefone com DDD (10 ou 11 dígitos)');
export const zNovoCliente = z.object({
  id: zUuid, nome: zTexto(120), telefone: zTelefone,
  cienciaAviso: z.literal(true, { message: 'o titular precisa ter ciência do aviso de privacidade' }),
});

type ClienteRow = { id: string; nome: string; telefone: string; ativo: boolean; anonimizadoEm: Date | null; consentimentos?: { id: string }[] };
export const clienteDto = (c: ClienteRow) => ({
  id: c.id, nome: c.nome, telefone: c.telefone, ativo: c.ativo,
  anonimizado: c.anonimizadoEm ? true : undefined,
  cienciaAviso: (c.consentimentos?.length ?? 0) > 0,
});
const comConsent = { consentimentos: { where: { revogadoEm: null }, select: { id: true }, take: 1 } } as const;

/** Cria cliente com consentimento — idempotente pelo id gerado no terminal (cadastro offline). */
export async function criarCliente(tx: Tx, usuarioId: string, ip: string | undefined, b: z.infer<typeof zNovoCliente>) {
  const existente = await tx.cliente.findUnique({ where: { id: b.id }, include: comConsent });
  if (existente) return { cliente: existente, criado: false };
  const c = await tx.cliente.create({
    data: {
      id: b.id, nome: b.nome, telefone: b.telefone,
      consentimentos: { create: { titularTipo: 'CLIENTE', finalidade: FINALIDADE_CLIENTE, versaoAviso: VERSAO_AVISO, registradoPorId: usuarioId } },
    },
    include: comConsent,
  });
  await auditar(tx, { usuarioId, ip }, 'CLIENTE_CRIADO', 'cliente', c.id);
  return { cliente: c, criado: true };
}

export async function obterClienteAtivo(db: Db, id: string) {
  const c = await db.cliente.findUnique({ where: { id } });
  return c && c.ativo && !c.anonimizadoEm ? c : null;
}

export async function rotasClientes(app: FastifyInstance) {
  app.post('/clientes/busca', { config: { acesso: ['clientes.gerenciar', 'caixa.operar', 'contas_receber.receber', 'privacidade.gerenciar'] } }, async (req) => {
    const b = parse(z.object({ termo: z.string().trim().max(100).default(''), ativo: z.boolean().optional() }), req.body ?? {});
    const digitos = b.termo.replace(/\D/g, '');
    const where = {
      anonimizadoEm: null,
      ...(b.ativo !== undefined ? { ativo: b.ativo } : {}),
      ...(b.termo ? { OR: [
        { nome: { contains: b.termo, mode: 'insensitive' as const } },
        ...(digitos.length >= 4 ? [{ telefone: { contains: digitos } }] : []),
      ] } : {}),
    };
    const rs = await prisma.cliente.findMany({ where, include: comConsent, orderBy: { nome: 'asc' }, take: 50 });
    return rs.map(clienteDto);
  });

  app.get('/clientes', { config: { acesso: ['clientes.gerenciar'] } }, async () => {
    const rs = await prisma.cliente.findMany({ where: { anonimizadoEm: null }, include: comConsent, orderBy: { nome: 'asc' }, take: 500 });
    return rs.map(clienteDto);
  });

  app.post('/clientes', { config: { acesso: ['clientes.gerenciar', 'caixa.operar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zNovoCliente, req.body);
    const r = await prisma.$transaction((tx) => criarCliente(tx, u.id, req.ip, b));
    return reply.code(r.criado ? 201 : 200).send(clienteDto(r.cliente));
  });

  app.patch('/clientes/:id', { config: { acesso: ['clientes.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ nome: zTexto(120).optional(), telefone: zTelefone.optional(), ativo: z.boolean().optional() }).strict(), req.body);
    const atual = await prisma.cliente.findUnique({ where: { id } });
    if (!atual) naoEncontrado('Cliente');
    if (atual!.anonimizadoEm) conflito('JA_ANONIMIZADO', 'Titular anonimizado não pode ser editado');
    const c = await prisma.$transaction(async (tx) => {
      const novo = await tx.cliente.update({ where: { id }, data: b, include: comConsent });
      // RN-29: auditoria só registra QUAIS campos mudaram, nunca os valores pessoais
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CLIENTE_ALTERADO', 'cliente', id, undefined,
        { camposAlterados: Object.keys(b), ativo: novo.ativo });
      return novo;
    });
    return clienteDto(c);
  });

  // ---------------- instituição ----------------
  const zInst = z.object({
    nome: zTexto(150),
    cnpj: z.string().trim().transform((s) => s.replace(/\D/g, '')).refine((s) => s === '' || /^\d{14}$/.test(s), 'CNPJ com 14 dígitos'),
    endereco: z.string().trim().max(250).default(''),
    telefone: z.string().trim().max(30).default(''),
  });
  const instDto = (i: { nome: string; cnpj: string | null; endereco: string | null; telefone: string | null }) =>
    ({ nome: i.nome, cnpj: i.cnpj ?? '', endereco: i.endereco ?? '', telefone: i.telefone ?? '' });

  // caixa.operar também lê: o comprovante não fiscal mostra os dados da instituição (RF-PDV-08)
  app.get('/instituicao', { config: { acesso: ['parametros.gerenciar', 'caixa.operar'] } }, async () => {
    const i = await prisma.instituicao.findUnique({ where: { id: 1 } });
    return i ? instDto(i) : { nome: '', cnpj: '', endereco: '', telefone: '' };
  });
  app.put('/instituicao', { config: { acesso: ['parametros.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const b = parse(zInst, req.body);
    const data = { nome: b.nome, cnpj: b.cnpj || null, endereco: b.endereco || null, telefone: b.telefone || null };
    const i = await prisma.$transaction(async (tx) => {
      const r = await tx.instituicao.upsert({ where: { id: 1 }, create: { id: 1, uf: 'PI', ...data }, update: data });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'INSTITUICAO_ALTERADA', 'instituicao', '1');
      return r;
    });
    return instDto(i);
  });
}
