/**
 * API SIMULADA — roteador em memória que imita o Fastify da seção 5.
 * Comportamentos imitados de propósito, para o front lidar com eles desde já:
 *  - toda rota declara permissão; rota sem declaração = 403 (fail secure);
 *  - 401 com token expirado (access de 15 min) e refresh com rotação;
 *  - bloqueio após 5 senhas erradas (429), mensagem genérica no login;
 *  - erros RFC 9457 com requestId e `code` de negócio (409);
 *  - PUT /vendas/:id idempotente, PEPS na venda por categoria, saldo nunca negativo;
 *  - caixaId/terminalId conferidos contra a sessão (anti-IDOR).
 * NADA disto vai para o build de produção (ver main.tsx).
 */
import type { Transport, TransportRequest, TransportResponse } from '../api/http';
import type {
  CatalogoPdv, ContaReceber, FormaPagamento, HistoricoEvento, ItemEstoque, LocalEstoque, Me, Permissao,
  ProblemDetails, RelatorioResposta, SyncLoteRequest, Venda, VendaRequest,
} from '../api/types';
import { PERMISSOES } from '../api/types';
import { fromCents, toCents } from '../lib/money';
import { db, FORMAS, type CaixaDb, type ItemDb, type UsuarioDb, type VendaDb } from './db';

// ---------------- infraestrutura ----------------
type Ctx = { user: UsuarioDb; params: Record<string, string>; query: URLSearchParams; body: any; headers: Record<string, string> };
type Handler = (c: Ctx) => TransportResponse | Promise<TransportResponse>;
type Regra = Permissao[] | 'publica' | 'autenticado';
const rotas: { method: string; re: RegExp; keys: string[]; regra: Regra; h: Handler }[] = [];

function rota(method: string, path: string, regra: Regra, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  rotas.push({ method, re, keys, regra, h });
}
const uid = (): string => crypto.randomUUID();
const now = () => new Date().toISOString();
const ok = (body: unknown, status = 200, headers: Record<string, string> = {}): TransportResponse =>
  ({ status, headers: { 'content-type': 'application/json', ...headers }, body });
function problem(status: number, title: string, code?: string, detail?: string, errors?: ProblemDetails['errors']): TransportResponse {
  return { status, headers: { 'content-type': 'application/problem+json' }, body: { type: `https://bazar.local/erros/${code ?? status}`, title, status, code, detail, errors, requestId: uid().slice(0, 8) } satisfies ProblemDetails };
}
class Falha extends Error { constructor(public r: TransportResponse) { super('falha'); } }
function falha(status: number, title: string, code?: string, detail?: string): never { throw new Falha(problem(status, title, code, detail)); }
function exigir(cond: unknown, campo: string): void { if (!cond) falha(400, 'Dados inválidos', 'VALIDACAO', `Campo obrigatório ou inválido: ${campo}`); }
function paginar<T>(arr: T[], q: URLSearchParams) {
  const page = Math.max(1, Number(q.get('page') ?? 1));
  const pageSize = Math.min(100, Number(q.get('pageSize') ?? 20));
  return { items: arr.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: arr.length };
}
const perfilDe = (u: UsuarioDb) => db.perfis.find((p) => p.id === u.perfilId)!;
const nomeUser = (id: string) => db.usuarios.find((u) => u.id === id)?.nome ?? '—';
function auditar(user: UsuarioDb, acao: string, entidade: string, entidadeId: string) {
  // Sem PII: só ids e nome de ação (RN-29).
  db.auditoria.unshift({ id: uid(), ocorridoEm: now(), usuarioNome: user.nome, acao, entidade, entidadeId });
}
const localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date(iso));
const noPeriodo = (iso: string, q: URLSearchParams) => {
  const d = localDate(iso);
  return (!q.get('de') || d >= q.get('de')!) && (!q.get('ate') || d <= q.get('ate')!);
};

// ---------------- sessão / tokens ----------------
const ACCESS_TTL = 15 * 60_000;
const access = new Map<string, { userId: string; exp: number }>();
const refresh = new Map<string, { userId: string; familia: string; usado: boolean }>();
/** Simula o cookie HttpOnly: o JS da aplicação NUNCA acessa esta variável. */
let cookieRefresh: string | null = null;
const tentativas = new Map<string, { erros: number; bloqueadoAte: number }>();

function emitirTokens(userId: string, familia = uid()) {
  const at = 'mock.' + uid();
  access.set(at, { userId, exp: Date.now() + ACCESS_TTL });
  const rt = uid();
  refresh.set(rt, { userId, familia, usado: false });
  cookieRefresh = rt;
  return { accessToken: at, expiresIn: ACCESS_TTL / 1000 };
}
function meDe(u: UsuarioDb): Me {
  const p = perfilDe(u);
  return { id: u.id, nome: u.nome, login: u.login, perfil: { id: p.id, nome: p.nome }, permissoes: p.permissoes, limiteDesconto: p.limiteDesconto, trocarSenha: u.trocarSenha };
}

rota('POST', '/auth/login', 'publica', ({ body }) => {
  const login = String(body?.login ?? '').trim().toLowerCase();
  const t = tentativas.get(login) ?? { erros: 0, bloqueadoAte: 0 };
  if (t.bloqueadoAte > Date.now()) return problem(429, 'Muitas tentativas. Tente novamente em alguns minutos.', 'LOGIN_BLOQUEADO');
  const u = db.usuarios.find((x) => x.login === login && x.ativo);
  if (!u || u.senha !== body?.senha) {
    t.erros++;
    if (t.erros >= 5) { t.bloqueadoAte = Date.now() + 10 * 60_000; t.erros = 0; }
    tentativas.set(login, t);
    return problem(401, 'Login ou senha inválidos', 'CREDENCIAIS_INVALIDAS'); // mensagem genérica
  }
  tentativas.delete(login);
  return ok({ ...emitirTokens(u.id), usuario: meDe(u) });
});
rota('POST', '/auth/refresh', 'publica', () => {
  const r = cookieRefresh ? refresh.get(cookieRefresh) : undefined;
  if (!r) return problem(401, 'Sessão expirada', 'SESSAO_EXPIRADA');
  if (r.usado) { // reuso de token antigo => revoga a família inteira
    for (const [k, v] of refresh) if (v.familia === r.familia) refresh.delete(k);
    cookieRefresh = null;
    return problem(401, 'Sessão revogada', 'REFRESH_REUTILIZADO');
  }
  r.usado = true;
  return ok(emitirTokens(r.userId, r.familia));
});
rota('POST', '/auth/logout', 'autenticado', ({ headers }) => {
  access.delete(headers.authorization?.replace('Bearer ', '') ?? '');
  if (cookieRefresh) refresh.delete(cookieRefresh);
  cookieRefresh = null;
  return { status: 204, headers: {}, body: null };
});
rota('PUT', '/auth/senha', 'autenticado', ({ user, body }) => {
  if (user.senha !== body?.senhaAtual) return problem(400, 'Senha atual incorreta', 'SENHA_ATUAL_INVALIDA');
  const nova = String(body?.novaSenha ?? '');
  if (nova.length < 8 || nova === body.senhaAtual) return problem(400, 'A nova senha deve ter no mínimo 8 caracteres e ser diferente da atual', 'SENHA_FRACA');
  user.senha = nova; user.trocarSenha = false;
  auditar(user, 'SENHA_ALTERADA', 'usuario', user.id);
  return { status: 204, headers: {}, body: null };
});
rota('GET', '/me', 'autenticado', ({ user }) => ok(meDe(user)));

