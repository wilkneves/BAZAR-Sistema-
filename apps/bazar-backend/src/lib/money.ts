/**
 * Dinheiro: no contrato é string "12.50" (nunca float); nas contas, centavos inteiros.
 */
type DecimalLike = { toFixed(d: number): string };

export function toCents(v: string | number | DecimalLike | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('valor monetário inválido');
    return Math.round(v * 100);
  }
  const s = typeof v === 'string' ? v.trim() : v.toFixed(2);
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(s)) throw new Error('valor monetário inválido');
  const neg = s.startsWith('-');
  const [i, d = ''] = s.replace('-', '').split('.');
  const c = Number(i) * 100 + Number(d.padEnd(2, '0'));
  return neg ? -c : c;
}

export function fromCents(c: number): string {
  const neg = c < 0;
  const a = Math.abs(Math.trunc(c));
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Decimal do Prisma (ou null) -> "12.50" */
export function money(v: DecimalLike | null | undefined): string {
  return v === null || v === undefined ? '0.00' : v.toFixed(2);
}
export function moneyOpt(v: DecimalLike | null | undefined): string | undefined {
  return v === null || v === undefined ? undefined : v.toFixed(2);
}

/** Regex do contrato para Money em entrada (até 2 casas, sem sinal). */
export const MONEY_RE = /^\d{1,8}(\.\d{1,2})?$/;
