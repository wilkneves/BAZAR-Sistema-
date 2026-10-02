/**
 * ACS — login, refresh com rotação, logout, troca de senha e /me.
 * Contrato: front-end src/api/modules/auth.ts.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { env, corsOrigins } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { parse } from '../../lib/http.js';
import { paramNum } from '../../lib/parametros.js';
import { auditar } from '../../lib/audit.js';
import { money } from '../../lib/money.js';
import { assinarAccess, novoRefreshToken, hashToken, COOKIE_REFRESH, COOKIE_PATH } from '../../lib/tokens.js';
import { conferirSenha, hashParaTempoConstante, hashSenha, validarPolitica } from './senhas.js';
import { exigirUsuario } from '../../plugins/auth.js';
import { tentativas } from './tentativas.js';

export async function montarMe(usuarioId: string) {
  const u = await prisma.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
    select: {
      id: true, nome: true, login: true, trocarSenha: true,
      perfil: { select: { id: true, nome: true, ativo: true, limiteDescontoPct: true, permissoes: { select: { permissaoCodigo: true } } } },
    },
  });
  return {
    id: u.id, nome: u.nome, login: u.login,
    perfil: { id: u.perfil.id, nome: u.perfil.nome },
    permissoes: u.perfil.ativo ? u.perfil.permissoes.map((p) => p.permissaoCodigo).sort() : [],
    limiteDesconto: money(u.perfil.limiteDescontoPct),
    trocarSenha: u.trocarSenha,
  };
}

/** Sessão deslizante: inatividade (parâmetro) limitada ao máximo absoluto. */
async function expiracao(criadaEm: Date): Promise<Date> {
  const inatividadeMin = await paramNum(prisma, 'sessao.timeout_min', 30);
  const porInatividade = Date.now() + Math.max(5, inatividadeMin) * 60_000;
  const absoluto = criadaEm.getTime() + env.SESSION_MAX_HOURS * 3_600_000;
  return new Date(Math.min(porInatividade, absoluto));
}

function gravarCookie(reply: FastifyReply, token: string, expira: Date) {
  reply.setCookie(COOKIE_REFRESH, token, {
    httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: COOKIE_PATH, expires: expira,
  });
}
function limparCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE_REFRESH, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: COOKIE_PATH });
}

/** Defesa extra contra CSRF nas rotas que usam o cookie (além de SameSite=Strict). */
function exigirOrigemConfiavel(req: FastifyRequest) {
  const origem = req.headers.origin;
  if (origem && !corsOrigins.includes(origem)) throw new AppError(403, 'Origem não permitida', 'ORIGEM_INVALIDA');
}

async function abrirSessao(usuarioId: string, criadaEm = new Date(), terminalId: string | null = null) {
  const token = novoRefreshToken();
  const expiraEm = await expiracao(criadaEm);
  const s = await prisma.sessaoUsuario.create({
    data: { usuarioId, terminalId, refreshTokenHash: hashToken(token), criadaEm, expiraEm },
  });
  const accessToken = await assinarAccess({ sub: usuarioId, sid: s.id });
  return { token, expiraEm, accessToken };
}

const zLogin = z.object({ login: z.string().trim().min(1).max(100), senha: z.string().min(1).max(256) });
const zTroca = z.object({ senhaAtual: z.string().min(1).max(256), novaSenha: z.string().min(1).max(256) });

