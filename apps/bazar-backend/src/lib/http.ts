/** Utilitários de requisição: validação Zod, paginação e esquemas comuns. */
import { z, type ZodType } from 'zod';
import { zodParaAppError } from './errors.js';
import { DATE_RE } from './dates.js';
import { MONEY_RE } from './money.js';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw zodParaAppError(r.error);
  return r.data;
}

export const zUuid = z.string().uuid('id inválido');
export const zData = z.string().regex(DATE_RE, 'data no formato aaaa-mm-dd');
export const zMoney = z.string().trim().regex(MONEY_RE, 'valor no formato 12.50');
export const zTexto = (max = 200) => z.string().trim().min(1, 'obrigatório').max(max);
export const zMotivo = z.string().trim().min(5, 'mínimo de 5 caracteres').max(500);
export const zBoolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const zIdParam = z.object({ id: zUuid });

export const zPage = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const zPeriodo = z.object({ de: zData.optional(), ate: zData.optional() });

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }
export const page = <T>(items: T[], p: { page: number; pageSize: number }, total: number): Page<T> =>
  ({ items, page: p.page, pageSize: p.pageSize, total });
export const skipTake = (p: { page: number; pageSize: number }) => ({ skip: (p.page - 1) * p.pageSize, take: p.pageSize });

/** Escapa curingas de LIKE para busca textual. */
export const likeSeguro = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
