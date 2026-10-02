/**
 * Trilha de auditoria (RF-ACS-06, RN-29): só identificadores e campos NÃO pessoais.
 * Campos pessoais são removidos aqui mesmo que o chamador os envie por engano.
 */
import type { Db } from './prisma.js';

const PESSOAIS = new Set(['nome', 'telefone', 'documento', 'email', 'senha', 'senhaHash', 'senha_hash', 'login', 'observacao', 'cpf', 'cnpj', 'endereco']);

function limpar(o: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!o) return undefined;
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (PESSOAIS.has(k) || v === undefined) continue;
    r[k] = typeof v === 'object' && v !== null && 'toFixed' in v ? (v as { toFixed(n: number): string }).toFixed(2)
      : v instanceof Date ? v.toISOString() : v;
  }
  return r;
}

export interface AuditCtx { usuarioId: string | null; ip?: string | undefined }

export async function auditar(
  db: Db, ctx: AuditCtx, acao: string, entidade: string, entidadeId: string,
  antes?: Record<string, unknown>, depois?: Record<string, unknown>,
): Promise<void> {
  await db.auditoria.create({
    data: {
      usuarioId: ctx.usuarioId, acao, entidade, entidadeId,
      antes: (limpar(antes) ?? undefined) as never, depois: (limpar(depois) ?? undefined) as never,
      ip: ctx.ip ?? null,
    },
  });
}
