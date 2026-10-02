-- =====================================================================================
-- Rotina de manutenção (sugestão: diária, fora do horário do bazar, por agendador do servidor).
-- Rodar com o papel DONO. Não apaga dado de negócio (D-09): só registros técnicos vencidos.
--   psql -v ON_ERROR_STOP=1 -d bazar -f db/07_manutencao_rotina.sql
-- =====================================================================================
\set ON_ERROR_STOP on

-- 1. Sessões de login vencidas ou revogadas há mais de 30 dias (refresh_token_hash não serve mais)
DELETE FROM sessao_usuario
 WHERE coalesce(revogada_em, expira_em) < now() - interval '30 days';

-- 2. Chaves de idempotência com mais de 30 dias (o trigger recusa apagar as recentes)
DELETE FROM idempotencia WHERE criado_em < now() - interval '30 days';

-- 3. Saldo materializado × histórico (deve voltar 0 linhas). Se voltar algo: NÃO corrigir
--    à mão — investigar e, como DBA, rodar SELECT fn_recalcula_saldo(); em janela sem vendas.
SELECT 'divergencias_saldo' AS conferencia, count(*) AS qtd FROM fn_confere_saldo()
UNION ALL
-- 4. Equação da prestação de contas (doc 04 §7.2) — deve ser 0
SELECT 'lotes_com_equacao_aberta', count(*) FROM vw_prestacao_contas_lote
 WHERE itens_aprovados <> itens_vendidos + em_estoque_bazar + em_estoque_doacoes + itens_baixados - ajustes_liquidos
UNION ALL
-- 5. Alertas operacionais
SELECT 'caixas_abertos_ha_mais_de_18h', count(*) FROM caixa_sessao WHERE status = 'ABERTO' AND aberto_em < now() - interval '18 hours'
UNION ALL
SELECT 'pendencias_offline_abertas', count(*) FROM pendencia_sincronizacao WHERE status = 'PENDENTE'
UNION ALL
SELECT 'contas_pagar_vencidas', count(*) FROM conta_pagar WHERE status = 'ABERTA' AND vencimento < current_date;

-- 6. Estatísticas das tabelas que mais crescem (o autovacuum cuida do resto)
ANALYZE movimentacao;
ANALYZE saldo_estoque;
ANALYZE venda;
ANALYZE venda_item;
