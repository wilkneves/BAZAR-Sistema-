# Banco de dados — scripts do DBA

PostgreSQL 16 (compatível com 11+). Fonte da verdade do esquema: `prisma/migrations/*` aplicadas com `npx prisma migrate deploy` (papel **bazar_owner**). Os arquivos daqui são para revisão, testes e operação.

| Arquivo | O que faz | Quem roda / onde |
|---|---|---|
| `01_ddl_completo.sql` | 0001 + 0002 + 0003 concatenadas: instalação do zero sem Prisma | dono, banco **vazio** |
| `02_dml_dados_iniciais.sql` | Dados de referência idempotentes (locais, permissões, perfis, motivos, parâmetros, regra fiscal GERAL) | dono |
| `03_seguranca_papeis.sql` | Papéis `bazar_api` (sem DELETE, sem escrita no saldo, timeouts) e `bazar_relatorio` (somente leitura, sem PII). Senhas por `-v`, vindas do cofre | superusuário, **após cada deploy** |
| `04_testes_0003.sql` | 28 tentativas de violar as regras da 0003 (tudo em ROLLBACK) | superusuário, banco de teste |
| `05_carga_volume_teste.sql` | ~5 anos fictícios: 64 mil itens, 129 mil movimentações, 60 mil vendas (recusa rodar fora de banco de teste) | dono, banco de teste |
| `06_benchmark_queries.sql` | EXPLAIN ANALYZE das 13 consultas mais pesadas da API (SQL copiado de `src/`) | qualquer, após o 05 |
| `07_manutencao_rotina.sql` | Limpeza de sessões/idempotência vencidas, conferência do saldo e da prestação de contas, alertas | dono, diário |

Ordem para um ambiente novo:

```bash
npx prisma migrate deploy                                   # MIGRATION_DATABASE_URL = bazar_owner
psql -U postgres -d bazar -v senha_api="$SENHA_API" -f db/03_seguranca_papeis.sql
ADMIN_INITIAL_PASSWORD=... npm run db:seed
psql -U bazar_owner -d bazar -f db/07_manutencao_rotina.sql  # conferência: tudo 0
```

Regra de ouro do saldo: **ninguém escreve em `saldo_estoque`**. Toda mudança de estoque é uma linha em `movimentacao`; o trigger aplica o saldo. Divergência em `fn_confere_saldo()` = investigar a causa; só então `SELECT fn_recalcula_saldo();` (dono, janela sem vendas).
