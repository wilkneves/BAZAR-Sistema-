/**
 * Seed da PRIMEIRA instalação (doc 04, seção 11, passo 5): usuário Administrador inicial e
 * regra fiscal geral ISENTO (RN-17). Perfis, permissões, motivos, parâmetros e o parceiro
 * "Doador não identificado" já vêm da migração 0002_invariantes.
 * Senha inicial SÓ por variável de ambiente; troca obrigatória no primeiro acesso.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const login = (process.env.ADMIN_LOGIN ?? 'admin').trim().toLowerCase();
const senha = process.env.ADMIN_INITIAL_PASSWORD ?? '';
if (!url) throw new Error('Defina MIGRATION_DATABASE_URL ou DATABASE_URL');
if (senha.length < 12) throw new Error('Defina ADMIN_INITIAL_PASSWORD com pelo menos 12 caracteres (não use a de exemplo)');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const PERFIL_ADMIN = '00000000-0000-4000-8000-0000000000a1';

const existente = await prisma.usuario.findUnique({ where: { login } });
const admin = existente ?? await prisma.usuario.create({
  data: {
    nome: 'Administrador', login, perfilId: PERFIL_ADMIN, trocarSenha: true,
    senhaHash: await argon2.hash(senha, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
  },
});
if (!(await prisma.regraFiscal.findFirst({ where: { escopo: 'GERAL' } }))) {
  await prisma.regraFiscal.create({
    data: { escopo: 'GERAL', situacao: 'ISENTO', aliquota: '0', vigenciaInicio: new Date('2026-01-01T00:00:00Z'),
      fundamentoLegal: 'Situação atual: isenta (PA-05 em análise com o contador)', criadaPorId: admin.id },
  });
}
console.log(existente ? 'Administrador já existia; nada alterado.' : `Administrador "${login}" criado (troca de senha obrigatória no 1º acesso).`);
await prisma.$disconnect();
