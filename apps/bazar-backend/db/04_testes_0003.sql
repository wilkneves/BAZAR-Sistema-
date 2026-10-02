-- =====================================================================================
-- Bateria de testes das regras da 0003 (tenta violar cada uma). Banco de TESTE com dados
-- (ex.: depois do tests/smoke.ts). Tudo roda dentro de uma transação desfeita no final.
-- Uso (dono):  psql -v ON_ERROR_STOP=1 -f db/04_testes_0003.sql
-- Para os testes do papel da API, rode também com:  -v papel_api=bazar_api
-- =====================================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE _res (n serial, teste text, ok boolean, detalhe text);
GRANT ALL ON _res TO PUBLIC; GRANT ALL ON SEQUENCE _res_n_seq TO PUBLIC;

-- espera erro contendo `esperado` (código fn_falha, SQLSTATE ou trecho da mensagem)
CREATE FUNCTION pg_temp.espera_erro(teste text, sql text, esperado text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
    INSERT INTO _res (teste, ok, detalhe) VALUES (teste, false, 'executou sem erro');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _res (teste, ok, detalhe) VALUES (teste, SQLERRM ILIKE '%' || esperado || '%' OR SQLSTATE = esperado, SQLSTATE || ' ' || left(SQLERRM, 120));
  END;
END $$;
CREATE FUNCTION pg_temp.espera(teste text, cond boolean, detalhe text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO _res (teste, ok, detalhe) VALUES (teste, coalesce(cond, false), detalhe);
$$;

-- massa mínima fictícia
SELECT id AS u FROM usuario WHERE ativo ORDER BY criado_em LIMIT 1 \gset
SELECT id AS cat FROM categoria ORDER BY criado_em LIMIT 1 \gset
INSERT INTO lote_entrada (id, tipo, parceiro_id, recebido_em, recebido_por_id)
VALUES ('10000000-0000-4000-8000-000000000001', 'DOACAO', '00000000-0000-4000-8000-0000000000b1', now(), :'u');
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, valor_atribuido, quantidade_inicial, criado_por_id)
VALUES ('10000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-000000000001', :'cat', 'CATEGORIA', 1, 3, :'u');
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id)
VALUES ('10000000-0000-4000-8000-0000000000a1', 'ENTRADA', 1, 3, :'u');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- B. saldo materializado
SELECT pg_temp.espera('saldo nasce com a ENTRADA', fn_saldo('10000000-0000-4000-8000-0000000000a1', 1) = 3);
SELECT pg_temp.espera('view = tabela', (SELECT saldo FROM vw_saldo_estoque WHERE item_id = '10000000-0000-4000-8000-0000000000a1' AND local_id = 1) = 3);
SELECT pg_temp.espera_erro('escrita direta no saldo é recusada (até para o dono)',
  $$UPDATE saldo_estoque SET saldo = 99 WHERE item_id = '10000000-0000-4000-8000-0000000000a1'$$, 'SALDO_DERIVADO');
SELECT pg_temp.espera_erro('inserir saldo direto é recusado',
  $$INSERT INTO saldo_estoque (item_id, local_id, saldo) VALUES ('10000000-0000-4000-8000-0000000000a1', 2, 5)$$, 'SALDO_DERIVADO');
SELECT pg_temp.espera_erro('excluir saldo direto é recusado',
  $$DELETE FROM saldo_estoque WHERE item_id = '10000000-0000-4000-8000-0000000000a1'$$, 'SALDO_DERIVADO');
SELECT pg_temp.espera_erro('INSERT de várias linhas não fura o saldo (2+2 de 3)',
  format($$INSERT INTO movimentacao (item_id, tipo, local_origem_id, local_destino_id, quantidade, usuario_id)
          VALUES ('10000000-0000-4000-8000-0000000000a1', 'TRANSFERENCIA', 1, 2, 2, %L), ('10000000-0000-4000-8000-0000000000a1', 'TRANSFERENCIA', 1, 2, 2, %L)$$, :'u', :'u'),
  'SALDO_INSUFICIENTE');
INSERT INTO movimentacao (item_id, tipo, local_origem_id, local_destino_id, quantidade, usuario_id)
VALUES ('10000000-0000-4000-8000-0000000000a1', 'TRANSFERENCIA', 1, 2, 1, :'u'), ('10000000-0000-4000-8000-0000000000a1', 'TRANSFERENCIA', 1, 2, 1, :'u');
SELECT pg_temp.espera('transferência move o saldo nos dois locais',
  fn_saldo('10000000-0000-4000-8000-0000000000a1', 1) = 1 AND fn_saldo('10000000-0000-4000-8000-0000000000a1', 2) = 2);
SELECT pg_temp.espera_erro('saldo continua nunca negativo', format($$INSERT INTO movimentacao (item_id, tipo, local_origem_id, quantidade, usuario_id, motivo)
  VALUES ('10000000-0000-4000-8000-0000000000a1', 'AJUSTE_SAIDA', 1, 2, %L, 'teste')$$, :'u'), 'SALDO_INSUFICIENTE');
SELECT pg_temp.espera('conferência saldo × histórico sem divergência', NOT EXISTS (SELECT 1 FROM fn_confere_saldo()));
SELECT pg_temp.espera('recálculo controlado reconstrói o saldo', fn_recalcula_saldo() > 0 AND NOT EXISTS (SELECT 1 FROM fn_confere_saldo()));

