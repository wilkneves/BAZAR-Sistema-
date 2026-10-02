-- =====================================================================================
-- Carga de VOLUME para teste de desempenho (RNF-04) — SOMENTE banco de TESTE.
-- Dados 100% fictícios (nenhum dado real/PII). Simula ~5 anos de operação do bazar.
-- Passa por todos os triggers/invariantes (não desliga nada), então o resultado é consistente.
-- Uso: psql -v ON_ERROR_STOP=1 -v escala=1 -f db/05_carga_volume_teste.sql   (escala 1 ≈ 130 mil movimentações)
-- =====================================================================================
\if :{?escala}
\else
  \set escala 1
\endif

DO $$
BEGIN
  IF current_database() !~ '(teste|test|perf|base|dba)' THEN
    RAISE EXCEPTION 'Recusado: carga de volume só roda em banco de teste (nome do banco precisa conter teste/test/perf)';
  END IF;
END $$;

BEGIN;
SELECT set_config('carga.escala', :'escala', true);

-- operador fictício só da carga (senha_hash inválido: não consegue logar)
INSERT INTO usuario (id, nome, login, senha_hash, perfil_id, ativo, atualizado_em)
VALUES ('00000000-0000-4000-8000-0000000c4a6a', 'Operador carga', 'carga.volume', '!sem-login', '00000000-0000-4000-8000-0000000000a2', false, now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE _cfg ON COMMIT DROP AS
SELECT current_setting('carga.escala')::int AS e, '00000000-0000-4000-8000-0000000c4a6a'::uuid AS u;

-- terminal e caixa aberto (venda só em caixa aberto)
INSERT INTO terminal (id, nome) VALUES ('00000000-0000-4000-8000-00000000c0de', 'Caixa carga') ON CONFLICT DO NOTHING;
INSERT INTO caixa_sessao (id, terminal_id, aberto_por_id, valor_abertura, aberto_em)
SELECT '00000000-0000-4000-8000-00000000cafe', '00000000-0000-4000-8000-00000000c0de', u, 100, now() - interval '5 years' FROM _cfg;

-- 30 categorias (metade vendida por categoria)
INSERT INTO categoria (id, nome, preco_padrao, venda_por_categoria, atualizado_em)
SELECT gen_random_uuid(), 'Categoria carga ' || g, (5 + g)::numeric, g % 2 = 0, now() FROM generate_series(1, 30) g;

-- 50 parceiros fictícios
INSERT INTO parceiro (id, nome, tipo, atualizado_em)
SELECT gen_random_uuid(), 'Parceiro fictício ' || g, 'EMPRESA', now() FROM generate_series(1, 50) g;

-- lotes de doação ao longo de 5 anos
INSERT INTO lote_entrada (id, tipo, parceiro_id, recebido_em, recebido_por_id)
SELECT gen_random_uuid(), 'DOACAO', p.id, now() - interval '5 years' + (g * interval '10 minutes'), c.u
FROM _cfg c, generate_series(1, 3000 * c.e) g
JOIN LATERAL (SELECT id FROM parceiro WHERE nome LIKE 'Parceiro fictício%' ORDER BY id OFFSET (g % 50) LIMIT 1) p ON true;

CREATE TEMP TABLE _lotes ON COMMIT DROP AS SELECT id, row_number() OVER (ORDER BY numero) rn FROM lote_entrada WHERE tipo = 'DOACAO' AND status = 'AGUARDANDO_TRIAGEM' AND parceiro_id IN (SELECT id FROM parceiro WHERE nome LIKE 'Parceiro fictício%');
CREATE TEMP TABLE _cats ON COMMIT DROP AS SELECT id, venda_por_categoria vpc, row_number() OVER (ORDER BY nome) rn FROM categoria WHERE nome LIKE 'Categoria carga%';

-- peças etiquetadas (1 unidade) + ENTRADA no bazar
CREATE TEMP TABLE _etq ON COMMIT DROP AS
SELECT gen_random_uuid() id, l.id lote_id, ct.id cat_id, g n
FROM _cfg c, generate_series(1, 60000 * c.e) g
JOIN _lotes l ON l.rn = 1 + (g % (3000 * (SELECT e FROM _cfg)))
JOIN _cats ct ON ct.rn = 1 + (g % 30);
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, codigo_barras, descricao, valor_atribuido, preco_venda, quantidade_inicial, criado_por_id)
SELECT e.id, e.lote_id, e.cat_id, 'ETIQUETADO', 'TX' || lpad(e.n::text, 7, '0'), 'Peça fictícia ' || e.n, 5, 10 + (e.n % 40), 1, c.u FROM _etq e, _cfg c;
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id)
SELECT e.id, 'ENTRADA', 1, 1, c.u FROM _etq e, _cfg c;

