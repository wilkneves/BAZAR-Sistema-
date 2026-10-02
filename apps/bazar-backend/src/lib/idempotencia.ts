import type { Tx } from './prisma.js';

/**
 * Reserva a chave de idempotência dentro da transação. Retorna false se já foi usada
 * (a operação já aconteceu — o chamador responde sucesso sem repetir).
 * Chave de outro usuário/escopo não "vaza" nada: só diz que já existe.
 */
export async function reservarChave(tx: Tx, chave: string, escopo: string, usuarioId: string): Promise<boolean> {
  const r = await tx.$executeRaw`INSERT INTO idempotencia (chave, escopo, usuario_id) VALUES (${chave}::uuid, ${escopo}, ${usuarioId}::uuid) ON CONFLICT (chave) DO NOTHING`;
  return r === 1;
}
