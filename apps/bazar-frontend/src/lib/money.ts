/**
 * Dinheiro trafega como string decimal com 2 casas ("12.50"), nunca float (seção 5).
 * Internamente o front calcula em centavos inteiros para evitar erro de arredondamento.
 * Atenção: todo valor calculado aqui é só para EXIBIÇÃO — o servidor recalcula tudo.
 */
export type Money = string;

/** "12.50" | "12,50" | "12" -> 1250. Lança erro se o formato for inválido. */
export function toCents(value: Money | number): number {
  if (typeof value === 'number') return Math.round(value * 100);
  const s = value.trim().replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Valor monetário inválido: ${value}`);
  const neg = s.startsWith('-');
  const [int, dec = ''] = s.replace('-', '').split('.');
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'));
  return neg ? -cents : cents;
}

/** 1250 -> "12.50" (formato do contrato da API). */
export function fromCents(cents: number): Money {
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Tenta converter; retorna null em vez de lançar (útil em inputs). */
export function tryCents(value: string): number | null {
  try { return value.trim() === '' ? null : toCents(value); } catch { return null; }
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** Exibição: "R$ 12,50". */
export function formatMoney(value: Money | number): string {
  const cents = typeof value === 'number' ? value : toCents(value);
  return brl.format(cents / 100);
}
