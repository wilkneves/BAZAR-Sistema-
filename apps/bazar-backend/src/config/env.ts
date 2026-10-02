/**
 * Configuração validada na subida. Segredos SÓ por variável de ambiente
 * (em produção, injetadas pelo Azure Key Vault ou Google Secret Manager) — nunca no código.
 * Falha de configuração derruba o processo (fail secure).
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().min(1).default('bazar-luz-da-esperanca'),
  JWT_AUDIENCE: z.string().min(1).default('bazar-web'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(24).default(12),
  CORS_ORIGINS: z.string().min(1),
  COOKIE_SECURE: bool.default(true),
  TRUST_PROXY: bool.default(false),
  UPLOAD_DIR: z.string().default('./uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Mostra só os NOMES das variáveis inválidas — nunca os valores.
  const campos = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.error(`[config] variáveis de ambiente inválidas — ${campos}`);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
if (corsOrigins.includes('*')) {
  console.error('[config] CORS_ORIGINS não pode conter "*"');
  process.exit(1);
}
if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
  console.error('[config] COOKIE_SECURE=false não é permitido em produção');
  process.exit(1);
}
