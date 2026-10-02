/**
 * Tokens de acesso (JWT HS256, algoritmo FIXADO, exp curto, iss/aud validados)
 * e refresh token opaco (256 bits) guardado só como hash SHA-256 em sessao_usuario.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../config/env.js';

const key = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';

export interface AccessClaims { sub: string; sid: string }

export async function assinarAccess(c: AccessClaims): Promise<string> {
  return new SignJWT({ sid: c.sid })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(c.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
    .sign(key);
}

/** Retorna as claims ou null (expirado, assinatura/alg/iss/aud inválidos). */
export async function verificarAccess(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALG], // impede alg=none / troca de algoritmo
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      clockTolerance: 5,
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch (e) {
    if (e instanceof joseErrors.JOSEError) return null;
    throw e;
  }
}

export const novoRefreshToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export const COOKIE_REFRESH = 'bz_rt';
export const COOKIE_PATH = '/api/v1/auth';
