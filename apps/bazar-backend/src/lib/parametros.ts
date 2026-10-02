import type { Db } from './prisma.js';

/** Lê um parâmetro numérico; valor vazio/ausente => padrão. */
export async function paramNum(db: Db, chave: string, padrao: number): Promise<number> {
  const p = await db.parametro.findUnique({ where: { chave } });
  const n = p && p.valor.trim() !== '' ? Number(p.valor) : NaN;
  return Number.isFinite(n) ? n : padrao;
}