// ---------------- ACS: usuários, perfis, auditoria ----------------
const usuarioDto = (u: UsuarioDb) => ({ id: u.id, nome: u.nome, login: u.login, perfilId: u.perfilId, perfilNome: perfilDe(u).nome, ativo: u.ativo });
const senhaProvisoria = () => 'Tmp-' + uid().slice(0, 8);
rota('GET', '/usuarios', ['usuarios.gerenciar'], ({ query }) => {
  const b = (query.get('busca') ?? '').toLowerCase();
  return ok(paginar(db.usuarios.filter((u) => (!b || u.nome.toLowerCase().includes(b) || u.login.includes(b)) && (query.get('ativo') === null || String(u.ativo) === query.get('ativo'))).map(usuarioDto), query));
});
rota('POST', '/usuarios', ['usuarios.gerenciar'], ({ user, body }) => {
  exigir(body?.nome, 'nome'); exigir(body?.login, 'login'); exigir(db.perfis.some((p) => p.id === body?.perfilId), 'perfilId');
  if (db.usuarios.some((u) => u.login === body.login)) return problem(409, 'Login já existe', 'LOGIN_DUPLICADO');
  const senha = senhaProvisoria();
  const u: UsuarioDb = { id: body.id ?? uid(), nome: body.nome, login: String(body.login).toLowerCase(), senha, perfilId: body.perfilId, ativo: true, trocarSenha: true };
  db.usuarios.push(u); auditar(user, 'USUARIO_CRIADO', 'usuario', u.id);
  return ok({ ...usuarioDto(u), senhaProvisoria: senha }, 201);
});
rota('PATCH', '/usuarios/:id', ['usuarios.gerenciar'], ({ user, params, body }) => {
  const u = db.usuarios.find((x) => x.id === params.id); if (!u) return problem(404, 'Usuário não encontrado');
  if (u.id === user.id && body?.ativo === false) return problem(409, 'Você não pode desativar o próprio usuário', 'AUTO_DESATIVACAO');
  Object.assign(u, pick(body, ['nome', 'perfilId', 'ativo'])); auditar(user, 'USUARIO_ALTERADO', 'usuario', u.id);
  return ok(usuarioDto(u));
});
rota('POST', '/usuarios/:id/redefinir-senha', ['usuarios.gerenciar'], ({ user, params }) => {
  const u = db.usuarios.find((x) => x.id === params.id); if (!u) return problem(404, 'Usuário não encontrado');
  u.senha = senhaProvisoria(); u.trocarSenha = true; auditar(user, 'SENHA_REDEFINIDA', 'usuario', u.id);
  return ok({ senhaProvisoria: u.senha });
});
rota('GET', '/perfis', ['perfis.gerenciar', 'usuarios.gerenciar'], () => ok(db.perfis));
rota('GET', '/permissoes', ['perfis.gerenciar'], () => ok(PERMISSOES.map((c) => ({ codigo: c, descricao: c.replace('.', ' — ').replace('_', ' ') }))));
rota('POST', '/perfis', ['perfis.gerenciar'], ({ user, body }) => {
  exigir(body?.nome, 'nome');
  const p = { id: body.id ?? uid(), nome: body.nome, padrao: false, permissoes: (body.permissoes ?? []).filter((x: string) => (PERMISSOES as readonly string[]).includes(x)), limiteDesconto: body.limiteDesconto ?? '0.00' };
  db.perfis.push(p); auditar(user, 'PERFIL_CRIADO', 'perfil', p.id); return ok(p, 201);
});
rota('PATCH', '/perfis/:id', ['perfis.gerenciar'], ({ user, params, body }) => {
  const p = db.perfis.find((x) => x.id === params.id); if (!p) return problem(404, 'Perfil não encontrado');
  Object.assign(p, pick(body, ['nome', 'permissoes', 'limiteDesconto'])); auditar(user, 'PERFIL_ALTERADO', 'perfil', p.id);
  return ok(p);
});
rota('GET', '/auditoria', ['auditoria.consultar'], ({ query }) => ok(paginar(db.auditoria.filter((a) =>
  (!query.get('acao') || a.acao.includes(query.get('acao')!.toUpperCase())) && (!query.get('entidade') || a.entidade === query.get('entidade')) && noPeriodo(a.ocorridoEm, query)), query)));

function pick(o: any, keys: string[]) { const r: any = {}; keys.forEach((k) => { if (o && k in o) r[k] = o[k]; }); return r; }

// ---------------- CAD ----------------
const cadastros = { categorias: db.categorias, parceiros: db.parceiros, campanhas: db.campanhas, 'motivos-descarte': db.motivosDescarte, 'motivos-baixa': db.motivosBaixa, 'categorias-despesa': db.categoriasDespesa } as Record<string, { id: string; nome: string; ativo: boolean }[]>;
for (const [tipo, lista] of Object.entries(cadastros)) {
  rota('GET', `/${tipo}`, ['cadastros.consultar', 'cadastros.gerenciar', 'caixa.operar', 'entrada.registrar', 'estoque.consultar', 'contas_pagar.gerenciar'], ({ query }) => {
    const b = (query.get('busca') ?? '').toLowerCase();
    return ok(lista.filter((x) => (!b || x.nome.toLowerCase().includes(b)) && (query.get('ativo') === null || String(x.ativo) === query.get('ativo'))));
  });
  rota('POST', `/${tipo}`, ['cadastros.gerenciar'], ({ user, body }) => {
    exigir(body?.nome?.trim(), 'nome');
    if (lista.some((x) => x.nome.toLowerCase() === body.nome.trim().toLowerCase())) return problem(409, 'Já existe um cadastro com este nome', 'NOME_DUPLICADO');
    const novo = { ...body, id: body.id ?? uid(), nome: body.nome.trim(), ativo: true };
    lista.push(novo); auditar(user, 'CADASTRO_CRIADO', tipo, novo.id); return ok(novo, 201);
  });
  rota('PATCH', `/${tipo}/:id`, ['cadastros.gerenciar'], ({ user, params, body }) => {
    const x = lista.find((i) => i.id === params.id); if (!x) return problem(404, 'Registro não encontrado');
    if ((x as any).especial && body?.ativo === false) return problem(409, 'O parceiro especial não pode ser desativado', 'PARCEIRO_ESPECIAL');
    const { id: _ignora, ...resto } = body ?? {};
    Object.assign(x, resto); auditar(user, 'CADASTRO_ALTERADO', tipo, x.id); return ok(x);
  });
}
rota('POST', '/clientes/busca', ['clientes.gerenciar', 'caixa.operar', 'contas_receber.receber', 'privacidade.gerenciar'], ({ body }) => {
  const t = String(body?.termo ?? '').toLowerCase().trim();
  const r = db.clientes.filter((c) => !c.anonimizado && (body?.ativo === undefined || c.ativo === body.ativo) && (!t || c.nome.toLowerCase().includes(t) || c.telefone.replace(/\D/g, '').includes(t.replace(/\D/g, '') || '§')));
  return ok(r.slice(0, 50));
});
rota('GET', '/clientes', ['clientes.gerenciar'], () => ok(db.clientes.filter((c) => !c.anonimizado)));
rota('POST', '/clientes', ['clientes.gerenciar', 'caixa.operar'], ({ user, body }) => {
  exigir(body?.nome?.trim(), 'nome'); exigir(/\d{10,11}/.test(String(body?.telefone ?? '').replace(/\D/g, '')), 'telefone');
  exigir(body?.cienciaAviso === true, 'cienciaAviso');
  const existente = db.clientes.find((c) => c.id === body.id); if (existente) return ok(existente); // idempotente
  const c = { id: body.id ?? uid(), nome: body.nome.trim(), telefone: body.telefone, ativo: true, cienciaAviso: true };
  db.clientes.push(c); auditar(user, 'CLIENTE_CRIADO', 'cliente', c.id); return ok(c, 201);
});
rota('PATCH', '/clientes/:id', ['clientes.gerenciar'], ({ user, params, body }) => {
  const c = db.clientes.find((x) => x.id === params.id); if (!c) return problem(404, 'Cliente não encontrado');
  Object.assign(c, pick(body, ['nome', 'telefone', 'ativo'])); auditar(user, 'CLIENTE_ALTERADO', 'cliente', c.id); return ok(c);
});
rota('GET', '/instituicao', ['parametros.gerenciar'], () => ok(db.instituicao));
rota('PUT', '/instituicao', ['parametros.gerenciar'], ({ user, body }) => { Object.assign(db.instituicao, pick(body, ['nome', 'cnpj', 'endereco', 'telefone'])); auditar(user, 'INSTITUICAO_ALTERADA', 'instituicao', '1'); return ok(db.instituicao); });

// ---------------- ENT / TRI ----------------
const nomeParc = (id?: string) => db.parceiros.find((p) => p.id === id)?.nome;
const nomeCamp = (id?: string) => db.campanhas.find((p) => p.id === id)?.nome;
const nomeCat = (id: string) => db.categorias.find((c) => c.id === id)?.nome ?? '—';
function loteDto(l: (typeof db.lotes)[number]) {
  const itens = db.itens.filter((i) => i.loteId === l.id);
  return {
    id: l.id, numero: l.numero, tipo: l.tipo, parceiroId: l.parceiroId, parceiroNome: nomeParc(l.parceiroId), campanhaId: l.campanhaId, campanhaNome: nomeCamp(l.campanhaId),
    documento: l.documento, temAnexo: l.temAnexo, recebidoEm: l.recebidoEm, status: l.status,
    aprovados: itens.reduce((s, i) => s + i.quantidadeInicial, 0),
    descartados: db.descartes.filter((d) => d.loteId === l.id && !d.revertido).length,
    valorAtribuido: fromCents(itens.reduce((s, i) => s + i.preco * i.quantidadeInicial, 0)),
    valorCompra: l.valorCompra !== undefined ? fromCents(l.valorCompra) : undefined, pago: l.pago,
  };
}
rota('GET', '/lotes', ['entrada.registrar'], ({ query }) => ok(paginar(db.lotes
  .filter((l) => (!query.get('parceiroId') || l.parceiroId === query.get('parceiroId')) && (!query.get('campanhaId') || l.campanhaId === query.get('campanhaId')) && (!query.get('status') || l.status === query.get('status')) && noPeriodo(l.recebidoEm, query))
  .sort((a, b) => b.numero - a.numero).map(loteDto), query)));