-- itens por categoria (20 unidades) + ENTRADA
CREATE TEMP TABLE _cat_it ON COMMIT DROP AS
SELECT gen_random_uuid() id, l.id lote_id, ct.id cat_id, g n
FROM _cfg c, generate_series(1, 4000 * c.e) g
JOIN _lotes l ON l.rn = 1 + (g % (3000 * (SELECT e FROM _cfg)))
JOIN _cats ct ON ct.rn = 1 + (g % 30);
INSERT INTO item (id, lote_id, categoria_id, tipo_controle, valor_atribuido, quantidade_inicial, criado_por_id)
SELECT ci.id, ci.lote_id, ci.cat_id, 'CATEGORIA', 2, 20, c.u FROM _cat_it ci, _cfg c;
INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, usuario_id)
SELECT ci.id, 'ENTRADA', 1, 20, c.u FROM _cat_it ci, _cfg c;

UPDATE lote_entrada SET status = 'TRIADO' WHERE id IN (SELECT id FROM _lotes);

-- 5 mil transferências bazar → doações
INSERT INTO movimentacao (item_id, tipo, local_origem_id, local_destino_id, quantidade, usuario_id)
SELECT e.id, 'TRANSFERENCIA', 1, 2, 1, c.u FROM _etq e, _cfg c WHERE e.n % 12 = 0;

-- vendas de peças etiquetadas (1 peça por venda)
CREATE TEMP TABLE _v ON COMMIT DROP AS
SELECT gen_random_uuid() vid, gen_random_uuid() viid, e.id item_id, (10 + (e.n % 40))::numeric preco,
       now() - interval '5 years' + (e.n * interval '40 minutes') quando
FROM _etq e WHERE e.n % 12 <> 0 AND e.n % 3 <> 0;
INSERT INTO venda (id, terminal_id, sessao_id, subtotal, total, registrada_por_id, ocorrida_em)
SELECT vid, '00000000-0000-4000-8000-00000000c0de', '00000000-0000-4000-8000-00000000cafe', preco, preco, c.u, quando FROM _v, _cfg c;
INSERT INTO venda_item (id, venda_id, item_id, forma_selecao, quantidade, preco_unitario, valor_total, situacao_fiscal)
SELECT viid, vid, item_id, 'CODIGO', 1, preco, preco, 'ISENTO' FROM _v;
INSERT INTO movimentacao (item_id, tipo, local_origem_id, quantidade, venda_item_id, usuario_id)
SELECT item_id, 'VENDA', 1, 1, viid, c.u FROM _v, _cfg c;
INSERT INTO venda_pagamento (id, venda_id, forma, valor) SELECT gen_random_uuid(), vid, CASE WHEN random() < .5 THEN 'DINHEIRO' ELSE 'PIX' END::"FormaPagamento", preco FROM _v;

-- vendas por categoria (2 unidades de cada item por categoria, 5 vezes)
CREATE TEMP TABLE _vc ON COMMIT DROP AS
SELECT gen_random_uuid() vid, gen_random_uuid() viid, ci.id item_id, 12::numeric preco,
       now() - interval '5 years' + ((ci.n * 5 + k) * interval '13 minutes') quando
FROM _cat_it ci, generate_series(1, 5) k;
INSERT INTO venda (id, terminal_id, sessao_id, subtotal, total, registrada_por_id, ocorrida_em)
SELECT vid, '00000000-0000-4000-8000-00000000c0de', '00000000-0000-4000-8000-00000000cafe', preco * 2, preco * 2, c.u, quando FROM _vc, _cfg c;
INSERT INTO venda_item (id, venda_id, item_id, forma_selecao, quantidade, preco_unitario, valor_total, situacao_fiscal)
SELECT viid, vid, item_id, 'CATEGORIA', 2, preco, preco * 2, 'ISENTO' FROM _vc;
INSERT INTO movimentacao (item_id, tipo, local_origem_id, quantidade, venda_item_id, usuario_id)
SELECT item_id, 'VENDA', 1, 2, viid, c.u FROM _vc, _cfg c;
INSERT INTO venda_pagamento (id, venda_id, forma, valor) SELECT gen_random_uuid(), vid, 'DINHEIRO', preco * 2 FROM _vc;

COMMIT;
ANALYZE item; ANALYZE movimentacao; ANALYZE venda; ANALYZE venda_item; ANALYZE lote_entrada;
DO $$ BEGIN IF to_regclass($q$saldo_estoque$q$) IS NOT NULL THEN EXECUTE $q$ANALYZE saldo_estoque$q$; END IF; END $$;
SELECT (SELECT count(*) FROM item) itens, (SELECT count(*) FROM movimentacao) movimentacoes, (SELECT count(*) FROM venda) vendas;
