/** ACS — usuários, perfis, permissões e auditoria (RF-ACS-03, 04, 06, 07). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../lib/errors.js';
import { page, parse, skipTake, zIdParam, zMoney, zPage, zPeriodo, zTexto, zUuid, zBoolQuery } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { money } from '../../lib/money.js';
import { periodo } from '../../lib/dates.js';
import { PERMISSOES, type Permissao } from '../../lib/permissoes.js';
import { exigirUsuario } from '../../plugins/auth.js';
import { hashSenha, senhaProvisoria } from './senhas.js';

const PERFIL_ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';
const ESSENCIAIS_ADMIN: Permissao[] = ['usuarios.gerenciar', 'perfis.gerenciar'];

const DESCRICOES: Record<Permissao, string> = {
  'usuarios.gerenciar': 'Usuários e redefinição de senha', 'perfis.gerenciar': 'Perfis, permissões e limite de desconto',
  'auditoria.consultar': 'Trilha de auditoria', 'cadastros.gerenciar': 'Categorias, parceiros, campanhas, motivos, importação',
  'cadastros.consultar': 'Consultar cadastros', 'clientes.gerenciar': 'Clientes', 'parametros.gerenciar': 'Parâmetros e dados da instituição',
  'entrada.registrar': 'Lotes, itens aprovados, descartes, etiquetas, encerrar triagem', 'triagem.reabrir': 'Reabrir lote, reverter descarte',
  'estoque.consultar': 'Estoque e histórico do item', 'estoque.transferir': 'Transferir entre bazar e doações',
  'estoque.ajustar': 'Baixa, ajuste, preço, carga inicial', 'caixa.operar': 'Abrir/fechar caixa, vender, sangria, suprimento',
  'venda.cancelar': 'Cancelar venda', 'venda.desconto_autorizar': 'Desconto acima do limite do perfil',
  'sincronizacao.resolver': 'Pendências de venda offline', 'terminais.gerenciar': 'Pontos de caixa',
  'contas_pagar.gerenciar': 'Contas a pagar e lote de compra', 'contas_receber.receber': 'Receber fiado, extrato do cliente',
  'contas_receber.lancar': 'Conta a receber manual', 'recebimento.estornar': 'Estornar recebimento',
  'relatorios.consultar': 'Relatórios, prestação de contas, histórico de caixas', 'fiscal.gerenciar': 'Regra de imposto',
  'privacidade.gerenciar': 'Exportar e anonimizar titulares',
};

const usuarioSelect = { id: true, nome: true, login: true, perfilId: true, ativo: true, perfil: { select: { nome: true } } } as const;
type UsuarioRow = { id: string; nome: string; login: string; perfilId: string; ativo: boolean; perfil: { nome: string } };
const usuarioDto = (u: UsuarioRow) => ({ id: u.id, nome: u.nome, login: u.login, perfilId: u.perfilId, perfilNome: u.perfil.nome, ativo: u.ativo });

const perfilInclude = { permissoes: { select: { permissaoCodigo: true } } } as const;
type PerfilRow = { id: string; nome: string; padrao: boolean; limiteDescontoPct: { toFixed(n: number): string } | null; permissoes: { permissaoCodigo: string }[] };
const perfilDto = (p: PerfilRow) => ({
  id: p.id, nome: p.nome, padrao: p.padrao, limiteDesconto: money(p.limiteDescontoPct),
  permissoes: p.permissoes.map((x) => x.permissaoCodigo).sort(),
});

const zLogin = z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9._-]+$/, 'use letras, números, ponto, hífen ou sublinhado');
const zPermissoes = z.array(z.enum(PERMISSOES)).max(PERMISSOES.length).transform((a) => [...new Set(a)]);
const zPct = zMoney.refine((v) => Number(v) <= 100, 'limite em % de 0 a 100');

export async function rotasUsuarios(app: FastifyInstance) {
  // ---------------- usuários ----------------
  app.get('/usuarios', { config: { acesso: ['usuarios.gerenciar'] } }, async (req) => {
    const q = parse(zPage.extend({ busca: z.string().trim().max(100).optional(), ativo: zBoolQuery.optional() }), req.query);
    const where = {
      ...(q.ativo !== undefined ? { ativo: q.ativo } : {}),
      ...(q.busca ? { OR: [{ nome: { contains: q.busca, mode: 'insensitive' as const } }, { login: { contains: q.busca.toLowerCase() } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.usuario.findMany({ where, select: usuarioSelect, orderBy: { nome: 'asc' }, ...skipTake(q) }),
      prisma.usuario.count({ where }),
    ]);
    return page(rows.map(usuarioDto), q, total);
  });

  app.post('/usuarios', { config: { acesso: ['usuarios.gerenciar'] } }, async (req, reply) => {
    const ator = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid.optional(), nome: zTexto(120), login: zLogin, perfilId: zUuid }), req.body);
    const perfil = await prisma.perfil.findFirst({ where: { id: b.perfilId, ativo: true } });
    if (!perfil) throw new AppError(400, 'Dados inválidos', 'VALIDACAO', 'perfilId: perfil inexistente ou inativo');
    const senha = senhaProvisoria();
    const u = await prisma.$transaction(async (tx) => {
      const novo = await tx.usuario.create({
        data: { ...(b.id ? { id: b.id } : {}), nome: b.nome, login: b.login, perfilId: b.perfilId, senhaHash: await hashSenha(senha), trocarSenha: true },
        select: usuarioSelect,
      });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'USUARIO_CRIADO', 'usuario', novo.id, undefined, { perfilId: novo.perfilId, ativo: true });
      return novo;
    });
    // Senha provisória devolvida UMA vez; nunca é logada nem armazenada em claro.
    return reply.code(201).send({ ...usuarioDto(u), senhaProvisoria: senha });
  });

  app.patch('/usuarios/:id', { config: { acesso: ['usuarios.gerenciar'] } }, async (req) => {
    const ator = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ nome: zTexto(120).optional(), perfilId: zUuid.optional(), ativo: z.boolean().optional() }).strict(), req.body);
    if (id === ator.id && b.ativo === false) conflito('AUTO_DESATIVACAO', 'Você não pode desativar o próprio usuário');
    if (id === ator.id && b.perfilId && b.perfilId !== ator.perfilId) conflito('AUTO_PERFIL', 'Você não pode alterar o próprio perfil');
    const antes = await prisma.usuario.findUnique({ where: { id }, select: usuarioSelect });
    if (!antes) naoEncontrado('Usuário');
    if (b.perfilId && !(await prisma.perfil.findFirst({ where: { id: b.perfilId, ativo: true } }))) {
      throw new AppError(400, 'Dados inválidos', 'VALIDACAO', 'perfilId: perfil inexistente ou inativo');
    }
    return prisma.$transaction(async (tx) => {
      const u = await tx.usuario.update({ where: { id }, data: b, select: usuarioSelect });
      if (b.ativo === false || (b.perfilId && b.perfilId !== antes!.perfilId)) {
        await tx.sessaoUsuario.updateMany({ where: { usuarioId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
      }
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'USUARIO_ALTERADO', 'usuario', id,
        { perfilId: antes!.perfilId, ativo: antes!.ativo }, { perfilId: u.perfilId, ativo: u.ativo, nomeAlterado: b.nome !== undefined });
      return usuarioDto(u);
    });
  });

  app.post('/usuarios/:id/redefinir-senha', { config: { acesso: ['usuarios.gerenciar'] } }, async (req) => {
    const ator = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    if (!(await prisma.usuario.findUnique({ where: { id }, select: { id: true } }))) naoEncontrado('Usuário');
    const senha = senhaProvisoria();
    const hash = await hashSenha(senha);
    await prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id }, data: { senhaHash: hash, trocarSenha: true } });
      await tx.sessaoUsuario.updateMany({ where: { usuarioId: id, revogadaEm: null }, data: { revogadaEm: new Date() } });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'SENHA_REDEFINIDA', 'usuario', id);
    });
    return { senhaProvisoria: senha };
  });

  // ---------------- perfis e permissões ----------------
  app.get('/perfis', { config: { acesso: ['perfis.gerenciar', 'usuarios.gerenciar'] } }, async () => {
    const ps = await prisma.perfil.findMany({ where: { ativo: true }, include: perfilInclude, orderBy: { nome: 'asc' } });
    return ps.map(perfilDto);
  });

  app.get('/permissoes', { config: { acesso: ['perfis.gerenciar'] } }, async () =>
    PERMISSOES.map((codigo) => ({ codigo, descricao: DESCRICOES[codigo] })));

  app.post('/perfis', { config: { acesso: ['perfis.gerenciar'] } }, async (req, reply) => {
    const ator = exigirUsuario(req);
    const b = parse(z.object({ id: zUuid.optional(), nome: zTexto(60), permissoes: zPermissoes, limiteDesconto: zPct.default('0.00') }), req.body);
    const p = await prisma.$transaction(async (tx) => {
      const novo = await tx.perfil.create({
        data: {
          ...(b.id ? { id: b.id } : {}), nome: b.nome, padrao: false, limiteDescontoPct: b.limiteDesconto,
          permissoes: { create: b.permissoes.map((c) => ({ permissaoCodigo: c })) },
        },
        include: perfilInclude,
      });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'PERFIL_CRIADO', 'perfil', novo.id, undefined, { permissoes: b.permissoes, limiteDesconto: b.limiteDesconto });
      return novo;
    });
    return reply.code(201).send(perfilDto(p));
  });

  app.patch('/perfis/:id', { config: { acesso: ['perfis.gerenciar'] } }, async (req) => {
    const ator = exigirUsuario(req);
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ nome: zTexto(60).optional(), permissoes: zPermissoes.optional(), limiteDesconto: zPct.optional() }).strict(), req.body);
    const antes = await prisma.perfil.findUnique({ where: { id }, include: perfilInclude });
    if (!antes) naoEncontrado('Perfil');
    if (antes!.padrao && b.nome && b.nome !== antes!.nome) conflito('PERFIL_PADRAO', 'Perfis padrão não podem ser renomeados');
    if (id === PERFIL_ADMIN_ID && b.permissoes && !ESSENCIAIS_ADMIN.every((p) => b.permissoes!.includes(p))) {
      conflito('PERFIL_ADMIN_PROTEGIDO', 'O perfil Administrador precisa manter usuarios.gerenciar e perfis.gerenciar');
    }
    const p = await prisma.$transaction(async (tx) => {
      if (b.permissoes) {
        await tx.perfilPermissao.deleteMany({ where: { perfilId: id } });
        await tx.perfilPermissao.createMany({ data: b.permissoes.map((c) => ({ perfilId: id, permissaoCodigo: c })) });
      }
      const novo = await tx.perfil.update({
        where: { id },
        data: { ...(b.nome ? { nome: b.nome } : {}), ...(b.limiteDesconto ? { limiteDescontoPct: b.limiteDesconto } : {}) },
        include: perfilInclude,
      });
      await auditar(tx, { usuarioId: ator.id, ip: req.ip }, 'PERFIL_ALTERADO', 'perfil', id,
        { permissoes: antes!.permissoes.map((x) => x.permissaoCodigo), limiteDesconto: money(antes!.limiteDescontoPct) },
        { permissoes: novo.permissoes.map((x) => x.permissaoCodigo), limiteDesconto: money(novo.limiteDescontoPct) });
      return novo;
    });
    return perfilDto(p);
  });

  // ---------------- auditoria ----------------
  app.get('/auditoria', { config: { acesso: ['auditoria.consultar'] } }, async (req) => {
    const q = parse(zPage.merge(zPeriodo).extend({
      acao: z.string().trim().max(60).optional(), entidade: z.string().trim().max(60).optional(),
    }), req.query);
    const where = {
      ...(q.acao ? { acao: { contains: q.acao.toUpperCase() } } : {}),
      ...(q.entidade ? { entidade: q.entidade } : {}),
      ...(periodo(q.de, q.ate) ? { criadoEm: periodo(q.de, q.ate) } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditoria.findMany({ where, orderBy: { id: 'desc' }, ...skipTake(q) }),
      prisma.auditoria.count({ where }),
    ]);
    const ids = [...new Set(rows.map((r) => r.usuarioId).filter((x): x is string => !!x))];
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    return page(rows.map((r) => ({
      id: r.id.toString(), ocorridoEm: r.criadoEm.toISOString(), usuarioNome: r.usuarioId ? nomes.get(r.usuarioId) ?? '—' : 'Sistema',
      acao: r.acao, entidade: r.entidade, entidadeId: r.entidadeId,
    })), q, total);
  });
}
