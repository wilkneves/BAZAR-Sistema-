/**
 * AuthN/AuthZ centralizados (RF-ACS-01/02):
 *  - toda rota declara `config.acesso` — rota sem declaração derruba a subida (fail secure);
 *  - access token validado (alg fixo, iss, aud, exp) + sessão não revogada + usuário ativo;
 *  - permissões lidas do perfil no servidor a cada requisição (o menu do front é só UX);
 *  - usuário com senha provisória só acessa /me, troca de senha e logout.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { verificarAccess } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';
import type { Permissao, RegraAcesso } from '../lib/permissoes.js';

export interface UsuarioCtx {
  id: string;
  nome: string;
  login: string;
  perfilId: string;
  perfilNome: string;
  permissoes: Set<Permissao>;
  limiteDescontoPct: number;
  trocarSenha: boolean;
  sessaoId: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    acesso?: RegraAcesso;
  }
  interface FastifyRequest {
    usuario: UsuarioCtx | null;
  }
}

const LIBERADAS_COM_SENHA_PROVISORIA = new Set(['/api/v1/me', '/api/v1/auth/senha', '/api/v1/auth/logout']);

export function exigirUsuario(req: FastifyRequest): UsuarioCtx {
  if (!req.usuario) throw new AppError(401, 'Não autenticado', 'NAO_AUTENTICADO');
  return req.usuario;
}
export const tem = (u: UsuarioCtx, p: Permissao) => u.permissoes.has(p);

async function autenticar(req: FastifyRequest): Promise<UsuarioCtx> {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ') || h.length > 4096) throw new AppError(401, 'Não autenticado', 'NAO_AUTENTICADO');
  const claims = await verificarAccess(h.slice(7));
  if (!claims) throw new AppError(401, 'Sessão expirada', 'SESSAO_EXPIRADA');

  const sessao = await prisma.sessaoUsuario.findUnique({
    where: { id: claims.sid },
    select: {
      usuarioId: true, revogadaEm: true, expiraEm: true,
      usuario: {
        select: {
          id: true, nome: true, login: true, ativo: true, trocarSenha: true, perfilId: true,
          perfil: { select: { nome: true, ativo: true, limiteDescontoPct: true, permissoes: { select: { permissaoCodigo: true } } } },
        },
      },
    },
  });
  if (!sessao || sessao.usuarioId !== claims.sub || sessao.revogadaEm || sessao.expiraEm < new Date()) {
    throw new AppError(401, 'Sessão expirada', 'SESSAO_EXPIRADA');
  }
  const u = sessao.usuario;
  if (!u.ativo) throw new AppError(401, 'Sessão expirada', 'SESSAO_EXPIRADA');
  const permissoes = u.perfil.ativo ? new Set(u.perfil.permissoes.map((p) => p.permissaoCodigo as Permissao)) : new Set<Permissao>();
  return {
    id: u.id, nome: u.nome, login: u.login, perfilId: u.perfilId, perfilNome: u.perfil.nome, permissoes,
    limiteDescontoPct: u.perfil.limiteDescontoPct ? Number(u.perfil.limiteDescontoPct.toFixed(2)) : 0,
    trocarSenha: u.trocarSenha, sessaoId: claims.sid,
  };
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('usuario', null);

  app.addHook('onRoute', (opts) => {
    if (!opts.url.startsWith('/api/')) return;
    const regra = opts.config?.acesso;
    if (regra === undefined) {
      throw new Error(`[auth] rota ${opts.method} ${opts.url} sem regra de acesso declarada (fail secure)`);
    }
    if (Array.isArray(regra) && regra.length === 0) {
      throw new Error(`[auth] rota ${opts.method} ${opts.url} com lista de permissões vazia`);
    }
  });

  app.addHook('preHandler', async (req) => {
    const regra = req.routeOptions.config?.acesso;
    if (!req.routeOptions.url?.startsWith('/api/')) return;
    if (regra === undefined) throw new AppError(403, 'Você não tem permissão para esta ação', 'SEM_PERMISSAO');
    if (regra === 'publica') return;

    const u = await autenticar(req);
    req.usuario = u;

    if (u.trocarSenha && !LIBERADAS_COM_SENHA_PROVISORIA.has(req.routeOptions.url)) {
      throw new AppError(403, 'Troque a senha provisória para continuar', 'TROCA_SENHA_OBRIGATORIA');
    }
    if (regra !== 'autenticado' && !regra.some((p) => u.permissoes.has(p))) {
      throw new AppError(403, 'Você não tem permissão para esta ação', 'SEM_PERMISSAO');
    }
  });
});
