-- =====================================================================================
-- Benchmark das consultas do back-end (cópia fiel do SQL de src/modules/*). Banco de TESTE.
-- Uso: psql -f db/06_benchmark_queries.sql  (rodar depois de 05_carga_volume_teste.sql)
-- Cada bloco mostra só o "Execution Time" do EXPLAIN ANALYZE.
-- =====================================================================================
\pset pager off
SELECT id AS cat_id FROM categoria WHERE nome = 'Categoria carga 2' \gset
SELECT codigo_barras AS cod FROM item i WHERE tipo_controle='ETIQUETADO' AND EXISTS (SELECT 1 FROM vw_saldo_estoque s WHERE s.item_id=i.id AND s.local_id=1 AND s.saldo>0) LIMIT 1 \gset
SELECT id AS item_id FROM item WHERE codigo_barras = :'cod' \gset

CREATE OR REPLACE FUNCTION pg_temp.t(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; ms text;
BEGIN
  FOR r IN EXECUTE 'EXPLAIN (ANALYZE, FORMAT TEXT) ' || q LOOP
    IF r LIKE 'Execution Time%' THEN ms := r; END IF;
  END LOOP;
  RETURN ms;
END $$;

\echo '1. PDV catálogo — categorias vendáveis (pdv.routes.ts)'
SELECT pg_temp.t($q$SELECT c.id::text, c.nome FROM categoria c
  WHERE (c.ativa AND c.venda_por_categoria) OR EXISTS (
    SELECT 1 FROM item i JOIN vw_saldo_estoque s ON s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0
    WHERE i.categoria_id = c.id AND i.tipo_controle = 'CATEGORIA') ORDER BY c.nome$q$);

\echo '2. PDV catálogo — peças etiquetadas com saldo no bazar (pdv.routes.ts)'
SELECT pg_temp.t($q$SELECT i.id::text, i.codigo_barras FROM item i
  JOIN vw_saldo_estoque s ON s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0
  WHERE i.tipo_controle = 'ETIQUETADO' ORDER BY i.codigo_barras$q$);

\echo '3. PEPS — candidatos da categoria (vendas.service.ts, sem FOR UPDATE)'
SELECT pg_temp.t(format($q$SELECT i.id::text FROM item i JOIN lote_entrada l ON l.id = i.lote_id
  WHERE i.categoria_id = %L::uuid AND i.tipo_controle = 'CATEGORIA'
    AND EXISTS (SELECT 1 FROM vw_saldo_estoque s WHERE s.item_id = i.id AND s.local_id = 1 AND s.saldo > 0)
  ORDER BY l.recebido_em, l.numero, i.criado_em, i.id$q$, :'cat_id'));

\echo '4. Saldo de 1 item (vendas.service.ts / trigger)'
SELECT pg_temp.t(format($q$SELECT local_id, saldo FROM vw_saldo_estoque WHERE item_id = %L::uuid$q$, :'item_id'));

\echo '5. Item por código (estoque.routes.ts SELECT_ITEM)'
SELECT pg_temp.t(format($q$SELECT i.id, coalesce(s.b,0), coalesce(s.d,0) FROM item i
  JOIN categoria c ON c.id = i.categoria_id JOIN lote_entrada l ON l.id = i.lote_id
  LEFT JOIN parceiro p ON p.id = l.parceiro_id LEFT JOIN campanha cp ON cp.id = l.campanha_id
  LEFT JOIN (SELECT item_id, sum(saldo) FILTER (WHERE local_id = 1) AS b, sum(saldo) FILTER (WHERE local_id = 2) AS d
             FROM vw_saldo_estoque GROUP BY item_id) s ON s.item_id = i.id
  WHERE i.codigo_barras = %L$q$, :'cod'));

\echo '6. Listagem de estoque, página 1, com busca (estoque.routes.ts)'
SELECT pg_temp.t($q$SELECT x.*, count(*) OVER () AS total FROM (
  SELECT i.id, i.descricao, c.nome AS categoria_nome, coalesce(s.b,0) b, coalesce(s.d,0) d FROM item i
  JOIN categoria c ON c.id = i.categoria_id JOIN lote_entrada l ON l.id = i.lote_id
  LEFT JOIN parceiro p ON p.id = l.parceiro_id LEFT JOIN campanha cp ON cp.id = l.campanha_id
  LEFT JOIN (SELECT item_id, sum(saldo) FILTER (WHERE local_id = 1) AS b, sum(saldo) FILTER (WHERE local_id = 2) AS d
             FROM vw_saldo_estoque GROUP BY item_id) s ON s.item_id = i.id
  WHERE coalesce(s.b, 0) + coalesce(s.d, 0) > 0 AND (i.descricao ILIKE '%fictícia 12%' OR i.codigo_barras ILIKE '%fictícia 12%' OR c.nome ILIKE '%fictícia 12%')) x
  ORDER BY x.categoria_nome, x.descricao, x.id LIMIT 50 OFFSET 0$q$);

\echo '7. Relatório posição de estoque (relatorios.routes.ts)'
SELECT pg_temp.t($q$SELECT c.nome, s.local_id, sum(s.saldo), sum(s.saldo * i.valor_atribuido)
  FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id JOIN categoria c ON c.id = i.categoria_id
  WHERE s.saldo > 0 GROUP BY c.nome, s.local_id ORDER BY c.nome, s.local_id$q$);

\echo '8. Prestação de contas — movimentado no período (1 mês)'
SELECT pg_temp.t($q$SELECT m.parceiro_id::text, m.tipo_entrada::text,
  sum(CASE m.tipo WHEN 'VENDA' THEN m.quantidade WHEN 'ESTORNO_VENDA' THEN -m.quantidade ELSE 0 END), sum(m.receita)
  FROM vw_movimentacao_origem m WHERE m.ocorrido_em >= now() - interval '2 years' AND m.ocorrido_em < now() - interval '23 months' GROUP BY 1, 2$q$);

\echo '9. Prestação de contas — saldo atual por parceiro'
SELECT pg_temp.t($q$SELECT l.parceiro_id::text, l.tipo::text,
  coalesce(sum(s.saldo) FILTER (WHERE s.local_id = 1), 0), coalesce(sum(s.saldo) FILTER (WHERE s.local_id = 2), 0)
  FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id JOIN lote_entrada l ON l.id = i.lote_id GROUP BY 1, 2$q$);

\echo '10. Relatório de vendas (1 mês)'
SELECT pg_temp.t($q$SELECT v.numero, u.nome, (SELECT string_agg(DISTINCT p.forma::text, ', ') FROM venda_pagamento p WHERE p.venda_id = v.id),
  (SELECT coalesce(sum(vi.valor_imposto), 0) FROM venda_item vi WHERE vi.venda_id = v.id)
  FROM venda v JOIN usuario u ON u.id = v.registrada_por_id
  WHERE v.ocorrida_em >= now() - interval '2 years' AND v.ocorrida_em < now() - interval '23 months' ORDER BY v.ocorrida_em, v.numero$q$);

\echo '11. Prévia do fechamento de caixa — vendas por forma (caixa.service.ts)'
SELECT pg_temp.t($q$SELECT p.forma::text, sum(p.valor) FROM venda_pagamento p JOIN venda v ON v.id = p.venda_id
  WHERE v.sessao_id = '00000000-0000-4000-8000-00000000cafe' AND v.status = 'FINALIZADA' GROUP BY p.forma$q$);

\echo '12. Vendas do operador, página 1 (pdv.routes.ts)'
SELECT pg_temp.t($q$SELECT id FROM venda WHERE registrada_por_id = '00000000-0000-4000-8000-0000000c4a6a'
  ORDER BY ocorrida_em DESC, numero DESC LIMIT 20$q$);

\echo '13. Prestação de contas acumulada (vw_prestacao_contas_lote, 1 parceiro)'
SELECT pg_temp.t($q$SELECT * FROM vw_prestacao_contas_lote WHERE parceiro_id = (SELECT id FROM parceiro WHERE nome = 'Parceiro fictício 7')$q$);
