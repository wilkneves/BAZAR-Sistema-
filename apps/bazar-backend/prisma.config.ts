/**
 * Prisma 7: a URL do banco saiu do schema e fica aqui (doc 04, seção 11).
 * DATABASE_URL vem do ambiente (.env local fora do Git; em produção, injetada pelo
 * Azure Key Vault / Google Secret Manager). Migrações usam o papel DONO do schema;
 * a API usa outro papel, sem DELETE (ver fim de 0002_invariantes).
 */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // generate não precisa de banco; migrate exige a URL (falha clara se ausente)
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? '' },
});
