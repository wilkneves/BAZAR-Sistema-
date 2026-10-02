/** FIS — regras de imposto versionadas por vigência (RF-FIS-01, RN-17). Nunca apaga nem edita regra gravada. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, conflito } from '../../lib/errors.js';
import { parse, zData, zMoney, zUuid } from '../../lib/http.js';
import { auditar } from '../../lib/audit.js';
import { addDias, fromDbDate, toDbDate } from '../../lib/dates.js';
import { exigirUsuario } from '../../plugins/auth.js';
import { incluirAlvoRegra, regraDto } from './fiscal.service.js';

const zRegra = z.object({
  id: zUuid.optional(),
  alvo: z.enum(['GERAL', 'CATEGORIA', 'ITEM']),
  alvoId: zUuid.optional(),
  situacao: z.enum(['ISENTO', 'TRIBUTADO']),
  aliquota: zMoney.refine((v) => Number(v) <= 100, 'alíquota de 0 a 100'),
  vigenciaInicio: zData,
  fundamentoLegal: z.string().trim().max(300).optional(),
}).superRefine((r, ctx) => {
  if (r.alvo === 'GERAL' && r.alvoId) ctx.addIssue({ code: 'custom', path: ['alvoId'], message: 'regra geral não tem alvo' });
  if (r.alvo !== 'GERAL' && !r.alvoId) ctx.addIssue({ code: 'custom', path: ['alvoId'], message: 'informe a categoria ou o item' });
  if (r.situacao === 'ISENTO' && Number(r.aliquota) !== 0) ctx.addIssue({ code: 'custom', path: ['aliquota'], message: 'isento tem alíquota 0' });
  if (r.situacao === 'TRIBUTADO' && Number(r.aliquota) <= 0) ctx.addIssue({ code: 'custom', path: ['aliquota'], message: 'tributado exige alíquota maior que 0' });
});

export async function rotasFiscal(app: FastifyInstance) {
  app.get('/regras-fiscais', { config: { acesso: ['fiscal.gerenciar'] } }, async () => {
    const rs = await prisma.regraFiscal.findMany({ include: incluirAlvoRegra, orderBy: [{ escopo: 'asc' }, { vigenciaInicio: 'desc' }] });
    return rs.map(regraDto);
  });

  app.post('/regras-fiscais', { config: { acesso: ['fiscal.gerenciar'] } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const b = parse(zRegra, req.body);
    if (b.alvo === 'CATEGORIA' && !(await prisma.categoria.findUnique({ where: { id: b.alvoId! } }))) throw new AppError(400, 'Categoria inexistente', 'VALIDACAO');
    if (b.alvo === 'ITEM' && !(await prisma.item.findUnique({ where: { id: b.alvoId! } }))) throw new AppError(400, 'Item inexistente', 'VALIDACAO');
    const alvo = { escopo: b.alvo, categoriaId: b.alvo === 'CATEGORIA' ? b.alvoId! : null, itemId: b.alvo === 'ITEM' ? b.alvoId! : null };
    const r = await prisma.$transaction(async (tx) => {
      // serializa criações para o mesmo alvo
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'regra:' + b.alvo + ':' + (b.alvoId ?? '-')}))`;
      const anterior = await tx.regraFiscal.findFirst({ where: { ...alvo, vigenciaFim: null } });
      if (anterior) {
        if (fromDbDate(anterior.vigenciaInicio) >= b.vigenciaInicio) {
          conflito('VIGENCIA_SOBREPOSTA', 'A nova vigência deve começar depois do início da regra atual');
        }
        // encerra a anterior no dia anterior ao início da nova (vigências nunca se sobrepõem)
        await tx.regraFiscal.update({ where: { id: anterior.id }, data: { vigenciaFim: toDbDate(addDias(b.vigenciaInicio, -1)) } });
      }
      const n = await tx.regraFiscal.create({
        data: { ...(b.id ? { id: b.id } : {}), ...alvo, situacao: b.situacao, aliquota: b.aliquota, vigenciaInicio: toDbDate(b.vigenciaInicio), fundamentoLegal: b.fundamentoLegal ?? null, criadaPorId: u.id },
        include: incluirAlvoRegra,
      });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'REGRA_FISCAL_CRIADA', 'regra_fiscal', n.id,
        anterior ? { regraAnterior: anterior.id } : undefined, { alvo: b.alvo, alvoId: b.alvoId, situacao: b.situacao, aliquota: b.aliquota, vigenciaInicio: b.vigenciaInicio });
      return n;
    });
    return reply.code(201).send(regraDto(r));
  });
}
