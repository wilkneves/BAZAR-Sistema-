/** Hash de senha com argon2id (RNF-07) e geração de senha provisória. */
import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import type { Db } from '../../lib/prisma.js';
import { paramNum } from '../../lib/parametros.js';
import { AppError } from '../../lib/errors.js';

const OPCOES = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashSenha = (s: string) => argon2.hash(s, OPCOES);
export async function conferirSenha(hash: string, s: string): Promise<boolean> {
  try { return await argon2.verify(hash, s); } catch { return false; }
}

/** Hash fixo para igualar o tempo de resposta quando o login não existe (evita enumeração). */
let hashFicticio: Promise<string> | null = null;
export const hashParaTempoConstante = () => (hashFicticio ??= hashSenha('senha-ficticia-para-tempo-constante'));

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export function senhaProvisoria(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export async function validarPolitica(db: Db, nova: string, login: string, atual?: string): Promise<void> {
  const min = await paramNum(db, 'senha.tamanho_minimo', 8);
  const erros: string[] = [];
  if (nova.length < Math.max(8, min)) erros.push(`mínimo de ${Math.max(8, min)} caracteres`);
  if (nova.length > 128) erros.push('máximo de 128 caracteres');
  if (atual !== undefined && nova === atual) erros.push('deve ser diferente da atual');
  if (nova.toLowerCase().includes(login.toLowerCase())) erros.push('não pode conter o login');
  if (erros.length) throw new AppError(400, 'Senha não atende à política', 'SENHA_FRACA', `A nova senha: ${erros.join(', ')}`);
}
