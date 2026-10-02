/** CXA — cálculo do fechamento (RN-19) e utilitários de caixa. */
import type { Db } from '../../lib/prisma.js';
import { fromCents, money, moneyOpt, toCents } from '../../lib/money.js';
import { AppError } from '../../lib/errors.js';

export const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO'] as const;
export type Forma = (typeof FORMAS)[number];

/**
 * RN-19: dinheiro esperado = fundo de troco + vendas em dinheiro (já líquidas de troco)
 *  + recebimentos de fiado em dinheiro feitos neste caixa e não estornados + suprimentos − sangrias.
 */
export async function calcularPrevia(db: Db, caixaId: string) {
  const cx = await db.caixaSessao.findUniqueOrThrow({ where: { id: caixaId }, select: { valorAbertura: true, terminalId: true } });
  const porForma = await db.$queryRaw<{ forma: Forma; total: string }[]>`
    SELECT p.forma::text AS forma, sum(p.valor)::text AS total
    FROM venda_pagamento p JOIN venda v ON v.id = p.venda_id
    WHERE v.sessao_id = ${caixaId}::uuid AND v.status = 'FINALIZADA' GROUP BY p.forma`;
  const qtdVendas = await db.venda.count({ where: { sessaoId: caixaId, status: 'FINALIZADA' } });
  const receb = await db.recebimento.aggregate({ where: { sessaoId: caixaId, estornadoEm: null, forma: 'DINHEIRO' }, _sum: { valor: true } });
  const lanc = await db.caixaLancamento.groupBy({ by: ['tipo'], where: { sessaoId: caixaId }, _sum: { valor: true } });
  const pendencias = await db.pendenciaSincronizacao.count({ where: { terminalId: cx.terminalId, status: 'PENDENTE' } });

  const totais = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<Forma, number>;
  for (const r of porForma) totais[r.forma] = toCents(Number(r.total).toFixed(2));
  const sup = toCents(lanc.find((l) => l.tipo === 'SUPRIMENTO')?._sum.valor ?? null);
  const sang = toCents(lanc.find((l) => l.tipo === 'SANGRIA')?._sum.valor ?? null);
  const esperado = toCents(cx.valorAbertura) + totais.DINHEIRO + toCents(receb._sum.valor ?? null) + sup - sang;
  return {
    esperadoCents: esperado,
    dto: {
      fundoTroco: money(cx.valorAbertura), suprimentos: fromCents(sup), sangrias: fromCents(sang),
      totaisPorForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(totais[f])])) as Record<Forma, string>,
      esperadoDinheiro: fromCents(esperado), quantidadeVendas: qtdVendas,
      filaPendente: pendencias,
    },
  };
}

/** Caixa aberto do operador (para sangria automática de reembolso/pagamento). */
export async function caixaAbertoDoOperador(db: Db, usuarioId: string) {
  return db.caixaSessao.findFirst({ where: { abertoPorId: usuarioId, status: 'ABERTO' } });
}

/** Registra sangria conferindo que há dinheiro suficiente no caixa. */
export async function registrarSangria(db: Db, caixaId: string, usuarioId: string, valorCents: number, motivo: string, id?: string) {
  const { esperadoCents } = await calcularPrevia(db, caixaId);
  if (valorCents > esperadoCents) {
    throw new AppError(409, 'Sangria maior que o dinheiro em caixa', 'SANGRIA_ACIMA_SALDO', `Disponível: ${fromCents(Math.max(0, esperadoCents))}`);
  }
  return db.caixaLancamento.create({
    data: { ...(id ? { id } : {}), sessaoId: caixaId, tipo: 'SANGRIA', valor: fromCents(valorCents), motivo: motivo.slice(0, 300), usuarioId },
  });
}

type CaixaRow = {
  id: string; terminalId: string; status: 'ABERTO' | 'FECHADO'; abertoEm: Date; valorAbertura: { toFixed(n: number): string };
  fechadoEm: Date | null; valorEsperado: { toFixed(n: number): string } | null; valorContado: { toFixed(n: number): string } | null;
  diferenca: { toFixed(n: number): string } | null; observacao: string | null; terminal: { nome: string };
};
export const caixaDto = (c: CaixaRow, operadorNome: string) => ({
  id: c.id, terminalId: c.terminalId, terminalNome: c.terminal.nome, operadorNome,
  abertoEm: c.abertoEm.toISOString(), fundoTroco: money(c.valorAbertura), status: c.status,
  fechadoEm: c.fechadoEm?.toISOString(), esperado: moneyOpt(c.valorEsperado), contado: moneyOpt(c.valorContado),
  diferenca: moneyOpt(c.diferenca), observacao: c.observacao ?? undefined,
});
