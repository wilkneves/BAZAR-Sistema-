/**
 * CAD — categorias, parceiros, campanhas, motivos e categorias de despesa (RF-CAD-01..08).
 * Sem DELETE: desativar = PATCH { ativo: false } (RN-24). Campos aceitos por lista branca (sem mass assignment).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Tx } from '../../lib/prisma.js';
import { conflito, naoEncontrado } from '../../lib/errors.js';
import { parse, zBoolQuery, zData, zIdParam, zMoney, zTexto, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { money } from '../../lib/money.js';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { exigirUsuario } from '../../plugins/auth.js';
import type { Permissao } from '../../lib/permissoes.js';

const LEITURA: Permissao[] = ['cadastros.consultar', 'cadastros.gerenciar', 'caixa.operar', 'entrada.registrar', 'estoque.consultar', 'contas_pagar.gerenciar'];
const zFiltro = z.object({ busca: z.string().trim().max(100).optional(), ativo: zBoolQuery.optional() });
const contem = (busca?: string) => (busca ? { nome: { contains: busca, mode: 'insensitive' as const } } : {});

type AnyRow = Record<string, any>;

interface Definicao {
  entidade: string;
  listar(f: { busca?: string; ativo?: boolean }): Promise<AnyRow[]>;
  obter(id: string): Promise<AnyRow | null>;
  criar(tx: Tx, b: unknown): Promise<AnyRow>;
  atualizar(tx: Tx, id: string, b: unknown, atual: AnyRow): Promise<AnyRow>;
  dto(r: AnyRow): unknown;
  nomeDuplicado(nome: string, ignorarId?: string): Promise<boolean>;
}

// ---------------- categorias ----------------
const zCategoria = z.object({
  nome: zTexto(80), precoPadrao: zMoney.optional(), vendaPorCategoria: z.boolean().optional(), ativo: z.boolean().optional(),
});
const categorias: Definicao = {
  entidade: 'categoria',
  listar: (f) => prisma.categoria.findMany({ where: { ...contem(f.busca), ...(f.ativo !== undefined ? { ativa: f.ativo } : {}) }, orderBy: { nome: 'asc' } }),
  obter: (id) => prisma.categoria.findUnique({ where: { id } }),
  criar: (tx, raw) => {
    const b = parse(zCategoria.extend({ id: zUuid.optional() }), raw);
    return tx.categoria.create({ data: { ...(b.id ? { id: b.id } : {}), nome: b.nome, precoPadrao: b.precoPadrao ?? null, vendaPorCategoria: b.vendaPorCategoria ?? false, ativa: b.ativo ?? true } });
  },
  // Preço padrão tem rota própria com motivo (RF-EST-07); aqui só se aceita no cadastro sem histórico de alteração
  atualizar: (tx, id, raw) => {
    const b = parse(zCategoria.partial().omit({ precoPadrao: true }).extend({ precoPadrao: zMoney.optional() }), raw);
    return tx.categoria.update({ where: { id }, data: {
      ...(b.nome ? { nome: b.nome } : {}), ...(b.vendaPorCategoria !== undefined ? { vendaPorCategoria: b.vendaPorCategoria } : {}),
      ...(b.ativo !== undefined ? { ativa: b.ativo } : {}), ...(b.precoPadrao ? { precoPadrao: b.precoPadrao } : {}),
    } });
  },
  dto: (c) => ({ id: c.id, nome: c.nome, precoPadrao: money(c.precoPadrao), vendaPorCategoria: c.vendaPorCategoria, ativo: c.ativa }),
  nomeDuplicado: async (nome, ignorar) => !!(await prisma.categoria.findFirst({ where: { nome: { equals: nome, mode: 'insensitive' }, ...(ignorar ? { NOT: { id: ignorar } } : {}) } })),
};

// ---------------- parceiros ----------------
const zParceiro = z.object({
  nome: zTexto(120),
  tipo: z.enum(['EMPRESA', 'LOJA', 'PESSOA_FISICA', 'OUTRO']).optional(),
  documento: z.string().trim().regex(/^(\d{11}|\d{14})$/, 'CPF (11) ou CNPJ (14) só com dígitos').optional(),
  telefone: z.string().trim().regex(/^\d{10,11}$/, 'telefone com DDD, só dígitos').optional(),
  email: z.string().trim().email().max(120).optional(),
  cidade: z.string().trim().max(80).optional(),
  observacao: z.string().trim().max(500).optional(),
  ativo: z.boolean().optional(),
});
const parceiros: Definicao = {
  entidade: 'parceiro',
  listar: (f) => prisma.parceiro.findMany({ where: { ...contem(f.busca), ...(f.ativo !== undefined ? { ativo: f.ativo } : {}) }, orderBy: [{ naoIdentificado: 'desc' }, { nome: 'asc' }] }),
  obter: (id) => prisma.parceiro.findUnique({ where: { id } }),
  criar: (tx, raw) => {
    const b = parse(zParceiro.extend({ id: zUuid.optional() }), raw);
    return tx.parceiro.create({ data: { ...(b.id ? { id: b.id } : {}), nome: b.nome, tipo: b.tipo ?? 'OUTRO', documento: b.documento ?? null, telefone: b.telefone ?? null, email: b.email ?? null, cidade: b.cidade ?? null, observacao: b.observacao ?? null, ativo: b.ativo ?? true } });
  },
  atualizar: (tx, id, raw, atual) => {
    const b = parse(zParceiro.partial(), raw);
    if (atual.naoIdentificado && (b.ativo === false || b.nome)) conflito('PARCEIRO_ESPECIAL', 'O parceiro especial não pode ser desativado nem renomeado');
    return tx.parceiro.update({ where: { id }, data: b });
  },
  dto: (p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, cidade: p.cidade ?? undefined, especial: p.naoIdentificado || undefined, ativo: p.ativo }),
  nomeDuplicado: async (nome, ignorar) => !!(await prisma.parceiro.findFirst({ where: { nome: { equals: nome, mode: 'insensitive' }, ...(ignorar ? { NOT: { id: ignorar } } : {}) } })),
};

// ---------------- campanhas ----------------
const zCampanha = z.object({ nome: zTexto(120), inicio: zData.optional(), fim: zData.optional(), parceiroId: zUuid.optional(), ativo: z.boolean().optional() });
const campanhas: Definicao = {
  entidade: 'campanha',
  listar: (f) => prisma.campanha.findMany({ where: { ...contem(f.busca), ...(f.ativo !== undefined ? { ativa: f.ativo } : {}) }, orderBy: { nome: 'asc' } }),
  obter: (id) => prisma.campanha.findUnique({ where: { id } }),
  criar: (tx, raw) => {
    const b = parse(zCampanha.extend({ id: zUuid.optional() }), raw);
    if (b.inicio && b.fim && b.fim < b.inicio) conflito('PERIODO_INVALIDO', 'Fim da campanha antes do início');
    return tx.campanha.create({ data: { ...(b.id ? { id: b.id } : {}), nome: b.nome, dataInicio: b.inicio ? toDbDate(b.inicio) : null, dataFim: b.fim ? toDbDate(b.fim) : null, parceiroId: b.parceiroId ?? null, ativa: b.ativo ?? true } });
  },
  atualizar: (tx, id, raw, atual) => {
    const b = parse(zCampanha.partial(), raw);
    const ini = b.inicio ?? (atual.dataInicio ? fromDbDate(atual.dataInicio) : undefined);
    const fim = b.fim ?? (atual.dataFim ? fromDbDate(atual.dataFim) : undefined);
    if (ini && fim && fim < ini) conflito('PERIODO_INVALIDO', 'Fim da campanha antes do início');
    return tx.campanha.update({ where: { id }, data: {
      ...(b.nome ? { nome: b.nome } : {}), ...(b.inicio ? { dataInicio: toDbDate(b.inicio) } : {}), ...(b.fim ? { dataFim: toDbDate(b.fim) } : {}),
      ...(b.parceiroId ? { parceiroId: b.parceiroId } : {}), ...(b.ativo !== undefined ? { ativa: b.ativo } : {}),
    } });
  },
  dto: (c) => ({ id: c.id, nome: c.nome, inicio: c.dataInicio ? fromDbDate(c.dataInicio) : undefined, fim: c.dataFim ? fromDbDate(c.dataFim) : undefined, parceiroId: c.parceiroId ?? undefined, ativo: c.ativa }),
  nomeDuplicado: async (nome, ignorar) => !!(await prisma.campanha.findFirst({ where: { nome: { equals: nome, mode: 'insensitive' }, ...(ignorar ? { NOT: { id: ignorar } } : {}) } })),
};

// ---------------- motivos e categorias de despesa (nome + ativo) ----------------
const zSimples = z.object({ nome: zTexto(80), ativo: z.boolean().optional() });
function simples(entidade: string, model: 'motivoDescarte' | 'motivoBaixa' | 'categoriaDespesa', campoAtivo: 'ativo' | 'ativa'): Definicao {
  const m = () => (prisma as any)[model];
  return {
    entidade,
    listar: (f) => m().findMany({ where: { ...contem(f.busca), ...(f.ativo !== undefined ? { [campoAtivo]: f.ativo } : {}) }, orderBy: { nome: 'asc' } }),
    obter: (id) => m().findUnique({ where: { id } }),
    criar: (tx, raw) => {
      const b = parse(zSimples.extend({ id: zUuid.optional() }), raw);
      return (tx as any)[model].create({ data: { ...(b.id ? { id: b.id } : {}), nome: b.nome, [campoAtivo]: b.ativo ?? true } });
    },
    atualizar: (tx, id, raw) => {
      const b = parse(zSimples.partial(), raw);
      return (tx as any)[model].update({ where: { id }, data: { ...(b.nome ? { nome: b.nome } : {}), ...(b.ativo !== undefined ? { [campoAtivo]: b.ativo } : {}) } });
    },
    dto: (r) => ({ id: r.id, nome: r.nome, ativo: r[campoAtivo] }),
    nomeDuplicado: async (nome, ignorar) => !!(await m().findFirst({ where: { nome: { equals: nome, mode: 'insensitive' }, ...(ignorar ? { NOT: { id: ignorar } } : {}) } })),
  };
}

export const DEFINICOES: Record<string, Definicao> = {
  categorias, parceiros, campanhas,
  'motivos-descarte': simples('motivo_descarte', 'motivoDescarte', 'ativo'),
  'motivos-baixa': simples('motivo_baixa', 'motivoBaixa', 'ativo'),
  'categorias-despesa': simples('categoria_despesa', 'categoriaDespesa', 'ativa'),
};

export async function rotasCadastros(app: FastifyInstance) {
  for (const [tipo, def] of Object.entries(DEFINICOES)) {
    app.get(`/${tipo}`, { config: { acesso: LEITURA } }, async (req) => {
      const f = parse(zFiltro, req.query);
      return (await def.listar(f)).map(def.dto);
    });

    app.post(`/${tipo}`, { config: { acesso: ['cadastros.gerenciar'] } }, async (req, reply) => {
      const u = exigirUsuario(req);
      const nome = String((req.body as AnyRow | null)?.nome ?? '').trim();
      const id = (req.body as AnyRow | null)?.id;
      // Idempotente: o mesmo id reenviado devolve o registro já criado
      if (typeof id === 'string' && zUuid.safeParse(id).success) {
        const existente = await def.obter(id);
        if (existente) return reply.code(200).send(def.dto(existente));
      }
      if (nome && (await def.nomeDuplicado(nome))) conflito('NOME_DUPLICADO', 'Já existe um cadastro com este nome');
      const r = await prisma.$transaction(async (tx) => {
        const novo = await def.criar(tx, req.body);
        await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CADASTRO_CRIADO', def.entidade, novo.id);
        return novo;
      });
      return reply.code(201).send(def.dto(r));
    });

    app.patch(`/${tipo}/:id`, { config: { acesso: ['cadastros.gerenciar'] } }, async (req) => {
      const u = exigirUsuario(req);
      const { id } = parse(zIdParam, req.params);
      const atual = await def.obter(id);
      if (!atual) naoEncontrado();
      const nome = String((req.body as AnyRow | null)?.nome ?? '').trim();
      if (nome && (await def.nomeDuplicado(nome, id))) conflito('NOME_DUPLICADO', 'Já existe um cadastro com este nome');
      const r = await prisma.$transaction(async (tx) => {
        const novo = await def.atualizar(tx, id, req.body, atual!);
        await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'CADASTRO_ALTERADO', def.entidade, id, def.dto(atual!) as AnyRow, def.dto(novo) as AnyRow);
        return novo;
      });
      return def.dto(r);
    });
  }
}