rota('GET', '/lotes/:id', ['entrada.registrar'], ({ params }) => {
  const l = db.lotes.find((x) => x.id === params.id); if (!l) return problem(404, 'Lote não encontrado');
  return ok({
    ...loteDto(l),
    itens: db.itens.filter((i) => i.loteId === l.id).map((i) => ({ id: i.id, codigo: i.codigo, descricao: i.descricao, categoriaNome: nomeCat(i.categoriaId), quantidade: i.quantidadeInicial, preco: fromCents(i.preco), localDestino: i.localInicial })),
    descartes: db.descartes.filter((d) => d.loteId === l.id).map((d) => ({ id: d.id, categoriaNome: nomeCat(d.categoriaId), motivoNome: db.motivosDescarte.find((m) => m.id === d.motivoId)?.nome ?? '—', registradoEm: d.registradoEm, revertido: d.revertido })),
  });
});
rota('POST', '/lotes', ['entrada.registrar'], ({ user, body }) => {
  exigir(['DOACAO', 'COMPRA', 'SALDO_INICIAL'].includes(body?.tipo), 'tipo');
  if (!body.parceiroId && !body.campanhaId) return problem(400, 'Informe parceiro e/ou campanha', 'ORIGEM_OBRIGATORIA'); // RN-04
  if (body.tipo === 'COMPRA') {
    if (!perfilDe(user).permissoes.includes('contas_pagar.gerenciar')) return problem(403, 'Registrar compra exige permissão de contas a pagar');
    exigir(body.valorCompra && toCents(body.valorCompra) > 0, 'valorCompra');
  }
  if (db.lotes.some((l) => l.id === body.id)) return ok(loteDto(db.lotes.find((l) => l.id === body.id)!));
  const l = { id: body.id ?? uid(), numero: ++db.seq.lote, tipo: body.tipo, parceiroId: body.parceiroId || undefined, campanhaId: body.campanhaId || undefined, documento: body.documento, temAnexo: false, recebidoEm: now(), status: 'ABERTO' as const, valorCompra: body.valorCompra ? toCents(body.valorCompra) : undefined, pago: body.pago };
  db.lotes.push(l);
  if (body.tipo === 'COMPRA') db.contasPagar.push({ id: uid(), descricao: `Compra — lote ${l.numero}`, categoriaDespesaId: db.categoriasDespesa[1]!.id, categoriaDespesaNome: db.categoriasDespesa[1]!.nome, valor: body.valorCompra, vencimento: body.vencimento ?? localDate(now()), status: body.pago ? 'PAGA' : 'ABERTA', pagaEm: body.pago ? now() : undefined });
  auditar(user, 'LOTE_CRIADO', 'lote_entrada', l.id); return ok(loteDto(l), 201);
});
rota('POST', '/lotes/:id/documento', ['entrada.registrar'], ({ params, body }) => {
  const l = db.lotes.find((x) => x.id === params.id); if (!l) return problem(404, 'Lote não encontrado');
  const f = (body as FormData).get('arquivo') as File | null;
  if (!f) return problem(400, 'Arquivo obrigatório');
  if (f.size > 5 * 1024 * 1024) return problem(413, 'Arquivo maior que 5 MB', 'ANEXO_GRANDE');
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(f.type)) return problem(415, 'Tipo de arquivo não aceito (PDF, PNG ou JPEG)', 'TIPO_INVALIDO');
  l.temAnexo = true; return { status: 204, headers: {}, body: null };
});
rota('GET', '/lotes/:id/documento', ['entrada.registrar'], () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: new Blob(['(anexo simulado)'], { type: 'text/plain' }) }));
function loteAberto(id: string) {
  const l = db.lotes.find((x) => x.id === id); if (!l) falha(404, 'Lote não encontrado');
  if (l!.status !== 'ABERTO') falha(409, 'Lote já triado não aceita registros', 'LOTE_TRIADO');
  return l!;
}
let seqCodigo = 100;
rota('POST', '/lotes/:id/itens', ['entrada.registrar'], ({ user, params, body }) => {
  const l = loteAberto(params.id!);
  exigir(db.categorias.some((c) => c.id === body?.categoriaId && c.ativo), 'categoriaId');
  exigir(['ETIQUETADO', 'CATEGORIA'].includes(body.controle), 'controle');
  exigir(Number.isInteger(body.quantidade) && body.quantidade > 0, 'quantidade');
  exigir(toCents(body.preco ?? '0') > 0, 'preco'); exigir(['BAZAR', 'DOACOES'].includes(body.localDestino), 'localDestino');
  if (body.controle === 'ETIQUETADO' && body.quantidade !== 1) return problem(400, 'Peça etiquetada tem quantidade 1', 'ETIQUETADO_QTD');
  const existente = db.itens.find((i) => i.id === body.id);
  const it: ItemDb = existente ?? {
    id: body.id ?? uid(), codigo: body.controle === 'ETIQUETADO' ? `BZ${String(++seqCodigo).padStart(6, '0')}` : undefined,
    descricao: body.descricao?.trim() || `${nomeCat(body.categoriaId)} (lote ${l.numero})`, categoriaId: body.categoriaId, controle: body.controle,
    preco: toCents(body.preco), loteId: l.id, criadoEm: now(), quantidadeInicial: body.quantidade, localInicial: body.localDestino, saldo: { BAZAR: 0, DOACOES: 0 },
  };
  if (!existente) {
    it.saldo[it.localInicial] = it.quantidadeInicial; db.itens.push(it);
    db.movs.push({ id: uid(), itemId: it.id, tipo: 'ENTRADA', quantidade: it.quantidadeInicial, local: it.localInicial, ocorridoEm: now(), usuarioNome: user.nome, descricao: `Triagem do lote ${l.numero}` });
  }
  return ok({ id: it.id, codigo: it.codigo, descricao: it.descricao, categoriaNome: nomeCat(it.categoriaId), quantidade: it.quantidadeInicial, preco: fromCents(it.preco), localDestino: it.localInicial }, 201);
});
rota('POST', '/lotes/:id/descartes', ['entrada.registrar'], ({ params, body }) => {
  const l = loteAberto(params.id!);
  exigir(db.categorias.some((c) => c.id === body?.categoriaId), 'categoriaId'); exigir(db.motivosDescarte.some((m) => m.id === body.motivoId && m.ativo), 'motivoId');
  if (db.descartes.some((d) => d.id === body.id)) return ok({ id: body.id }, 200);
  const d = { id: body.id ?? uid(), loteId: l.id, categoriaId: body.categoriaId, motivoId: body.motivoId, registradoEm: now(), revertido: false };
  db.descartes.push(d); // sem movimentação de estoque (RN-01)
  return ok({ id: d.id, categoriaNome: nomeCat(d.categoriaId), motivoNome: db.motivosDescarte.find((m) => m.id === d.motivoId)!.nome, registradoEm: d.registradoEm, revertido: false }, 201);
});
rota('POST', '/lotes/:id/encerrar', ['entrada.registrar'], ({ user, params }) => { const l = loteAberto(params.id!); l.status = 'TRIADO'; auditar(user, 'LOTE_ENCERRADO', 'lote_entrada', l.id); return ok(loteDto(l)); });
rota('POST', '/lotes/:id/reabrir', ['triagem.reabrir'], ({ user, params, body }) => {
  const l = db.lotes.find((x) => x.id === params.id); if (!l) return problem(404, 'Lote não encontrado');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo'); l.status = 'ABERTO'; auditar(user, 'LOTE_REABERTO', 'lote_entrada', l.id); return ok(loteDto(l));
});
rota('POST', '/descartes/:id/reverter', ['triagem.reabrir'], ({ user, params, body }) => {
  const d = db.descartes.find((x) => x.id === params.id); if (!d) return problem(404, 'Descarte não encontrado');
  if (d.revertido) return problem(409, 'Descarte já revertido', 'DESCARTE_REVERTIDO');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  const l = db.lotes.find((x) => x.id === d.loteId)!; l.status = 'ABERTO'; d.revertido = true; // item deve passar por nova triagem
  auditar(user, 'DESCARTE_REVERTIDO', 'descarte', d.id); return { status: 204, headers: {}, body: null };
});
rota('GET', '/etiquetas', ['entrada.registrar'], ({ query }) => {
  const ids = (query.get('itens') ?? '').split(',').filter(Boolean);
  return ok(db.itens.filter((i) => ids.includes(i.id) && i.codigo).map((i) => ({ itemId: i.id, codigo: i.codigo!, descricao: i.descricao, preco: fromCents(i.preco) })));
});

