/**
 * Monta a aplicação Fastify: segurança de borda (helmet, CORS restrito, rate limit),
 * autenticação/autorização centralizadas, erros RFC 9457 e os módulos de domínio.
 */
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { env, corsOrigins } from './config/env.js';
import authPlugin from './plugins/auth.js';
import { AppError, traduzirErroBanco, type ProblemDetails } from './lib/errors.js';
import { prisma } from './lib/prisma.js';
import { rotasAuth } from './modules/acs/auth.routes.js';
import { rotasUsuarios } from './modules/acs/usuarios.routes.js';
import { rotasCadastros } from './modules/cad/cadastros.routes.js';
import { rotasClientes } from './modules/cad/clientes.routes.js';
import { rotasLotes } from './modules/ent/lotes.routes.js';
import { rotasEstoque } from './modules/est/estoque.routes.js';
import { rotasPdv } from './modules/pdv/pdv.routes.js';
import { rotasCaixa } from './modules/cxa/caixa.routes.js';
import { rotasFinanceiro } from './modules/fin/financeiro.routes.js';
import { rotasFiscal } from './modules/fis/fiscal.routes.js';
import { rotasRelatorios } from './modules/rel/relatorios.routes.js';
import { rotasAdmin } from './modules/adm/admin.routes.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // teto técnico; o limite de negócio vem do parâmetro anexo.tamanho_max_mb

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    genReqId: () => randomUUID(),
    requestIdHeader: false, // não confia em id vindo do cliente
    logger: {
      level: env.LOG_LEVEL,
      // RNF-15 / LGPD: nada de token, cookie, senha ou PII nos logs
      redact: {
        paths: [
          'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
          '*.senha', '*.senhaAtual', '*.novaSenha', '*.telefone', '*.nome', '*.accessToken',
        ],
        censor: '[omitido]',
      },
      serializers: {
        req: (r) => ({ method: r.method, url: r.url.split('?')[0], reqId: r.id, remoteAddress: r.ip }),
      },
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-None-Match', 'Accept'],
    exposedHeaders: ['ETag', 'Content-Disposition'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 } });
  await app.register(authPlugin);

  // Sem cache para respostas da API (dados pessoais e financeiros)
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/') && !reply.getHeader('cache-control')) reply.header('Cache-Control', 'no-store');
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).type('application/problem+json').send({
      type: 'about:blank', title: 'Rota inexistente', status: 404, code: 'ROTA_INEXISTENTE', requestId: req.id,
    } satisfies ProblemDetails);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    let p: ProblemDetails;
    const app409 = traduzirErroBanco(err);
    if (app409 instanceof AppError) {
      p = { type: `https://bazar.local/erros/${app409.code ?? app409.status}`, title: app409.title, status: app409.status, code: app409.code, detail: app409.detail, errors: app409.errors };
      if (app409.status >= 500) req.log.error({ err }, 'erro de aplicação');
    } else if (err.statusCode === 429) {
      p = { type: 'about:blank', title: 'Muitas tentativas. Aguarde e tente novamente.', status: 429, code: 'RATE_LIMIT' };
    } else if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      p = { type: 'about:blank', title: 'Arquivo ou corpo maior que o permitido', status: 413, code: 'TAMANHO_EXCEDIDO' };
    } else if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      p = { type: 'about:blank', title: 'Tipo de conteúdo não aceito', status: 415, code: 'TIPO_INVALIDO' };
    } else if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      p = { type: 'about:blank', title: 'Requisição inválida', status: err.statusCode, code: 'REQUISICAO_INVALIDA' };
    } else {
      req.log.error({ err }, 'erro interno'); // stack só no log do servidor
      p = { type: 'about:blank', title: 'Erro interno', status: 500, code: 'ERRO_INTERNO' };
    }
    p.requestId = req.id;
    reply.code(p.status).type('application/problem+json').send(p);
  });

  app.get('/health', { config: { acesso: 'publica' } }, async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  await app.register(async (api) => {
    await api.register(rotasAuth);
    await api.register(rotasUsuarios);
    await api.register(rotasCadastros);
    await api.register(rotasClientes);
    await api.register(rotasLotes);
    await api.register(rotasEstoque);
    await api.register(rotasPdv);
    await api.register(rotasCaixa);
    await api.register(rotasFinanceiro);
    await api.register(rotasFiscal);
    await api.register(rotasRelatorios);
    await api.register(rotasAdmin);
  }, { prefix: '/api/v1' });

  return app;
}
