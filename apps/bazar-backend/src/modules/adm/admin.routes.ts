/** ADM / PRV — parâmetros, importação de cadastros e direitos do titular (LGPD) (RF-ADM-01/02, RF-PRV-02/03). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, conflito, naoEncontrado } from '../../lib/errors.js';
import { parse, zMotivo, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { lerPlanilha } from '../../lib/planilha.js';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { money } from '../../lib/money.js';
import { exigirUsuario } from '../../plugins/auth.js';
import { FINALIDADE_CLIENTE, VERSAO_AVISO } from '../cad/clientes.routes.js';

const TIPOS_PARAM: Record<string, { tipo: 'number' | 'text'; min?: number; max?: number; vazio?: boolean }> = {
  'fiado.prazo_dias': { tipo: 'number', min: 1, max: 365, vazio: true },
  'alerta.vencimento_dias': { tipo: 'number', min: 0, max: 60 },
  'sessao.timeout_min': { tipo: 'number', min: 5, max: 480 },
  'senha.tamanho_minimo': { tipo: 'number', min: 8, max: 64 },
  'anexo.tamanho_max_mb': { tipo: 'number', min: 1, max: 10 },
  'pdv.max_horas_sem_sync': { tipo: 'number', min: 1, max: 72 },
};

export async function rotasAdmin(app: FastifyInstance) {
  // ---------------- parâmetros ----------------
  const listar = async () => (await prisma.parametro.findMany({ orderBy: { chave: 'asc' } }))
    .map((p) => ({ chave: p.chave, valor: p.valor, descricao: p.descricao ?? '', tipo: TIPOS_PARAM[p.chave]?.tipo ?? 'text' }));

  app.get('/parametros', { config: { acesso: ['parametros.gerenciar'] } }, listar);

  app.put('/parametros', { config: { acesso: ['parametros.gerenciar'] } }, async (req) => {
    const u = exigirUsuario(req);
    const b = parse(z.object({ valores: z.array(z.object({ chave: z.string().max(60), valor: z.string().trim().max(200) })).max(50) }), req.body);
    for (const v of b.valores) {
      const def = TIPOS_PARAM[v.chave];
      if (!def) throw new AppError(400, `Parâmetro desconhecido: ${v.chave}`, 'VALIDACAO');
      if (v.valor === '' && def.vazio) continue;
      const n = Number(v.valor);
      if (def.tipo === 'number' && (!/^\d+$/.test(v.valor) || n < (def.min ?? 0) || n > (def.max ?? Infinity))) {
        throw new AppError(400, `Valor inválido para ${v.chave} (${def.min} a ${def.max})`, 'VALIDACAO');
      }
    }
    await prisma.$transaction(async (tx) => {
      for (const v of b.valores) {
        const antes = await tx.parametro.findUnique({ where: { chave: v.chave } });
        await tx.parametro.update({ where: { chave: v.chave }, data: { valor: v.valor } });
        await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'PARAMETRO_ALTERADO', 'parametro', v.chave, { valor: antes?.valor }, { valor: v.valor });
      }
    });
    return listar();
  });

  // ---------------- importação de cadastros (RF-ADM-01) ----------------
  app.post('/importacoes/:tipo', { config: { acesso: ['cadastros.gerenciar'], rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const u = exigirUsuario(req);
    const { tipo } = parse(z.object({ tipo: z.enum(['categorias', 'parceiros', 'campanhas', 'clientes']) }), req.params);
    if (tipo === 'clientes' && !u.permissoes.has('clientes.gerenciar')) throw new AppError(403, 'Importar clientes exige permissão de clientes', 'SEM_PERMISSAO');
    const arq = await req.file();
    if (!arq || arq.fieldname !== 'arquivo') throw new AppError(400, 'Arquivo obrigatório (campo "arquivo")', 'ARQUIVO_OBRIGATORIO');
    const pl = await lerPlanilha(await arq.toBuffer());
    if (!pl.cabecalho.includes('nome')) throw new AppError(400, 'Planilha fora do modelo', 'PLANILHA_INVALIDA', 'Coluna obrigatória ausente: nome');

    const existentes = new Set<string>((tipo === 'categorias' ? await prisma.categoria.findMany({ select: { nome: true } })
      : tipo === 'parceiros' ? await prisma.parceiro.findMany({ select: { nome: true } })
      : tipo === 'campanhas' ? await prisma.campanha.findMany({ select: { nome: true } })
      : await prisma.cliente.findMany({ where: { anonimizadoEm: null }, select: { nome: true } })).map((x) => x.nome.trim().toLowerCase()));

    const erros: { linha: number; mensagem: string }[] = [];
    const duplicados: { linha: number; valor: string }[] = [];
    const novos: { linha: number; v: Record<string, string> }[] = [];
    const vistos = new Set<string>();
    for (const { numero, valores: v } of pl.linhas) {
      const nome = (v.nome ?? '').trim();
      const chave = nome.toLowerCase();
      const e: string[] = [];
      if (nome.length < 2 || nome.length > 120) e.push('Nome obrigatório (2 a 120 caracteres)');
      if (tipo === 'categorias' && v.preco_padrao && !/^\d{1,8}([.,]\d{1,2})?$/.test(v.preco_padrao)) e.push('Preço padrão inválido');
      if (tipo === 'clientes' && !/^\d{10,11}$/.test((v.telefone ?? '').replace(/\D/g, ''))) e.push('Telefone com DDD obrigatório');
      if (tipo === 'campanhas' && ((v.inicio && !/^\d{4}-\d{2}-\d{2}$/.test(v.inicio)) || (v.fim && !/^\d{4}-\d{2}-\d{2}$/.test(v.fim)))) e.push('Datas no formato aaaa-mm-dd');
      if (tipo === 'parceiros' && v.tipo && !['EMPRESA', 'LOJA', 'PESSOA_FISICA', 'OUTRO'].includes(v.tipo.toUpperCase())) e.push('Tipo deve ser EMPRESA, LOJA, PESSOA_FISICA ou OUTRO');
      if (e.length) { erros.push({ linha: numero, mensagem: e.join('; ') }); continue; }
      if (existentes.has(chave) || vistos.has(chave)) { duplicados.push({ linha: numero, valor: nome.slice(0, 120) }); continue; }
      vistos.add(chave);
      novos.push({ linha: numero, v });
    }
    // Tudo ou nada nos erros; duplicados não são inseridos e voltam para decisão
    if (erros.length) return { gravado: false, inseridos: 0, duplicados, erros: erros.slice(0, 500) };

    await prisma.$transaction(async (tx) => {
      for (const { v } of novos) {
        const nome = v.nome!.trim();
        if (tipo === 'categorias') {
          await tx.categoria.create({ data: { nome, precoPadrao: v.preco_padrao ? v.preco_padrao.replace(',', '.') : null, vendaPorCategoria: /^(s|sim|true|1)$/i.test(v.venda_por_categoria ?? '') } });
        } else if (tipo === 'parceiros') {
          await tx.parceiro.create({ data: { nome, tipo: (v.tipo?.toUpperCase() as 'EMPRESA' | 'LOJA' | 'PESSOA_FISICA' | 'OUTRO') || 'OUTRO', cidade: v.cidade || null } });
        } else if (tipo === 'campanhas') {
          await tx.campanha.create({ data: { nome, dataInicio: v.inicio ? toDbDate(v.inicio) : null, dataFim: v.fim ? toDbDate(v.fim) : null } });
        } else {
          // Clientes importados: o consentimento registrado é o da planilha (ciência colhida na origem)
          await tx.cliente.create({ data: { nome, telefone: (v.telefone ?? '').replace(/\D/g, ''),
            consentimentos: { create: { titularTipo: 'CLIENTE', finalidade: FINALIDADE_CLIENTE, versaoAviso: `${VERSAO_AVISO}-importacao`, registradoPorId: u.id } } } });
        }
      }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'IMPORTACAO', tipo, '*', undefined, { inseridos: novos.length, duplicados: duplicados.length });
    }, { timeout: 120_000 });
    return { gravado: true, inseridos: novos.length, duplicados, erros: [] };
  });

  // ---------------- LGPD: direitos do titular (RF-PRV-02/03, RN-22) ----------------
  const zTitular = z.object({ tipo: z.enum(['cliente', 'parceiro']), id: zUuid });

  app.get('/titulares/:tipo/:id/exportar', { config: { acesso: ['privacidade.gerenciar'], rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { tipo, id } = parse(zTitular, req.params);
    let dados: unknown;
    if (tipo === 'cliente') {
      const c = await prisma.cliente.findUnique({ where: { id }, include: { consentimentos: true } });
      if (!c) naoEncontrado('Titular');
      const contas = await prisma.contaReceber.findMany({ where: { clienteId: id }, include: { recebimentos: true, venda: { select: { numero: true } } } });
      const vendas = await prisma.venda.findMany({ where: { clienteId: id }, select: { numero: true, ocorridaEm: true, total: true, status: true } });
      dados = {
        geradoEm: new Date().toISOString(), titular: { tipo: 'cliente', id: c!.id, nome: c!.nome, telefone: c!.telefone, documento: c!.documento, observacao: c!.observacao, ativo: c!.ativo, criadoEm: c!.criadoEm, anonimizadoEm: c!.anonimizadoEm },
        consentimentos: c!.consentimentos.map((x) => ({ finalidade: x.finalidade, versaoAviso: x.versaoAviso, registradoEm: x.registradoEm, revogadoEm: x.revogadoEm })),
        compras: vendas.map((v) => ({ numero: v.numero, data: v.ocorridaEm, total: money(v.total), status: v.status })),
        contasReceber: contas.map((x) => ({ vendaNumero: x.venda?.numero, descricao: x.descricao, valor: money(x.valor), vencimento: fromDbDate(x.vencimento), status: x.status,
          recebimentos: x.recebimentos.map((r) => ({ valor: money(r.valor), data: r.recebidoEm, estornado: !!r.estornadoEm })) })),
      };
    } else {
      const p = await prisma.parceiro.findUnique({ where: { id }, include: { consentimentos: true } });
      if (!p || p.tipo !== 'PESSOA_FISICA') naoEncontrado('Titular');
      const lotes = await prisma.loteEntrada.findMany({ where: { parceiroId: id }, select: { numero: true, tipo: true, recebidoEm: true } });
      dados = {
        geradoEm: new Date().toISOString(), titular: { tipo: 'parceiro', id: p!.id, nome: p!.nome, documento: p!.documento, telefone: p!.telefone, email: p!.email, cidade: p!.cidade, observacao: p!.observacao },
        consentimentos: p!.consentimentos.map((x) => ({ finalidade: x.finalidade, versaoAviso: x.versaoAviso, registradoEm: x.registradoEm, revogadoEm: x.revogadoEm })),
        doacoes: lotes,
      };
    }
    await auditar(prisma, { usuarioId: u.id, ip: req.ip }, 'TITULAR_EXPORTADO', tipo, id);
    return reply.header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="titular-${id}.json"`)
      .send(JSON.stringify(dados, null, 2));
  });

  app.post('/titulares/:tipo/:id/anonimizar', { config: { acesso: ['privacidade.gerenciar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { tipo, id } = parse(zTitular, req.params);
    const b = parse(z.object({ motivo: zMotivo, confirmar: z.boolean().default(false) }), req.body);
    await prisma.$transaction(async (tx) => {
      if (tipo === 'cliente') {
        const c = await tx.cliente.findUnique({ where: { id } });
        if (!c) naoEncontrado('Titular');
        if (c!.anonimizadoEm) conflito('JA_ANONIMIZADO', 'Titular já anonimizado');
        const debito = await tx.contaReceber.count({ where: { clienteId: id, status: { in: ['ABERTA', 'PARCIAL'] } } });
        if (debito && !b.confirmar) conflito('CLIENTE_COM_DEBITO', 'Cliente possui débito em aberto. Confirme para anonimizar mesmo assim.');
        // RN-22: remove o que identifica; vendas e lançamentos financeiros são preservados
        await tx.cliente.update({ where: { id }, data: { nome: `Titular anonimizado ${id.slice(-4)}`, telefone: '', documento: null, observacao: null, ativo: false, anonimizadoEm: new Date() } });
        await tx.consentimento.updateMany({ where: { clienteId: id, revogadoEm: null }, data: { revogadoEm: new Date() } });
      } else {
        const p = await tx.parceiro.findUnique({ where: { id } });
        if (!p || p.tipo !== 'PESSOA_FISICA') naoEncontrado('Titular');
        if (p!.nome.startsWith('Titular anonimizado')) conflito('JA_ANONIMIZADO', 'Titular já anonimizado');
        // a origem dos lotes continua (prestação de contas), sem identificar a pessoa
        await tx.parceiro.update({ where: { id }, data: { nome: `Titular anonimizado ${id.slice(-4)}`, documento: null, telefone: null, email: null, observacao: null, ativo: false } });
        await tx.consentimento.updateMany({ where: { parceiroId: id, revogadoEm: null }, data: { revogadoEm: new Date() } });
      }
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'TITULAR_ANONIMIZADO', tipo, id, undefined, { motivo: b.motivo, comDebitoConfirmado: b.confirmar });
    });
    return reply.code(204).send();
  });
}