// ---------------- EST ----------------
function itemDto(i: ItemDb): ItemEstoque {
  const l = db.lotes.find((x) => x.id === i.loteId)!;
  return { id: i.id, codigo: i.codigo, descricao: i.descricao, categoriaId: i.categoriaId, categoriaNome: nomeCat(i.categoriaId), controle: i.controle, preco: fromCents(i.preco), loteId: l.id, loteNumero: l.numero, parceiroNome: nomeParc(l.parceiroId), campanhaNome: nomeCamp(l.campanhaId), saldoBazar: i.saldo.BAZAR, saldoDoacoes: i.saldo.DOACOES };
}
function mover(i: ItemDb, local: LocalEstoque, delta: number, tipo: HistoricoEvento['tipo'], user: string, descricao: string) {
  if (i.saldo[local] + delta < 0) falha(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', `${i.descricao}: saldo ${i.saldo[local]} em ${local}`);
  i.saldo[local] += delta;
  db.movs.push({ id: uid(), itemId: i.id, tipo, quantidade: delta, local, ocorridoEm: now(), usuarioNome: user, descricao });
}
rota('GET', '/estoque', ['estoque.consultar'], ({ query }) => {
  const b = (query.get('busca') ?? '').toLowerCase(); const local = query.get('local');
  return ok(paginar(db.itens.filter((i) => {
    const l = db.lotes.find((x) => x.id === i.loteId)!;
    return (i.saldo.BAZAR + i.saldo.DOACOES > 0) && (!local || i.saldo[local as LocalEstoque] > 0) && (!query.get('categoriaId') || i.categoriaId === query.get('categoriaId'))
      && (!query.get('parceiroId') || l.parceiroId === query.get('parceiroId')) && (!query.get('campanhaId') || l.campanhaId === query.get('campanhaId')) && (!query.get('loteId') || l.id === query.get('loteId'))
      && (!b || i.descricao.toLowerCase().includes(b) || (i.codigo ?? '').toLowerCase().includes(b));
  }).map(itemDto), query));
});
rota('GET', '/itens/codigo/:codigo', ['estoque.consultar', 'caixa.operar'], ({ params }) => {
  const i = db.itens.find((x) => x.codigo === decodeURIComponent(params.codigo!).toUpperCase());
  return i ? ok(itemDto(i)) : problem(404, 'Código não encontrado', 'CODIGO_INEXISTENTE');
});
rota('GET', '/itens/:id/historico', ['estoque.consultar'], ({ params }) => {
  const i = db.itens.find((x) => x.id === params.id); if (!i) return problem(404, 'Item não encontrado');
  const l = db.lotes.find((x) => x.id === i.loteId)!;
  const eventos: HistoricoEvento[] = [
    { ocorridoEm: l.recebidoEm, tipo: 'TRIAGEM' as const, descricao: `Lote ${l.numero} recebido — ${nomeParc(l.parceiroId) ?? nomeCamp(l.campanhaId)}`, quantidade: 0 },
    ...db.movs.filter((m) => m.itemId === i.id).map((m) => ({ ocorridoEm: m.ocorridoEm, tipo: m.tipo, descricao: m.descricao, quantidade: m.quantidade, local: m.local, usuarioNome: m.usuarioNome })),
  ].sort((a, b) => a.ocorridoEm.localeCompare(b.ocorridoEm));
  return ok({ item: itemDto(i), eventos });
});
function acharItem(body: any) {
  const i = body?.itemId ? db.itens.find((x) => x.id === body.itemId) : db.itens.find((x) => x.codigo === String(body?.codigo ?? '').toUpperCase());
  if (!i) falha(404, 'Item não encontrado', 'ITEM_INEXISTENTE'); return i!;
}
const jaFeito = new Set<string>(); // idempotência genérica de escritas com id do cliente
function idem(id: string | undefined) { if (id && jaFeito.has(id)) return true; if (id) jaFeito.add(id); return false; }
rota('POST', '/transferencias', ['estoque.transferir'], ({ user, body }) => {
  if (idem(body?.id)) return { status: 204, headers: {}, body: null };
  const i = acharItem(body); const q = Number(body.quantidade);
  exigir(Number.isInteger(q) && q > 0, 'quantidade'); exigir(body.origem !== body.destino, 'destino');
  mover(i, body.origem, -q, 'TRANSFERENCIA', user.nome, `Transferência ${body.origem} → ${body.destino}${body.motivo ? ` (${body.motivo})` : ''}`);
  mover(i, body.destino, q, 'TRANSFERENCIA', user.nome, `Transferência ${body.origem} → ${body.destino}`);
  auditar(user, 'TRANSFERENCIA', 'item', i.id); return { status: 204, headers: {}, body: null };
});
rota('POST', '/baixas', ['estoque.ajustar'], ({ user, body }) => {
  if (idem(body?.id)) return { status: 204, headers: {}, body: null };
  const i = acharItem(body); const m = db.motivosBaixa.find((x) => x.id === body.motivoId); exigir(m, 'motivoId');
  mover(i, body.local, -Number(body.quantidade), 'BAIXA', user.nome, `Baixa: ${m!.nome}`); auditar(user, 'BAIXA', 'item', i.id);
  return { status: 204, headers: {}, body: null };
});
rota('POST', '/ajustes', ['estoque.ajustar'], ({ user, body }) => {
  if (idem(body?.id)) return { status: 204, headers: {}, body: null };
  const i = acharItem(body); exigir(String(body.motivo ?? '').trim().length >= 5, 'motivo');
  const q = Number(body.quantidade) * (body.tipo === 'AJUSTE_SAIDA' ? -1 : 1);
  mover(i, body.local, q, body.tipo, user.nome, `Ajuste de inventário: ${body.motivo}`); auditar(user, body.tipo, 'item', i.id);
  return { status: 204, headers: {}, body: null };
});
rota('PATCH', '/itens/:id/preco', ['estoque.ajustar'], ({ user, params, body }) => {
  const i = db.itens.find((x) => x.id === params.id); if (!i) return problem(404, 'Item não encontrado');
  i.preco = toCents(body.preco); auditar(user, 'PRECO_ITEM', 'item', i.id); return { status: 204, headers: {}, body: null };
});
rota('PATCH', '/categorias/:id/preco', ['estoque.ajustar'], ({ user, params, body }) => {
  const c = db.categorias.find((x) => x.id === params.id); if (!c) return problem(404, 'Categoria não encontrada');
  c.precoPadrao = fromCents(toCents(body.preco)); db.itens.filter((i) => i.categoriaId === c.id && i.controle === 'CATEGORIA').forEach((i) => { i.preco = toCents(body.preco); });
  auditar(user, 'PRECO_CATEGORIA', 'categoria', c.id); return { status: 204, headers: {}, body: null };
});
rota('POST', '/carga-inicial', ['estoque.ajustar'], ({ body }) => {
  const f = (body as FormData).get('arquivo') as File | null; if (!f) return problem(400, 'Arquivo obrigatório');
  // Simulação: sempre devolve 2 erros por linha e NÃO grava nada (tudo ou nada).
  return ok({ gravado: false, linhas: 12, erros: [{ linha: 4, mensagem: 'Categoria "Brinquedos" não cadastrada' }, { linha: 9, mensagem: 'Preço inválido: "dez"' }] });
});

// ---------------- PDV ----------------
rota('GET', '/pdv/catalogo', ['caixa.operar'], ({ headers }) => {
  const cat: CatalogoPdv = {
    versao: '',
    categorias: db.categorias.filter((c) => c.ativo && c.vendaPorCategoria),
    itensEtiquetados: db.itens.filter((i) => i.controle === 'ETIQUETADO' && i.saldo.BAZAR > 0).map((i) => ({ itemId: i.id, codigo: i.codigo!, descricao: i.descricao, preco: fromCents(i.preco) })),
    clientesFiado: db.clientes.filter((c) => c.ativo && !c.anonimizado).map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone })),
    regrasFiscais: db.regrasFiscais.filter((r) => !r.vigenciaFim),
  };
  const etag = `"${hash(JSON.stringify(cat))}"`;
  if (headers['if-none-match'] === etag) return { status: 304, headers: { etag }, body: null };
  cat.versao = etag; return ok(cat, 200, { etag });
});
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

