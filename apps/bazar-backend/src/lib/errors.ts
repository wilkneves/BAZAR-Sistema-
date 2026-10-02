/**
 * Erros no formato RFC 9457 (application/problem+json), com `code` de negócio e `requestId`.
 * Nunca expõe stack trace, SQL ou mensagem interna ao cliente.
 */
import { ZodError } from 'zod';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code?: string;
  detail?: string;
  requestId?: string;
  errors?: { campo?: string; linha?: number; mensagem: string }[];
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly code?: string,
    public readonly detail?: string,
    public readonly errors?: ProblemDetails['errors'],
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }
}

export const falha = (status: number, title: string, code?: string, detail?: string): never => {
  throw new AppError(status, title, code, detail);
};
export const naoEncontrado = (oque = 'Registro'): never => falha(404, `${oque} não encontrado`, 'NAO_ENCONTRADO');
export const conflito = (code: string, title: string, detail?: string): never => falha(409, title, code, detail);
export const proibido = (title = 'Você não tem permissão para esta ação', code = 'SEM_PERMISSAO'): never => falha(403, title, code);
export const invalido = (campo: string, mensagem: string): never => {
  throw new AppError(400, 'Dados inválidos', 'VALIDACAO', `${campo}: ${mensagem}`, [{ campo, mensagem }]);
};

/** Mensagens das regras do banco ('CODIGO|texto') que podem chegar ao usuário. */
const RE_REGRA_BANCO = /([A-Z][A-Z_]{3,})\|([^"\\\n]{1,300})/;

/** Índices únicos -> código de negócio amigável. */
const UNICOS: Record<string, [string, string]> = {
  ux_caixa_aberto_por_terminal: ['CAIXA_JA_ABERTO', 'Já existe caixa aberto neste terminal'],
  ux_caixa_aberto_por_operador: ['CAIXA_JA_ABERTO', 'Você já tem um caixa aberto'],
  ux_categoria_nome: ['NOME_DUPLICADO', 'Já existe um cadastro com este nome'],
  ux_campanha_nome: ['NOME_DUPLICADO', 'Já existe um cadastro com este nome'],
  usuario_login_key: ['LOGIN_DUPLICADO', 'Login já existe'],
  terminal_nome_key: ['NOME_DUPLICADO', 'Já existe um terminal com este nome'],
  perfil_nome_key: ['NOME_DUPLICADO', 'Já existe um perfil com este nome'],
  motivo_descarte_nome_key: ['NOME_DUPLICADO', 'Já existe um motivo com este nome'],
  motivo_baixa_nome_key: ['NOME_DUPLICADO', 'Já existe um motivo com este nome'],
  categoria_despesa_nome_key: ['NOME_DUPLICADO', 'Já existe uma categoria com este nome'],
  ux_regra_vigente: ['VIGENCIA_SOBREPOSTA', 'Já existe regra vigente para este alvo'],
};

function textoProfundo(e: unknown, prof = 0): string {
  if (!e || prof > 4) return '';
  if (typeof e === 'string') return e;
  if (typeof e !== 'object') return '';
  const o = e as Record<string, unknown>;
  let s = typeof o.message === 'string' ? o.message : '';
  try { s += ' ' + JSON.stringify(o.meta ?? {}); } catch { /* ignora */ }
  if ('cause' in o) s += ' ' + textoProfundo(o.cause, prof + 1);
  if ('originalMessage' in o) s += ' ' + String(o.originalMessage);
  return s;
}

/** Converte erros do banco/Prisma em AppError quando forem regra de negócio conhecida. */
export function traduzirErroBanco(e: unknown): AppError | null {
  if (e instanceof AppError) return e;
  const txt = textoProfundo(e);
  const regra = RE_REGRA_BANCO.exec(txt);
  if (regra) return new AppError(409, 'Operação recusada pela regra de negócio', regra[1], regra[2]!.trim());
  const code = (e as { code?: string })?.code;
  if (code === 'P2002' || /unique constraint|duplicate key|23505/i.test(txt)) {
    for (const [idx, [c, t]] of Object.entries(UNICOS)) if (txt.includes(idx)) return new AppError(409, t, c);
    return new AppError(409, 'Registro duplicado', 'DUPLICADO');
  }
  if (code === 'P2025') return new AppError(404, 'Registro não encontrado', 'NAO_ENCONTRADO');
  if (code === 'P2003' || /foreign key|23503/i.test(txt)) return new AppError(400, 'Referência inválida', 'REFERENCIA_INVALIDA');
  if (/23514|check constraint/i.test(txt)) return new AppError(409, 'Operação recusada pela regra de negócio', 'REGRA_BANCO');
  if (/40001|40P01|could not serialize|deadlock/i.test(txt)) return new AppError(409, 'Conflito de concorrência, tente novamente', 'CONCORRENCIA');
  return null;
}

export function zodParaAppError(err: ZodError): AppError {
  const errors = err.issues.slice(0, 20).map((i) => ({ campo: i.path.join('.') || '(corpo)', mensagem: i.message }));
  return new AppError(400, 'Dados inválidos', 'VALIDACAO', errors.map((x) => `${x.campo}: ${x.mensagem}`).join('; '), errors);
}