export async function rotasAuth(app: FastifyInstance) {
  const limiteAuth = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/auth/login', { config: { acesso: 'publica', ...limiteAuth } }, async (req, reply) => {
    const { login: bruto, senha } = parse(zLogin, req.body);
    const login = bruto.toLowerCase();

    const bloqueio = tentativas.bloqueadoAte(login);
    if (bloqueio) throw new AppError(429, 'Muitas tentativas. Tente novamente em alguns minutos.', 'LOGIN_BLOQUEADO');

    const u = await prisma.usuario.findUnique({ where: { login }, select: { id: true, senhaHash: true, ativo: true } });
    const ok = u ? await conferirSenha(u.senhaHash, senha) : (await conferirSenha(await hashParaTempoConstante(), senha), false);
    if (!u || !ok || !u.ativo) {
      tentativas.registrarErro(login);
      req.log.warn({ evento: 'login_recusado' }, 'login recusado'); // sem login/senha no log
      throw new AppError(401, 'Login ou senha inválidos', 'CREDENCIAIS_INVALIDAS'); // mensagem genérica
    }
    tentativas.limpar(login);
    await prisma.usuario.update({ where: { id: u.id }, data: { ultimoAcessoEm: new Date() } });
    const s = await abrirSessao(u.id);
    gravarCookie(reply, s.token, s.expiraEm);
    return { accessToken: s.accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC, usuario: await montarMe(u.id) };
  });

  app.post('/auth/refresh', { config: { acesso: 'publica', ...limiteAuth } }, async (req, reply) => {
    exigirOrigemConfiavel(req);
    const token = req.cookies[COOKIE_REFRESH];
    if (!token || token.length > 200) throw new AppError(401, 'Sessão expirada', 'SESSAO_EXPIRADA');
    const atual = await prisma.sessaoUsuario.findUnique({
      where: { refreshTokenHash: hashToken(token) },
      include: { usuario: { select: { ativo: true } } },
    });
    if (!atual) { limparCookie(reply); throw new AppError(401, 'Sessão expirada', 'SESSAO_EXPIRADA'); }
    if (atual.revogadaEm) {
      // Reuso de refresh já trocado/revogado => possível roubo: revoga todas as sessões do usuário.
      await prisma.sessaoUsuario.updateMany({ where: { usuarioId: atual.usuarioId, revogadaEm: null }, data: { revogadaEm: new Date() } });
      req.log.warn({ evento: 'refresh_reutilizado', usuarioId: atual.usuarioId }, 'refresh reutilizado');
      limparCookie(reply);
      throw new AppError(401, 'Sessão revogada', 'REFRESH_REUTILIZADO');
    }
    if (atual.expiraEm < new Date() || !atual.usuario.ativo) {
      await prisma.sessaoUsuario.update({ where: { id: atual.id }, data: { revogadaEm: new Date() } });
      limparCookie(reply);
      throw new AppError(401, 'Sessão expirada', 'SESSAO_EXPIRADA');
    }
    // Rotação: revoga a sessão atual (condicional evita corrida entre dois refresh simultâneos) e abre outra.
    const r = await prisma.sessaoUsuario.updateMany({ where: { id: atual.id, revogadaEm: null }, data: { revogadaEm: new Date() } });
    if (r.count !== 1) { limparCookie(reply); throw new AppError(401, 'Sessão expirada', 'SESSAO_EXPIRADA'); }
    const s = await abrirSessao(atual.usuarioId, atual.criadaEm, atual.terminalId);
    gravarCookie(reply, s.token, s.expiraEm);
    return { accessToken: s.accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC };
  });

  app.post('/auth/logout', { config: { acesso: 'autenticado' } }, async (req, reply) => {
    const u = exigirUsuario(req);
    await prisma.sessaoUsuario.updateMany({ where: { id: u.sessaoId, revogadaEm: null }, data: { revogadaEm: new Date() } });
    limparCookie(reply);
    return reply.code(204).send();
  });

  app.put('/auth/senha', { config: { acesso: 'autenticado', ...limiteAuth } }, async (req, reply) => {
    const u = exigirUsuario(req);
    const { senhaAtual, novaSenha } = parse(zTroca, req.body);
    const atual = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { senhaHash: true } });
    if (!(await conferirSenha(atual.senhaHash, senhaAtual))) {
      throw new AppError(400, 'Senha atual incorreta', 'SENHA_ATUAL_INVALIDA');
    }
    await validarPolitica(prisma, novaSenha, u.login, senhaAtual);
    const hash = await hashSenha(novaSenha);
    await prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id: u.id }, data: { senhaHash: hash, trocarSenha: false } });
      // RF-ACS-04: outras sessões são encerradas
      await tx.sessaoUsuario.updateMany({ where: { usuarioId: u.id, revogadaEm: null, NOT: { id: u.sessaoId } }, data: { revogadaEm: new Date() } });
      await auditar(tx, { usuarioId: u.id, ip: req.ip }, 'SENHA_ALTERADA', 'usuario', u.id);
    });
    return reply.code(204).send();
  });

  app.get('/me', { config: { acesso: 'autenticado' } }, async (req) => montarMe(exigirUsuario(req).id));
}