/** Regra da venda (o servidor real faz isso numa transação única conferida no COMMIT). */
function processarVenda(id: string, req: VendaRequest, user: UsuarioDb, opts: { relaxarCaixa?: boolean } = {}): VendaDb {
  const existente = db.vendas.find((v) => v.id === id); if (existente) return existente; // idempotência
  const caixa = db.caixas.find((c) => c.id === req.caixaId);
  if (!caixa) falha(404, 'Caixa não encontrado', 'CAIXA_INEXISTENTE');
  if (!opts.relaxarCaixa) {
    if (caixa!.operadorId !== user.id || caixa!.terminalId !== req.terminalId) falha(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR'); // anti-IDOR
    if (caixa!.status !== 'ABERTO') falha(409, 'Caixa fechado', 'CAIXA_FECHADO');
  }
  if (!req.itens?.length) falha(400, 'Venda sem itens', 'VENDA_VAZIA');
  // Snapshot para desfazer se algo falhar (simula ROLLBACK).
  const snap = db.itens.map((i) => ({ i, s: { ...i.saldo } })); const movLen = db.movs.length;
  try {
    const alocacoes: VendaDb['alocacoes'] = []; const linhas: Venda['itens'] = [];
    for (const it of req.itens) {
      if ('codigo' in it) {
        const i = db.itens.find((x) => x.codigo === it.codigo.toUpperCase());
        if (!i) falha(409, 'Código não encontrado', 'CODIGO_INEXISTENTE', it.codigo);
        mover(i!, 'BAZAR', -1, 'VENDA', user.nome, `Venda`);
        alocacoes.push({ itemId: i!.id, quantidade: 1, precoUnit: i!.preco });
        linhas.push({ descricao: i!.descricao, quantidade: 1, precoUnitario: fromCents(i!.preco), total: fromCents(i!.preco), loteNumero: db.lotes.find((l) => l.id === i!.loteId)!.numero });
      } else {
        let resta = it.quantidade; exigir(resta > 0, 'quantidade');
        // PEPS: lote mais antigo primeiro, desempate fixo (data do lote, número, criação do item, id).
        const cand = db.itens.filter((i) => i.categoriaId === it.categoriaId && i.controle === 'CATEGORIA' && i.saldo.BAZAR > 0).sort((a, b) => {
          const la = db.lotes.find((l) => l.id === a.loteId)!, lb = db.lotes.find((l) => l.id === b.loteId)!;
          return la.recebidoEm.localeCompare(lb.recebidoEm) || la.numero - lb.numero || a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id);
        });
        for (const i of cand) {
          if (!resta) break; const q = Math.min(resta, i.saldo.BAZAR);
          mover(i, 'BAZAR', -q, 'VENDA', user.nome, 'Venda por categoria (PEPS)');
          alocacoes.push({ itemId: i.id, quantidade: q, precoUnit: i.preco }); resta -= q;
          linhas.push({ descricao: nomeCat(i.categoriaId), quantidade: q, precoUnitario: fromCents(i.preco), total: fromCents(i.preco * q), loteNumero: db.lotes.find((l) => l.id === i.loteId)!.numero });
        }
        if (resta > 0) falha(409, 'Saldo insuficiente', 'SALDO_INSUFICIENTE', `${nomeCat(it.categoriaId)}: faltam ${resta}`);
      }
    }
    const subtotal = alocacoes.reduce((s, a) => s + a.precoUnit * a.quantidade, 0);
    const desconto = req.desconto ? toCents(req.desconto) : 0;
    const limite = toCents(perfilDe(user).limiteDesconto); // em % * 100
    if (desconto < 0 || desconto > subtotal) falha(400, 'Desconto inválido', 'DESCONTO_INVALIDO');
    if (subtotal && (desconto * 10000) / subtotal > limite) falha(409, 'Desconto acima do limite do perfil', 'DESCONTO_ACIMA_LIMITE');
    const total = subtotal - desconto;
    const pagos = req.pagamentos.reduce((s, p) => s + toCents(p.valor), 0);
    if (pagos !== total) falha(409, 'Pagamentos não fecham com o total recalculado', 'PAGAMENTO_DIVERGENTE', `Total ${fromCents(total)}, pago ${fromCents(pagos)}`);
    let troco = 0;
    for (const p of req.pagamentos) {
      if (p.forma === 'DINHEIRO' && p.valorRecebido) { const r = toCents(p.valorRecebido); if (r < toCents(p.valor)) falha(400, 'Valor recebido menor que o pago em dinheiro'); troco += r - toCents(p.valor); }
    }
    const fiado = req.pagamentos.find((p) => p.forma === 'FIADO');
    const cliente = db.clientes.find((c) => c.id === req.clienteId);
    if (fiado && (!cliente || !req.vencimentoFiado)) falha(400, 'Fiado exige cliente e vencimento', 'FIADO_SEM_CLIENTE');
    const v: VendaDb = {
      id, numero: ++db.seq.venda, numeroLocal: req.numeroLocal, ocorridaEm: req.ocorridaEm, origem: req.origem, status: 'CONCLUIDA',
      subtotal: fromCents(subtotal), desconto: fromCents(desconto), total: fromCents(total), troco: fromCents(troco), itens: linhas, pagamentos: req.pagamentos,
      operadorNome: user.nome, clienteNome: cliente?.nome, clienteId: cliente?.id, vencimentoFiado: req.vencimentoFiado,
      caixaId: req.caixaId, terminalId: req.terminalId, operadorId: user.id, alocacoes,
    };
    db.vendas.push(v);
    if (fiado) db.contasReceber.push({ id: uid(), clienteId: cliente!.id, clienteNome: cliente!.nome, vendaNumero: v.numero!, valor: fiado.valor, saldo: fiado.valor, vencimento: req.vencimentoFiado!, status: 'ABERTA' });
    return v;
  } catch (e) {
    snap.forEach(({ i, s }) => { i.saldo = s; }); db.movs.length = movLen; throw e;
  }
}
const vendaDto = ({ caixaId: _c, terminalId: _t, operadorId: _o, alocacoes: _a, clienteId: _cl, ...v }: VendaDb): Venda => v;
rota('PUT', '/vendas/:id', ['caixa.operar'], ({ user, params, body }) => {
  exigir(body?.caixaId && body?.terminalId && body?.ocorridaEm, 'caixaId/terminalId/ocorridaEm');
  const ja = db.vendas.some((v) => v.id === params.id);
  const v = processarVenda(params.id!, body, user);
  return ok(vendaDto(v), ja ? 200 : 201);
});
rota('POST', '/sync/lote', ['caixa.operar'], ({ user, body }) => {
  const b = body as SyncLoteRequest; const resultados: any[] = [];
  for (const c of b.clientes ?? []) {
    if (!db.clientes.some((x) => x.id === c.id)) db.clientes.push({ ...c, ativo: true });
    resultados.push({ id: c.id, tipo: 'cliente', status: 'GRAVADA' });
  }
  for (const v of [...(b.vendas ?? [])].sort((a, b) => a.ocorridaEm.localeCompare(b.ocorridaEm))) {
    if (db.vendas.some((x) => x.id === v.id)) { resultados.push({ id: v.id, tipo: 'venda', status: 'JA_EXISTENTE', numero: db.vendas.find((x) => x.id === v.id)!.numero }); continue; }
    try {
      const r = processarVenda(v.id, v, user, { relaxarCaixa: true });
      resultados.push({ id: v.id, tipo: 'venda', status: 'GRAVADA', numero: r.numero });
    } catch (e) {
      if (!(e instanceof Falha)) throw e;
      const p = e.r.body as ProblemDetails;
      if (!db.pendencias.some((x) => x.vendaId === v.id)) {
        // RN-26: venda recusada é PRESERVADA como pendência para o Admin resolver.
        const total = v.pagamentos.reduce((s, x) => s + toCents(x.valor), 0);
        db.pendencias.push({ id: uid(), vendaId: v.id, numeroLocal: v.numeroLocal, terminalNome: db.terminais.find((t) => t.id === v.terminalId)?.nome ?? '—', operadorNome: user.nome, operadorId: user.id, ocorridaEm: v.ocorridaEm, total: fromCents(total), codigo: p.code ?? 'ERRO', motivo: p.detail ?? p.title, status: 'ABERTA', req: v });
      }
      resultados.push({ id: v.id, tipo: 'venda', status: 'PENDENCIA', motivo: p.detail ?? p.title });
    }
  }
  return ok({ resultados });
});
rota('GET', '/vendas', ['caixa.operar', 'venda.cancelar'], ({ user, query }) => {
  const admin = perfilDe(user).permissoes.includes('venda.cancelar');
  return ok(paginar(db.vendas.filter((v) => (admin || v.operadorId === user.id) && noPeriodo(v.ocorridaEm, query) && (!query.get('caixaId') || v.caixaId === query.get('caixaId')))
    .sort((a, b) => b.ocorridaEm.localeCompare(a.ocorridaEm)).map(vendaDto), query));
});
rota('GET', '/vendas/:id/comprovante', ['caixa.operar'], ({ params }) => { const v = db.vendas.find((x) => x.id === params.id); return v ? ok(vendaDto(v)) : problem(404, 'Venda não encontrada'); });
rota('POST', '/vendas/:id/cancelar', ['venda.cancelar'], ({ user, params, body }) => {
  const v = db.vendas.find((x) => x.id === params.id); if (!v) return problem(404, 'Venda não encontrada');
  if (v.status === 'CANCELADA') return problem(409, 'Venda já cancelada', 'VENDA_CANCELADA');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  v.alocacoes.forEach((a) => mover(db.itens.find((i) => i.id === a.itemId)!, 'BAZAR', a.quantidade, 'ESTORNO_VENDA', user.nome, `Estorno da venda ${v.numero}`));
  v.status = 'CANCELADA';
  const dinheiro = v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + toCents(p.valor), 0);
  const cx = db.caixas.find((c) => c.status === 'ABERTO' && c.operadorId === user.id);
  if (dinheiro && cx) cx.lancamentos.push({ id: uid(), tipo: 'SANGRIA', valor: dinheiro, motivo: `Reembolso venda ${v.numero}`, em: now() });
  db.contasReceber.filter((c) => c.vendaNumero === v.numero).forEach((c) => { c.status = 'CANCELADA'; c.saldo = '0.00'; });
  auditar(user, 'VENDA_CANCELADA', 'venda', v.id); return ok(vendaDto(v));
});
rota('GET', '/pendencias', ['sincronizacao.resolver'], ({ query }) => ok(paginar(db.pendencias.filter((p) => !query.get('status') || p.status === query.get('status')).map(({ req: _r, operadorId: _o, ...p }) => p), query)));
rota('POST', '/pendencias/:id/reprocessar', ['sincronizacao.resolver'], ({ user, params }) => {
  const p = db.pendencias.find((x) => x.id === params.id); if (!p) return problem(404, 'Pendência não encontrada');
  if (p.status !== 'ABERTA') return problem(409, 'Pendência já resolvida', 'PENDENCIA_RESOLVIDA');
  const operador = db.usuarios.find((u) => u.id === p.operadorId)!;
  try { processarVenda(p.vendaId, p.req, operador, { relaxarCaixa: true }); } catch (e) {
    if (e instanceof Falha) { const pd = e.r.body as ProblemDetails; p.motivo = pd.detail ?? pd.title; p.codigo = pd.code ?? p.codigo; return e.r; } throw e;
  }
  p.status = 'REPROCESSADA'; auditar(user, 'PENDENCIA_REPROCESSADA', 'pendencia', p.id);
  const { req: _r, operadorId: _o, ...dto } = p; return ok(dto);
});
rota('POST', '/pendencias/:id/descartar', ['sincronizacao.resolver'], ({ user, params, body }) => {
  const p = db.pendencias.find((x) => x.id === params.id); if (!p) return problem(404, 'Pendência não encontrada');
  exigir(String(body?.justificativa ?? '').trim().length >= 5, 'justificativa');
  p.status = 'DESCARTADA'; auditar(user, 'PENDENCIA_DESCARTADA', 'pendencia', p.id);
  const { req: _r, operadorId: _o, ...dto } = p; return ok(dto);
});

