/**
 * RN-31 / RNF-14: instantes em timestamptz; filtros "por dia" usam a data local de America/Fortaleza.
 * Fortaleza não tem horário de verão desde 1990 (UTC−03:00 fixo), mas usamos Intl para formatar
 * e montamos limites com o offset explícito.
 */
export const TZ = 'America/Fortaleza';
const OFFSET = '-03:00';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date -> "aaaa-mm-dd" na data local. */
export function localDate(d: Date = new Date()): string {
  return fmt.format(d);
}

/** Início do dia local (inclusive) como instante. */
export function inicioDoDia(dia: string): Date {
  return new Date(`${dia}T00:00:00.000${OFFSET}`);
}
/** Início do dia seguinte (exclusivo). */
export function fimDoDiaExclusivo(dia: string): Date {
  const d = inicioDoDia(dia);
  return new Date(d.getTime() + 86_400_000);
}

/** Filtro Prisma de período { gte, lt } a partir de de/ate locais (opcionais). */
export function periodo(de?: string, ate?: string): { gte?: Date; lt?: Date } | undefined {
  if (!de && !ate) return undefined;
  const r: { gte?: Date; lt?: Date } = {};
  if (de) r.gte = inicioDoDia(de);
  if (ate) r.lt = fimDoDiaExclusivo(ate);
  return r;
}

/** Coluna `date` do Postgres: "aaaa-mm-dd" <-> Date UTC meia-noite. */
export function toDbDate(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDias(dia: string, n: number): string {
  return fromDbDate(new Date(toDbDate(dia).getTime() + n * 86_400_000));
}
