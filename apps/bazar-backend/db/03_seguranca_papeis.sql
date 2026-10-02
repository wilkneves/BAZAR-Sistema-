-- =====================================================================================
-- Papéis e privilégios (menor privilégio — OWASP ASVS V1.4 / V8, NIST CSF PR.AC-4)
-- Rodar como superusuário/administrador do servidor, DEPOIS das migrações.
-- Senhas NUNCA neste arquivo: passe por variável do psql, vinda do cofre
-- (Azure Key Vault / Google Secret Manager), por exemplo:
--   psql -v ON_ERROR_STOP=1 -v senha_api="$(az keyvault secret show ... --query value -o tsv)" \
--        -v senha_relatorio="$(...)" -d bazar -f db/03_seguranca_papeis.sql
-- Idempotente: pode rodar de novo a cada migração (re-aplica os GRANTs em tabelas novas).
--
--  bazar_owner     dono do schema; usado SÓ pelas migrações (prisma migrate deploy)
--  bazar_api       a API: SELECT/INSERT/UPDATE; sem DELETE (D-09), sem DDL, sem escrita no saldo
--  bazar_relatorio leitura para BI/conferência; sem PII de cliente (colunas pessoais negadas)
-- =====================================================================================
\set ON_ERROR_STOP on
\if :{?senha_api}
\else
  \echo 'Defina -v senha_api=... (vinda do cofre de segredos)'
  \quit
\endif
\if :{?senha_relatorio}
\else
  \set senha_relatorio ''
\endif

SELECT format('CREATE ROLE bazar_api LOGIN') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bazar_api') \gexec
ALTER ROLE bazar_api WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 40 PASSWORD :'senha_api';
-- tempo máximo de consulta/espera de trava: falha rápida em vez de pendurar o PDV
ALTER ROLE bazar_api SET statement_timeout = '15s';
ALTER ROLE bazar_api SET lock_timeout = '5s';
ALTER ROLE bazar_api SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE bazar_api SET timezone = 'UTC';

-- o banco público não aceita objetos de quem não é dono
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO bazar_api;
GRANT USAGE ON SCHEMA public TO bazar_api;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO bazar_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bazar_api;
-- exclusão só nas tabelas técnicas (logout/limpeza, troca de permissões do perfil)
GRANT DELETE ON sessao_usuario, idempotencia, perfil_permissao TO bazar_api;
-- saldo é derivado: a API só lê (quem escreve é o trigger SECURITY DEFINER)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON saldo_estoque FROM bazar_api;
-- dados fixos e trilha de auditoria: a API não altera
REVOKE UPDATE ON local_estoque, permissao, auditoria, movimentacao, venda_item, venda_pagamento, caixa_lancamento FROM bazar_api;
-- manutenção do saldo é do DBA
REVOKE ALL ON FUNCTION fn_recalcula_saldo() FROM PUBLIC, bazar_api;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM bazar_api;

-- ------------------------------------------------------------------ leitura (opcional)
SELECT 'CREATE ROLE bazar_relatorio LOGIN' WHERE :'senha_relatorio' <> '' AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bazar_relatorio') \gexec
SELECT format('ALTER ROLE bazar_relatorio WITH LOGIN NOINHERIT CONNECTION LIMIT 5 PASSWORD %L', :'senha_relatorio')
 WHERE :'senha_relatorio' <> '' \gexec
SELECT 'ALTER ROLE bazar_relatorio SET default_transaction_read_only = on' WHERE :'senha_relatorio' <> '' \gexec
SELECT 'ALTER ROLE bazar_relatorio SET statement_timeout = ''60s''' WHERE :'senha_relatorio' <> '' \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO bazar_relatorio', current_database()) WHERE :'senha_relatorio' <> '' \gexec
SELECT 'GRANT USAGE ON SCHEMA public TO bazar_relatorio' WHERE :'senha_relatorio' <> '' \gexec
SELECT 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO bazar_relatorio' WHERE :'senha_relatorio' <> '' \gexec
-- LGPD (RN-29): sem dados pessoais, credenciais nem tokens para o papel de leitura
SELECT 'REVOKE SELECT ON cliente, consentimento, usuario, sessao_usuario, idempotencia, auditoria, pendencia_sincronizacao FROM bazar_relatorio'
 WHERE :'senha_relatorio' <> '' \gexec
SELECT 'GRANT SELECT (id, ativo, anonimizado_em, criado_em) ON cliente TO bazar_relatorio' WHERE :'senha_relatorio' <> '' \gexec
SELECT 'GRANT SELECT (id, nome, perfil_id, ativo) ON usuario TO bazar_relatorio' WHERE :'senha_relatorio' <> '' \gexec
SELECT 'REVOKE SELECT ON parceiro FROM bazar_relatorio' WHERE :'senha_relatorio' <> '' \gexec
SELECT 'GRANT SELECT (id, nome, tipo, nao_identificado, cidade, ativo, criado_em) ON parceiro TO bazar_relatorio' WHERE :'senha_relatorio' <> '' \gexec

-- ------------------------------------------------------------------ conferência
SELECT r.rolname, t.privilege_type, count(*) AS tabelas
FROM information_schema.role_table_grants t JOIN pg_roles r ON r.rolname = t.grantee
WHERE t.table_schema = 'public' AND r.rolname IN ('bazar_api', 'bazar_relatorio')
GROUP BY 1, 2 ORDER BY 1, 2;