// ---------------- CXA ----------------
// GET /terminais também liberado para caixa.operar (escolha na abertura) — DIVERGÊNCIA a validar com o back-end.
rota('GET', '/terminais', ['terminais.gerenciar', 'caixa.operar'], ({ query }) => ok(db.terminais.filter((t) => query.get('ativo') === null || String(t.ativo) === query.get('ativo'))));
rota('POST', '/terminais', ['terminais.gerenciar'], ({ user, body }) => { exigir(body?.nome, 'nome'); const t = { id: body.id ?? uid(), nome: body.nome, ativo: true }; db.terminais.push(t); auditar(user, 'TERMINAL_CRIADO', 'terminal', t.id); return ok(t, 201); });
rota('PATCH', '/terminais/:id', ['terminais.gerenciar'], ({ user, params, body }) => { const t = db.terminais.find((x) => x.id === params.id); if (!t) return problem(404, 'Terminal não encontrado'); Object.assign(t, pick(body, ['nome', 'ativo'])); auditar(user, 'TERMINAL_ALTERADO', 'terminal', t.id); return ok(t); });
const caixaDto = ({ operadorId: _o, lancamentos: _l, ...c }: CaixaDb) => c;
rota('GET', '/caixas/atual', ['caixa.operar'], ({ user }) => { const c = db.caixas.find((x) => x.operadorId === user.id && x.status === 'ABERTO'); return c ? ok(caixaDto(c)) : problem(404, 'Nenhum caixa aberto', 'SEM_CAIXA_ABERTO'); });
rota('POST', '/caixas', ['caixa.operar'], ({ user, body }) => {
  const t = db.terminais.find((x) => x.id === body?.terminalId && x.ativo); exigir(t, 'terminalId'); exigir(toCents(body.fundoTroco ?? '-1') >= 0, 'fundoTroco');
  if (db.caixas.some((c) => c.status === 'ABERTO' && (c.terminalId === t!.id || c.operadorId === user.id))) return problem(409, 'Já existe caixa aberto neste terminal ou para este operador', 'CAIXA_JA_ABERTO');
  const c: CaixaDb = { id: body.id ?? uid(), terminalId: t!.id, terminalNome: t!.nome, operadorNome: user.nome, operadorId: user.id, abertoEm: now(), fundoTroco: fromCents(toCents(body.fundoTroco)), status: 'ABERTO', lancamentos: [] };
  db.caixas.push(c); auditar(user, 'CAIXA_ABERTO', 'caixa_sessao', c.id); return ok(caixaDto(c), 201);
});
function meuCaixa(user: UsuarioDb, id: string) {
  const c = db.caixas.find((x) => x.id === id); if (!c) falha(404, 'Caixa não encontrado');
  if (c!.operadorId !== user.id) falha(403, 'Caixa não pertence a esta sessão', 'CAIXA_DE_OUTRO_OPERADOR');
  if (c!.status !== 'ABERTO') falha(409, 'Caixa fechado', 'CAIXA_FECHADO'); return c!;
}
rota('POST', '/caixas/:id/lancamentos', ['caixa.operar'], ({ user, params, body }) => {
  const c = meuCaixa(user, params.id!); exigir(['SANGRIA', 'SUPRIMENTO'].includes(body?.tipo), 'tipo'); exigir(toCents(body.valor) > 0, 'valor'); exigir(String(body.motivo ?? '').trim(), 'motivo');
  if (c.lancamentos.some((l) => l.id === body.id)) return { status: 204, headers: {}, body: null };
  if (body.tipo === 'SANGRIA' && toCents(body.valor) > toCents(previa(c).esperadoDinheiro)) return problem(409, 'Sangria maior que o dinheiro em caixa', 'SANGRIA_ACIMA_SALDO');
  c.lancamentos.push({ id: body.id ?? uid(), tipo: body.tipo, valor: toCents(body.valor), motivo: body.motivo, em: now() });
  auditar(user, body.tipo, 'caixa_sessao', c.id); return { status: 204, headers: {}, body: null };
});
function previa(c: CaixaDb) {
  const vendas = db.vendas.filter((v) => v.caixaId === c.id && v.status === 'CONCLUIDA');
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<FormaPagamento, number>;
  vendas.forEach((v) => v.pagamentos.forEach((p) => { porForma[p.forma] += toCents(p.valor); }));
  const receb = db.recebimentos.filter((r) => r.caixaId === c.id && !r.estornado).reduce((s, r) => s + toCents(r.valor), 0);
  const sang = c.lancamentos.filter((l) => l.tipo === 'SANGRIA').reduce((s, l) => s + l.valor, 0);
  const sup = c.lancamentos.filter((l) => l.tipo === 'SUPRIMENTO').reduce((s, l) => s + l.valor, 0);
  const esperado = toCents(c.fundoTroco) + porForma.DINHEIRO + receb + sup - sang;
  return { fundoTroco: c.fundoTroco, suprimentos: fromCents(sup), sangrias: fromCents(sang), totaisPorForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(porForma[f])])) as Record<FormaPagamento, string>, esperadoDinheiro: fromCents(esperado), quantidadeVendas: vendas.length, filaPendente: 0 };
}
rota('GET', '/caixas/:id/previa-fechamento', ['caixa.operar'], ({ user, params }) => ok(previa(meuCaixa(user, params.id!))));
rota('POST', '/caixas/:id/fechar', ['caixa.operar'], ({ user, params, body }) => {
  const c = meuCaixa(user, params.id!); const contado = toCents(body?.contado ?? '-1'); exigir(contado >= 0, 'contado');
  const esp = toCents(previa(c).esperadoDinheiro); const dif = contado - esp;
  if (dif !== 0 && String(body.observacao ?? '').trim().length < 5) return problem(400, 'Diferença de caixa exige observação', 'OBSERVACAO_OBRIGATORIA');
  Object.assign(c, { status: 'FECHADO', fechadoEm: now(), esperado: fromCents(esp), contado: fromCents(contado), diferenca: fromCents(dif), observacao: body.observacao });
  auditar(user, 'CAIXA_FECHADO', 'caixa_sessao', c.id); return ok(caixaDto(c));
});
rota('GET', '/caixas', ['relatorios.consultar'], ({ query }) => ok(paginar(db.caixas.filter((c) => noPeriodo(c.abertoEm, query)).sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)).map(caixaDto), query)));