-- A. FKs de autoria
SELECT pg_temp.espera_erro('movimentação com usuário inexistente', $$INSERT INTO movimentacao (item_id, tipo, local_origem_id, local_destino_id, quantidade, usuario_id)
  VALUES ('10000000-0000-4000-8000-0000000000a1', 'TRANSFERENCIA', 2, 1, 1, gen_random_uuid())$$, '23503');
SELECT pg_temp.espera_erro('lote recebido por usuário inexistente', $$INSERT INTO lote_entrada (id, tipo, parceiro_id, recebido_em, recebido_por_id)
  VALUES (gen_random_uuid(), 'DOACAO', '00000000-0000-4000-8000-0000000000b1', now(), gen_random_uuid())$$, '23503');
SELECT pg_temp.espera_erro('auditoria com usuário inexistente', $$INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES (gen_random_uuid(), 'X', 'x', '1')$$, '23503');
INSERT INTO auditoria (acao, entidade, entidade_id) VALUES ('TESTE_0003', 'x', '1');
SELECT pg_temp.espera('auditoria sem usuário (ex.: login recusado) continua aceita', EXISTS (SELECT 1 FROM auditoria WHERE acao = 'TESTE_0003'));

-- E. formato e LGPD
SELECT pg_temp.espera_erro('documento do parceiro com máscara', $$UPDATE parceiro SET documento = '123.456.789-00' WHERE nao_identificado$$, 'ck_parceiro_documento');
SELECT pg_temp.espera_erro('CNPJ da instituição com máscara', $$UPDATE instituicao SET cnpj = '12.345.678/000'$$, 'ck_instituicao_cnpj');
SELECT pg_temp.espera_erro('segunda instituição', $$INSERT INTO instituicao (id, nome, uf, atualizado_em) VALUES (2, 'Outra', 'PI', now())$$, 'ck_instituicao_unica');
INSERT INTO cliente (id, nome, telefone, atualizado_em) VALUES ('10000000-0000-4000-8000-0000000000c1', 'Cliente fictício', '86999990000', now());
SELECT pg_temp.espera_erro('anonimizar deixando telefone', $$UPDATE cliente SET anonimizado_em = now(), ativo = false WHERE id = '10000000-0000-4000-8000-0000000000c1'$$, 'ck_cliente_anonimizado');
UPDATE cliente SET nome = 'Titular anonimizado 00c1', telefone = '', documento = NULL, observacao = NULL, ativo = false, anonimizado_em = now()
 WHERE id = '10000000-0000-4000-8000-0000000000c1';
SELECT pg_temp.espera_erro('repovoar telefone de anonimizado', $$UPDATE cliente SET telefone = '86999990000' WHERE id = '10000000-0000-4000-8000-0000000000c1'$$, 'ck_cliente_anonimizado');
SELECT pg_temp.espera_erro('desfazer anonimização', $$UPDATE cliente SET anonimizado_em = NULL WHERE id = '10000000-0000-4000-8000-0000000000c1'$$, 'TITULAR_ANONIMIZADO');
SELECT pg_temp.espera_erro('renomear anonimizado', $$UPDATE cliente SET nome = 'Nome real' WHERE id = '10000000-0000-4000-8000-0000000000c1'$$, 'TITULAR_ANONIMIZADO');
INSERT INTO idempotencia (chave, escopo, usuario_id) VALUES ('10000000-0000-4000-8000-0000000000d1', 'teste', :'u');
SELECT pg_temp.espera_erro('chave de idempotência recente não é apagada', $$DELETE FROM idempotencia WHERE chave = '10000000-0000-4000-8000-0000000000d1'$$, 'EXCLUSAO_PROIBIDA');

-- C. prestação de contas: a equação do doc 04 §7.2 fecha em todos os lotes
SELECT pg_temp.espera('equação da prestação de contas fecha em todos os lotes', NOT EXISTS (
  SELECT 1 FROM vw_prestacao_contas_lote
   WHERE itens_aprovados <> itens_vendidos + em_estoque_bazar + em_estoque_doacoes + itens_baixados - ajustes_liquidos));

-- papel da API (opcional)
\if :{?papel_api}
SET LOCAL ROLE :papel_api;
SELECT pg_temp.espera_erro('API não escreve no saldo', $$UPDATE saldo_estoque SET saldo = 0$$, '42501');
SELECT pg_temp.espera_erro('API não roda o recálculo', $$SELECT fn_recalcula_saldo()$$, '42501');
SELECT pg_temp.espera_erro('API não exclui movimentação', $$DELETE FROM movimentacao WHERE id = 1$$, '42501');
SELECT pg_temp.espera('API lê o saldo pela view', (SELECT count(*) FROM vw_saldo_estoque) > 0);
INSERT INTO movimentacao (item_id, tipo, local_origem_id, local_destino_id, quantidade, usuario_id)
VALUES ('10000000-0000-4000-8000-0000000000a1', 'TRANSFERENCIA', 2, 1, 1, :'u');
SELECT pg_temp.espera('API movimenta e o trigger atualiza o saldo', fn_saldo('10000000-0000-4000-8000-0000000000a1', 1) = 2);
RESET ROLE;
\endif

\pset tuples_only off
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHA' END AS r, teste, detalhe FROM _res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS ok, count(*) FILTER (WHERE NOT ok) AS falhas FROM _res;
ROLLBACK;