// ---------------- FIN ----------------
rota('GET', '/contas-pagar', ['contas_pagar.gerenciar'], ({ query }) => ok(paginar(db.contasPagar.filter((c) => !query.get('status') || c.status === query.get('status')).sort((a, b) => a.vencimento.localeCompare(b.vencimento)), query)));
rota('POST', '/contas-pagar', ['contas_pagar.gerenciar'], ({ user, body }) => {
  exigir(body?.descricao, 'descricao'); exigir(toCents(body.valor ?? '0') > 0, 'valor'); exigir(/^\d{4}-\d{2}-\d{2}$/.test(body.vencimento ?? ''), 'vencimento');
  const cd = db.categoriasDespesa.find((x) => x.id === body.categoriaDespesaId); exigir(cd, 'categoriaDespesaId');
  const c = { id: body.id ?? uid(), descricao: body.descricao, categoriaDespesaId: cd!.id, categoriaDespesaNome: cd!.nome, valor: fromCents(toCents(body.valor)), vencimento: body.vencimento, status: 'ABERTA' as const };
  db.contasPagar.push(c); auditar(user, 'CONTA_PAGAR_CRIADA', 'conta_pagar', c.id); return ok(c, 201);
});
rota('POST', '/contas-pagar/:id/pagar', ['contas_pagar.gerenciar'], ({ user, params, body }) => {
  const c = db.contasPagar.find((x) => x.id === params.id); if (!c) return problem(404, 'Conta não encontrada');
  if (c.status !== 'ABERTA') return problem(409, 'Conta não está aberta', 'CONTA_NAO_ABERTA');
  if (body?.saiuDoCaixa) {
    const cx = db.caixas.find((x) => x.status === 'ABERTO' && x.operadorId === user.id);
    if (!cx) return problem(409, 'Você não tem caixa aberto para registrar a sangria', 'CAIXA_FECHADO');
    cx.lancamentos.push({ id: uid(), tipo: 'SANGRIA', valor: toCents(c.valor), motivo: `Pagamento: ${c.descricao}`, em: now() });
  }
  Object.assign(c, { status: 'PAGA', pagaEm: now(), saiuDoCaixa: !!body?.saiuDoCaixa }); auditar(user, 'CONTA_PAGA', 'conta_pagar', c.id); return ok(c);
});
rota('POST', '/contas-pagar/:id/cancelar', ['contas_pagar.gerenciar'], ({ user, params, body }) => {
  const c = db.contasPagar.find((x) => x.id === params.id); if (!c) return problem(404, 'Conta não encontrada');
  exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo'); if (c.status !== 'ABERTA') return problem(409, 'Conta não está aberta', 'CONTA_NAO_ABERTA');
  c.status = 'CANCELADA'; auditar(user, 'CONTA_PAGAR_CANCELADA', 'conta_pagar', c.id); return ok(c);
});
function recalcular(c: ContaReceber) {
  const pago = db.recebimentos.filter((r) => r.contaReceberId === c.id && !r.estornado).reduce((s, r) => s + toCents(r.valor), 0);
  const saldo = toCents(c.valor) - pago; c.saldo = fromCents(saldo);
  if (c.status !== 'CANCELADA') c.status = saldo === 0 ? 'QUITADA' : pago > 0 ? 'PARCIAL' : 'ABERTA';
}
rota('GET', '/contas-receber', ['contas_receber.receber'], ({ query }) => ok(paginar(db.contasReceber.filter((c) => (!query.get('status') || c.status === query.get('status')) && (!query.get('clienteId') || c.clienteId === query.get('clienteId'))).sort((a, b) => a.vencimento.localeCompare(b.vencimento)), query)));
rota('POST', '/contas-receber', ['contas_receber.lancar'], ({ user, body }) => {
  const cl = db.clientes.find((x) => x.id === body?.clienteId); exigir(cl, 'clienteId'); exigir(toCents(body.valor ?? '0') > 0, 'valor');
  const c = { id: body.id ?? uid(), clienteId: cl!.id, clienteNome: cl!.nome, descricao: body.descricao, valor: fromCents(toCents(body.valor)), saldo: fromCents(toCents(body.valor)), vencimento: body.vencimento, status: 'ABERTA' as const };
  db.contasReceber.push(c); auditar(user, 'CONTA_RECEBER_LANCADA', 'conta_receber', c.id); return ok(c, 201);
});
rota('POST', '/contas-receber/:id/recebimentos', ['contas_receber.receber'], ({ user, params, body }) => {
  const c = db.contasReceber.find((x) => x.id === params.id); if (!c) return problem(404, 'Conta não encontrada');
  if (db.recebimentos.some((r) => r.id === body?.id)) return ok(db.recebimentos.find((r) => r.id === body.id));
  const v = toCents(body?.valor ?? '0'); exigir(v > 0, 'valor');
  if (v > toCents(c.saldo)) return problem(409, 'Valor maior que o saldo da conta', 'RECEBIMENTO_ACIMA_SALDO');
  if (body.caixaId) meuCaixa(user, body.caixaId);
  const r = { id: body.id ?? uid(), contaReceberId: c.id, valor: fromCents(v), recebidoEm: now(), caixaId: body.caixaId, estornado: false };
  db.recebimentos.push(r); recalcular(c); auditar(user, 'RECEBIMENTO', 'conta_receber', c.id); return ok(r, 201);
});
rota('POST', '/recebimentos/:id/estornar', ['recebimento.estornar'], ({ user, params, body }) => {
  const r = db.recebimentos.find((x) => x.id === params.id); if (!r) return problem(404, 'Recebimento não encontrado');
  if (r.estornado) return problem(409, 'Recebimento já estornado', 'ESTORNO_DUPLICADO'); exigir(String(body?.motivo ?? '').trim().length >= 5, 'motivo');
  r.estornado = true; recalcular(db.contasReceber.find((c) => c.id === r.contaReceberId)!); auditar(user, 'RECEBIMENTO_ESTORNADO', 'recebimento', r.id);
  return { status: 204, headers: {}, body: null };
});
rota('GET', '/clientes/:id/extrato', ['contas_receber.receber'], ({ params }) => {
  const cl = db.clientes.find((x) => x.id === params.id); if (!cl) return problem(404, 'Cliente não encontrado');
  const contas = db.contasReceber.filter((c) => c.clienteId === cl.id);
  return ok({ cliente: { id: cl.id, nome: cl.nome }, contas, recebimentos: db.recebimentos.filter((r) => contas.some((c) => c.id === r.contaReceberId)), saldoDevedor: fromCents(contas.filter((c) => c.status !== 'CANCELADA').reduce((s, c) => s + toCents(c.saldo), 0)) });
});
rota('GET', '/financeiro/resumo', ['relatorios.consultar'], ({ query }) => {
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<FormaPagamento, number>;
  db.vendas.filter((v) => v.status === 'CONCLUIDA' && noPeriodo(v.ocorridaEm, query)).forEach((v) => v.pagamentos.forEach((p) => { porForma[p.forma] += toCents(p.valor); }));
  const receb = db.recebimentos.filter((r) => !r.estornado && noPeriodo(r.recebidoEm, query)).reduce((s, r) => s + toCents(r.valor), 0);
  const saidas = db.contasPagar.filter((c) => c.status === 'PAGA' && c.pagaEm && noPeriodo(c.pagaEm, query)).reduce((s, c) => s + toCents(c.valor), 0);
  const entradas = porForma.DINHEIRO + porForma.PIX + porForma.CARTAO_DEBITO + porForma.CARTAO_CREDITO + receb;
  return ok({ de: query.get('de'), ate: query.get('ate'), entradasPorForma: Object.fromEntries(FORMAS.map((f) => [f, fromCents(porForma[f])])), recebimentosFiado: fromCents(receb), saidas: fromCents(saidas), resultado: fromCents(entradas - saidas) });
});

// ---------------- FIS ----------------
rota('GET', '/regras-fiscais', ['fiscal.gerenciar'], () => ok(db.regrasFiscais));
rota('POST', '/regras-fiscais', ['fiscal.gerenciar'], ({ user, body }) => {
  exigir(['GERAL', 'CATEGORIA', 'ITEM'].includes(body?.alvo), 'alvo'); exigir(/^\d{4}-\d{2}-\d{2}$/.test(body.vigenciaInicio ?? ''), 'vigenciaInicio');
  const anterior = db.regrasFiscais.find((r) => r.alvo === body.alvo && (r.alvoId ?? null) === (body.alvoId ?? null) && !r.vigenciaFim);
  if (anterior) { if (anterior.vigenciaInicio >= body.vigenciaInicio) return problem(409, 'Vigência sobrepõe a regra atual', 'VIGENCIA_SOBREPOSTA'); anterior.vigenciaFim = body.vigenciaInicio; }
  const r = { ...pick(body, ['alvo', 'alvoId', 'situacao', 'aliquota', 'vigenciaInicio']), id: body.id ?? uid(), alvoNome: body.alvoId ? nomeCat(body.alvoId) : undefined };
  db.regrasFiscais.push(r); auditar(user, 'REGRA_FISCAL_CRIADA', 'regra_fiscal', r.id); return ok(r, 201);
});

// ---------------- REL ----------------
function relatorio(tipo: string, q: URLSearchParams): RelatorioResposta {
  switch (tipo) {
    case 'prestacao-contas': {
      const modo = q.get('modo') === 'campanha' ? 'campanha' : 'parceiro';
      const grupos = new Map<string, Record<string, number>>();
      for (const l of db.lotes) {
        const chave = (modo === 'parceiro' ? nomeParc(l.parceiroId) : nomeCamp(l.campanhaId)) ?? '(sem ' + modo + ')';
        const g = grupos.get(chave) ?? { recebidos: 0, descartados: 0, valorAtribuido: 0, vendidos: 0, receita: 0, emEstoque: 0 };
        const itens = db.itens.filter((i) => i.loteId === l.id);
        if (noPeriodo(l.recebidoEm, q)) {
          g.recebidos! += itens.reduce((s, i) => s + i.quantidadeInicial, 0);
          g.descartados! += db.descartes.filter((d) => d.loteId === l.id && !d.revertido).length;
          g.valorAtribuido! += itens.reduce((s, i) => s + i.preco * i.quantidadeInicial, 0);
        }
        db.vendas.filter((v) => v.status === 'CONCLUIDA' && noPeriodo(v.ocorridaEm, q)).forEach((v) => v.alocacoes.filter((a) => itens.some((i) => i.id === a.itemId)).forEach((a) => { g.vendidos! += a.quantidade; g.receita! += a.precoUnit * a.quantidade; }));
        g.emEstoque! += itens.reduce((s, i) => s + i.saldo.BAZAR + i.saldo.DOACOES, 0);
        grupos.set(chave, g);
      }
      const linhas = [...grupos].map(([nome, g]) => ({ nome, recebidos: g.recebidos!, descartados: g.descartados!, valorAtribuido: fromCents(g.valorAtribuido!), vendidos: g.vendidos!, receita: fromCents(g.receita!), emEstoque: g.emEstoque! }));
      return { titulo: `Prestação de contas por ${modo}`, colunas: [
        { chave: 'nome', rotulo: modo === 'parceiro' ? 'Parceiro' : 'Campanha' }, { chave: 'recebidos', rotulo: 'Itens recebidos', tipo: 'number' }, { chave: 'descartados', rotulo: 'Descartados', tipo: 'number' },
        { chave: 'valorAtribuido', rotulo: 'Valor atribuído', tipo: 'money' }, { chave: 'vendidos', rotulo: 'Vendidos', tipo: 'number' }, { chave: 'receita', rotulo: 'Receita', tipo: 'money' }, { chave: 'emEstoque', rotulo: 'Saldo em estoque', tipo: 'number' },
      ], linhas };
    }
    case 'vendas': {
      const vs = db.vendas.filter((v) => noPeriodo(v.ocorridaEm, q));
      return { titulo: 'Vendas no período', colunas: [{ chave: 'numero', rotulo: 'Nº', tipo: 'number' }, { chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'operador', rotulo: 'Operador' }, { chave: 'status', rotulo: 'Status' }, { chave: 'total', rotulo: 'Total', tipo: 'money' }],
        linhas: vs.map((v) => ({ numero: v.numero, data: v.ocorridaEm, operador: v.operadorNome, status: v.status, total: v.total })),
        totais: { total: fromCents(vs.filter((v) => v.status === 'CONCLUIDA').reduce((s, v) => s + toCents(v.total), 0)) } };
    }
    case 'estoque': return { titulo: 'Posição de estoque', colunas: [{ chave: 'categoria', rotulo: 'Categoria' }, { chave: 'bazar', rotulo: 'Bazar', tipo: 'number' }, { chave: 'doacoes', rotulo: 'Doações', tipo: 'number' }],
      linhas: db.categorias.map((c) => ({ categoria: c.nome, bazar: db.itens.filter((i) => i.categoriaId === c.id).reduce((s, i) => s + i.saldo.BAZAR, 0), doacoes: db.itens.filter((i) => i.categoriaId === c.id).reduce((s, i) => s + i.saldo.DOACOES, 0) })) };
    case 'descartes': return { titulo: 'Descartes', colunas: [{ chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'lote', rotulo: 'Lote', tipo: 'number' }, { chave: 'categoria', rotulo: 'Categoria' }, { chave: 'motivo', rotulo: 'Motivo' }],
      linhas: db.descartes.filter((d) => !d.revertido && noPeriodo(d.registradoEm, q)).map((d) => ({ data: d.registradoEm, lote: db.lotes.find((l) => l.id === d.loteId)!.numero, categoria: nomeCat(d.categoriaId), motivo: db.motivosDescarte.find((m) => m.id === d.motivoId)!.nome })) };
    case 'transferencias': return { titulo: 'Transferências', colunas: [{ chave: 'data', rotulo: 'Data', tipo: 'date' }, { chave: 'item', rotulo: 'Item' }, { chave: 'descricao', rotulo: 'Movimento' }, { chave: 'quantidade', rotulo: 'Qtd.', tipo: 'number' }, { chave: 'usuario', rotulo: 'Usuário' }],
      linhas: db.movs.filter((m) => m.tipo === 'TRANSFERENCIA' && m.quantidade > 0 && noPeriodo(m.ocorridoEm, q)).map((m) => ({ data: m.ocorridoEm, item: db.itens.find((i) => i.id === m.itemId)!.descricao, descricao: m.descricao, quantidade: m.quantidade, usuario: m.usuarioNome })) };
    case 'fiado': return { titulo: 'Fiado em aberto', colunas: [{ chave: 'cliente', rotulo: 'Cliente' }, { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'date' }, { chave: 'saldo', rotulo: 'Saldo', tipo: 'money' }, { chave: 'status', rotulo: 'Status' }],
      linhas: db.contasReceber.filter((c) => c.status === 'ABERTA' || c.status === 'PARCIAL').map((c) => ({ cliente: c.clienteNome, vencimento: c.vencimento, saldo: c.saldo, status: c.status })) };
    default: return falha(404, 'Relatório inexistente');
  }
}
rota('GET', '/relatorios/:tipo', ['relatorios.consultar'], ({ params, query }) => {
  const r = relatorio(params.tipo!, query); const fmt = query.get('formato') ?? 'json';
  if (fmt === 'json') return ok(r);
  const csv = [r.colunas.map((c) => c.rotulo).join(';'), ...r.linhas.map((l) => r.colunas.map((c) => `"${String(l[c.chave] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
  const tipos: Record<string, string> = { csv: 'text/csv', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  // Mock: devolve CSV para qualquer formato (o servidor real gera PDF/XLSX de verdade).
  return { status: 200, headers: { 'content-type': tipos[fmt] ?? 'text/csv' }, body: new Blob(['﻿' + csv], { type: 'text/csv' }) };
});

// ---------------- PRV / ADM ----------------
rota('GET', '/titulares/:tipo/:id/exportar', ['privacidade.gerenciar'], ({ user, params }) => {
  const c = db.clientes.find((x) => x.id === params.id); if (!c || params.tipo !== 'cliente') return problem(404, 'Titular não encontrado');
  auditar(user, 'TITULAR_EXPORTADO', 'cliente', c.id);
  const dados = { cliente: c, contasReceber: db.contasReceber.filter((x) => x.clienteId === c.id), compras: db.vendas.filter((v) => v.clienteId === c.id).map(vendaDto) };
  return { status: 200, headers: { 'content-type': 'application/json' }, body: new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }) };
});
rota('POST', '/titulares/:tipo/:id/anonimizar', ['privacidade.gerenciar'], ({ user, params, body }) => {
  const c = db.clientes.find((x) => x.id === params.id); if (!c) return problem(404, 'Titular não encontrado');
  if (c.anonimizado) return problem(409, 'Titular já anonimizado', 'JA_ANONIMIZADO');
  const debito = db.contasReceber.some((x) => x.clienteId === c.id && (x.status === 'ABERTA' || x.status === 'PARCIAL'));
  if (debito && body?.confirmar !== true) return problem(409, 'Cliente possui débito em aberto. Confirme para anonimizar mesmo assim.', 'CLIENTE_COM_DEBITO');
  Object.assign(c, { nome: `Titular anonimizado ${c.id.slice(-4)}`, telefone: '', anonimizado: true, ativo: false });
  db.contasReceber.filter((x) => x.clienteId === c.id).forEach((x) => { x.clienteNome = c.nome; });
  auditar(user, 'TITULAR_ANONIMIZADO', 'cliente', c.id); return { status: 204, headers: {}, body: null };
});
rota('GET', '/parametros', ['parametros.gerenciar'], () => ok(db.parametros));
rota('PUT', '/parametros', ['parametros.gerenciar'], ({ user, body }) => {
  for (const v of body?.valores ?? []) { const p = db.parametros.find((x) => x.chave === v.chave); if (!p) return problem(400, `Parâmetro desconhecido: ${v.chave}`); if (p.tipo === 'number' && !/^\d+$/.test(v.valor)) return problem(400, `Valor inválido para ${p.descricao}`); p.valor = v.valor; }
  auditar(user, 'PARAMETROS_ALTERADOS', 'parametro', '*'); return ok(db.parametros);
});
rota('POST', '/importacoes/:tipo', ['cadastros.gerenciar'], ({ body }) => {
  const f = (body as FormData).get('arquivo'); if (!f) return problem(400, 'Arquivo obrigatório');
  return ok({ gravado: false, inseridos: 0, duplicados: [{ linha: 3, valor: 'Roupa adulto' }], erros: [] });
});

// ---------------- dispatcher ----------------
const LATENCIA_MS = 120;
export const mockTransport: Transport = async (req: TransportRequest) => {
  await new Promise((r) => setTimeout(r, LATENCIA_MS));
  const [pathname, qs = ''] = req.path.split('?');
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const r = rotas.find((x) => x.method === req.method && x.re.test(pathname!));
  if (!r) return problem(404, 'Rota inexistente');
  const m = pathname!.match(r.re)!;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
  let user: UsuarioDb | undefined;
  if (r.regra !== 'publica') {
    const tok = access.get(headers.authorization?.replace('Bearer ', '') ?? '');
    if (!tok || tok.exp < Date.now()) return problem(401, 'Não autenticado', 'NAO_AUTENTICADO');
    user = db.usuarios.find((u) => u.id === tok.userId && u.ativo);
    if (!user) return problem(401, 'Não autenticado', 'NAO_AUTENTICADO');
    // Fail secure: só passa se a rota declarou permissões e o perfil tem ao menos uma.
    if (Array.isArray(r.regra) && !r.regra.some((p) => perfilDe(user!).permissoes.includes(p))) return problem(403, 'Você não tem permissão para esta ação', 'SEM_PERMISSAO');
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  try {
    return await r.h({ user: user!, params, query: new URLSearchParams(qs), body, headers });
  } catch (e) {
    if (e instanceof Falha) return e.r;
    console.error('[mock] erro interno', e);
    return problem(500, 'Erro interno', 'ERRO_INTERNO'); // sem stack trace ao cliente
  }
};
// Utilitário de depuração no console do DEV (não expõe nada em produção — este módulo nem é empacotado).
export const _mockDb = db;
export const _nomeUser = nomeUser;
