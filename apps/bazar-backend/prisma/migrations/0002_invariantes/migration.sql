-- =====================================================================================
-- Sistema de Bazar — Luz da Esperança
-- Invariantes no banco (doc 04, seção 6 — D-07, RNF-20), views (seção 7) e dados iniciais.
-- Regras valem mesmo com bug na API ou script manual.
-- Mensagens de erro: 'CODIGO|texto' — a API devolve o CODIGO como `code` do ProblemDetails (409).
-- =====================================================================================

-- ------------------------------------------------------------------ dados fixos
INSERT INTO local_estoque (id, codigo, nome, permite_venda) VALUES
  (1, 'BAZAR', 'Estoque do bazar', true),
  (2, 'DOACOES', 'Estoque de doações', false)
ON CONFLICT (id) DO NOTHING;

-- Código de barras das peças etiquetadas (BZ + 6 dígitos, Code 39)
CREATE SEQUENCE IF NOT EXISTS seq_codigo_barras START 1;

-- ------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION fn_falha(p_codigo text, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%|%', p_codigo, p_msg USING ERRCODE = 'P0001';
END $$;

-- ------------------------------------------------------------------ CHECKs
ALTER TABLE lote_entrada ADD CONSTRAINT ck_lote_origem CHECK (
  tipo = 'SALDO_INICIAL'
  OR (tipo = 'DOACAO' AND (parceiro_id IS NOT NULL OR campanha_id IS NOT NULL))
  OR (tipo = 'COMPRA' AND parceiro_id IS NOT NULL AND valor_compra IS NOT NULL AND valor_compra > 0)
);

ALTER TABLE item ADD CONSTRAINT ck_item_quantidade CHECK (quantidade_inicial > 0);
ALTER TABLE item ADD CONSTRAINT ck_item_valores CHECK (valor_atribuido >= 0 AND (preco_venda IS NULL OR preco_venda > 0));
ALTER TABLE item ADD CONSTRAINT ck_item_etiquetado CHECK (
  (tipo_controle = 'ETIQUETADO' AND quantidade_inicial = 1 AND codigo_barras IS NOT NULL AND preco_venda IS NOT NULL)
  OR (tipo_controle = 'CATEGORIA' AND codigo_barras IS NULL AND preco_venda IS NULL)
);

ALTER TABLE movimentacao ADD CONSTRAINT ck_mov_quantidade CHECK (quantidade > 0);
ALTER TABLE movimentacao ADD CONSTRAINT ck_mov_forma CHECK (
  CASE tipo
    WHEN 'ENTRADA'        THEN local_origem_id IS NULL AND local_destino_id IS NOT NULL AND venda_item_id IS NULL AND motivo_baixa_id IS NULL
    WHEN 'TRANSFERENCIA'  THEN local_origem_id IS NOT NULL AND local_destino_id IS NOT NULL AND local_origem_id <> local_destino_id AND venda_item_id IS NULL AND motivo_baixa_id IS NULL
    WHEN 'VENDA'          THEN local_origem_id IS NOT NULL AND local_destino_id IS NULL AND venda_item_id IS NOT NULL AND motivo_baixa_id IS NULL
    WHEN 'ESTORNO_VENDA'  THEN local_origem_id IS NULL AND local_destino_id IS NOT NULL AND venda_item_id IS NOT NULL AND motivo_baixa_id IS NULL
    WHEN 'BAIXA'          THEN local_origem_id IS NOT NULL AND local_destino_id IS NULL AND venda_item_id IS NULL AND motivo_baixa_id IS NOT NULL
    WHEN 'AJUSTE_ENTRADA' THEN local_origem_id IS NULL AND local_destino_id IS NOT NULL AND venda_item_id IS NULL AND motivo IS NOT NULL AND length(trim(motivo)) > 0
    WHEN 'AJUSTE_SAIDA'   THEN local_origem_id IS NOT NULL AND local_destino_id IS NULL AND venda_item_id IS NULL AND motivo IS NOT NULL AND length(trim(motivo)) > 0
  END
);

ALTER TABLE venda ADD CONSTRAINT ck_venda_totais CHECK (subtotal >= 0 AND desconto >= 0 AND desconto <= subtotal AND total = subtotal - desconto);
ALTER TABLE venda ADD CONSTRAINT ck_venda_cancelamento CHECK (
  (status = 'FINALIZADA' AND cancelada_em IS NULL AND cancelada_por_id IS NULL)
  OR (status = 'CANCELADA' AND cancelada_em IS NOT NULL AND cancelada_por_id IS NOT NULL AND length(trim(coalesce(motivo_cancelamento, ''))) > 0)
);
ALTER TABLE venda_item ADD CONSTRAINT ck_venda_item_valores CHECK (
  quantidade > 0 AND preco_unitario >= 0 AND desconto >= 0 AND valor_total = quantidade * preco_unitario - desconto AND valor_total >= 0
  AND aliquota >= 0 AND aliquota <= 100 AND valor_imposto >= 0
);
ALTER TABLE venda_pagamento ADD CONSTRAINT ck_pagamento_valor CHECK (valor > 0);
ALTER TABLE venda_pagamento ADD CONSTRAINT ck_pagamento_troco CHECK (troco >= 0 AND (troco = 0 OR forma = 'DINHEIRO'));
ALTER TABLE venda_pagamento ADD CONSTRAINT ck_pagamento_dinheiro CHECK (
  valor_recebido IS NULL OR (forma = 'DINHEIRO' AND valor_recebido = valor + troco)
);

ALTER TABLE caixa_sessao ADD CONSTRAINT ck_caixa_abertura CHECK (valor_abertura >= 0);
ALTER TABLE caixa_sessao ADD CONSTRAINT ck_caixa_fechamento CHECK (
  (status = 'ABERTO' AND fechado_em IS NULL)
  OR (status = 'FECHADO' AND fechado_em IS NOT NULL AND fechado_por_id IS NOT NULL
      AND valor_esperado IS NOT NULL AND valor_contado IS NOT NULL AND valor_contado >= 0
      AND diferenca = valor_contado - valor_esperado
      AND (diferenca = 0 OR length(trim(coalesce(observacao, ''))) > 0))
);
ALTER TABLE caixa_lancamento ADD CONSTRAINT ck_lancamento_valor CHECK (valor > 0 AND length(trim(motivo)) > 0);

ALTER TABLE conta_receber ADD CONSTRAINT ck_cr_valor CHECK (valor > 0);
ALTER TABLE recebimento ADD CONSTRAINT ck_receb_valor CHECK (valor > 0 AND forma <> 'FIADO');
ALTER TABLE recebimento ADD CONSTRAINT ck_receb_estorno CHECK (
  (estornado_em IS NULL AND estornado_por_id IS NULL AND motivo_estorno IS NULL)
  OR (estornado_em IS NOT NULL AND estornado_por_id IS NOT NULL AND length(trim(coalesce(motivo_estorno, ''))) > 0)
);

ALTER TABLE conta_pagar ADD CONSTRAINT ck_cp_valor CHECK (valor > 0);
ALTER TABLE conta_pagar ADD CONSTRAINT ck_cp_caixa CHECK (caixa_lancamento_id IS NULL OR forma_pagamento = 'DINHEIRO');
ALTER TABLE conta_pagar ADD CONSTRAINT ck_cp_pagamento CHECK (
  status <> 'PAGA' OR (pago_em IS NOT NULL AND valor_pago IS NOT NULL AND forma_pagamento IS NOT NULL)
);
ALTER TABLE conta_pagar ADD CONSTRAINT ck_cp_cancelamento CHECK (
  status <> 'CANCELADA' OR length(trim(coalesce(observacao, ''))) > 0
);

ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_escopo CHECK (
  (escopo = 'GERAL' AND categoria_id IS NULL AND item_id IS NULL)
  OR (escopo = 'CATEGORIA' AND categoria_id IS NOT NULL AND item_id IS NULL)
  OR (escopo = 'ITEM' AND item_id IS NOT NULL AND categoria_id IS NULL)
);
ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_aliquota CHECK (
  aliquota >= 0 AND aliquota <= 100 AND (situacao = 'TRIBUTADO' OR aliquota = 0)
);
ALTER TABLE regra_fiscal ADD CONSTRAINT ck_regra_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio);

ALTER TABLE perfil ADD CONSTRAINT ck_perfil_desconto CHECK (limite_desconto_pct IS NULL OR (limite_desconto_pct >= 0 AND limite_desconto_pct <= 100));

-- ------------------------------------------------------------------ índices únicos parciais
CREATE UNIQUE INDEX ux_parceiro_nao_identificado ON parceiro (nao_identificado) WHERE nao_identificado;
CREATE UNIQUE INDEX ux_mov_entrada_unica ON movimentacao (item_id) WHERE tipo = 'ENTRADA';
CREATE UNIQUE INDEX ux_mov_venda_unica ON movimentacao (venda_item_id) WHERE tipo = 'VENDA';
CREATE UNIQUE INDEX ux_mov_estorno_unico ON movimentacao (venda_item_id) WHERE tipo = 'ESTORNO_VENDA';
CREATE UNIQUE INDEX ux_caixa_aberto_por_terminal ON caixa_sessao (terminal_id) WHERE status = 'ABERTO';
CREATE UNIQUE INDEX ux_caixa_aberto_por_operador ON caixa_sessao (aberto_por_id) WHERE status = 'ABERTO';
CREATE UNIQUE INDEX ux_regra_vigente ON regra_fiscal (escopo, coalesce(categoria_id, item_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE vigencia_fim IS NULL;
CREATE UNIQUE INDEX ux_categoria_nome ON categoria (lower(nome));
CREATE UNIQUE INDEX ux_campanha_nome ON campanha (lower(nome));
CREATE INDEX ix_venda_pagamento_forma ON venda_pagamento (forma);
CREATE INDEX ix_auditoria_entidade ON auditoria (entidade, entidade_id);

-- ------------------------------------------------------------------ nada se apaga (RN-11, RN-24, D-09)
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_falha('REGISTRO_IMUTAVEL', format('RN-11: %s aceita apenas inclusão', TG_TABLE_NAME));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION fn_bloqueia_exclusao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_falha('EXCLUSAO_PROIBIDA', format('RN-24: registros de %s não são excluídos (desative ou cancele)', TG_TABLE_NAME));
  RETURN NULL;
END $$;

CREATE TRIGGER tg_mov_imutavel BEFORE UPDATE OR DELETE ON movimentacao FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();
CREATE TRIGGER tg_venda_item_imutavel BEFORE UPDATE OR DELETE ON venda_item FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();
CREATE TRIGGER tg_venda_pagamento_imutavel BEFORE UPDATE OR DELETE ON venda_pagamento FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();
CREATE TRIGGER tg_auditoria_imutavel BEFORE UPDATE OR DELETE ON auditoria FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();
CREATE TRIGGER tg_caixa_lancamento_imutavel BEFORE UPDATE OR DELETE ON caixa_lancamento FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['instituicao','terminal','perfil','permissao','usuario','categoria','motivo_descarte','motivo_baixa',
    'parceiro','campanha','cliente','consentimento','lote_entrada','item','descarte','local_estoque','caixa_sessao','venda',
    'pendencia_sincronizacao','conta_receber','recebimento','categoria_despesa','conta_pagar','regra_fiscal'] LOOP
    EXECUTE format('CREATE TRIGGER tg_%s_sem_exclusao BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_exclusao()', t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------ views (seção 7)
-- 7.1 Saldo: única forma de ler saldo (D-04)
CREATE OR REPLACE VIEW vw_saldo_estoque AS
SELECT x.item_id, x.local_id, SUM(x.q)::int AS saldo
FROM (
  SELECT item_id, local_destino_id AS local_id, quantidade AS q FROM movimentacao WHERE local_destino_id IS NOT NULL
  UNION ALL
  SELECT item_id, local_origem_id AS local_id, -quantidade AS q FROM movimentacao WHERE local_origem_id IS NOT NULL
) x
GROUP BY x.item_id, x.local_id;

-- 7.4 Receita por item de venda, com rateio do desconto do total (D-17)
CREATE OR REPLACE VIEW vw_venda_item_receita AS
SELECT vi.id AS venda_item_id, vi.venda_id, vi.item_id, vi.quantidade, v.status AS venda_status,
       CASE WHEN v.subtotal = 0 THEN 0::numeric(10,2)
            ELSE round(vi.valor_total * v.total / v.subtotal, 2) END AS receita
FROM venda_item vi JOIN venda v ON v.id = vi.venda_id;

-- 7.3 Cada movimentação com a origem do item e a receita (venda +, estorno −)
CREATE OR REPLACE VIEW vw_movimentacao_origem AS
SELECT m.id, m.item_id, m.tipo, m.quantidade, m.local_origem_id, m.local_destino_id, m.ocorrido_em, m.usuario_id,
       l.id AS lote_id, l.numero AS lote_numero, l.tipo AS tipo_entrada, l.parceiro_id, l.campanha_id,
       i.categoria_id,
       CASE m.tipo WHEN 'VENDA' THEN r.receita WHEN 'ESTORNO_VENDA' THEN -r.receita ELSE 0 END AS receita
FROM movimentacao m
JOIN item i ON i.id = m.item_id
JOIN lote_entrada l ON l.id = i.lote_id
LEFT JOIN vw_venda_item_receita r ON r.venda_item_id = m.venda_item_id;

-- 7.2 Prestação de contas acumulada por lote
CREATE OR REPLACE VIEW vw_prestacao_contas_lote AS
SELECT l.id AS lote_id, l.numero, l.tipo AS tipo_entrada, l.parceiro_id, l.campanha_id, l.recebido_em,
  coalesce((SELECT sum(i.quantidade_inicial) FROM item i WHERE i.lote_id = l.id), 0)::int AS itens_aprovados,
  (SELECT count(*) FROM descarte d WHERE d.lote_id = l.id AND d.revertido_em IS NULL)::int AS itens_descartados,
  coalesce((SELECT sum(i.quantidade_inicial * i.valor_atribuido) FROM item i WHERE i.lote_id = l.id), 0)::numeric(12,2) AS valor_atribuido,
  coalesce((SELECT sum(CASE m.tipo WHEN 'VENDA' THEN m.quantidade WHEN 'ESTORNO_VENDA' THEN -m.quantidade ELSE 0 END)
            FROM vw_movimentacao_origem m WHERE m.lote_id = l.id), 0)::int AS itens_vendidos,
  coalesce((SELECT sum(m.receita) FROM vw_movimentacao_origem m WHERE m.lote_id = l.id), 0)::numeric(12,2) AS receita,
  coalesce((SELECT sum(s.saldo) FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id WHERE i.lote_id = l.id AND s.local_id = 1), 0)::int AS em_estoque_bazar,
  coalesce((SELECT sum(s.saldo) FROM vw_saldo_estoque s JOIN item i ON i.id = s.item_id WHERE i.lote_id = l.id AND s.local_id = 2), 0)::int AS em_estoque_doacoes,
  coalesce((SELECT sum(m.quantidade) FROM vw_movimentacao_origem m WHERE m.lote_id = l.id AND m.tipo = 'BAIXA'), 0)::int AS itens_baixados,
  coalesce((SELECT sum(CASE m.tipo WHEN 'AJUSTE_ENTRADA' THEN m.quantidade ELSE -m.quantidade END)
            FROM vw_movimentacao_origem m WHERE m.lote_id = l.id AND m.tipo IN ('AJUSTE_ENTRADA','AJUSTE_SAIDA')), 0)::int AS ajustes_liquidos,
  coalesce((SELECT sum(m.quantidade) FROM vw_movimentacao_origem m WHERE m.lote_id = l.id AND m.tipo = 'TRANSFERENCIA' AND m.local_destino_id = 2), 0)::int AS transferidos_para_doacoes
FROM lote_entrada l;

-- ------------------------------------------------------------------ estoque (RN-06, RN-07, RN-10, RN-31)
CREATE OR REPLACE FUNCTION fn_saldo(p_item uuid, p_local int) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT saldo FROM vw_saldo_estoque WHERE item_id = p_item AND local_id = p_local), 0);
$$;

CREATE OR REPLACE FUNCTION fn_valida_movimentacao() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_item item%ROWTYPE;
  v_saldo int;
  v_total int;
  v_vi venda_item%ROWTYPE;
  v_ocorrida timestamptz;
  v_permite boolean;
BEGIN
  -- trava o item: duas baixas simultâneas do mesmo item esperam uma pela outra
  SELECT * INTO v_item FROM item WHERE id = NEW.item_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM fn_falha('ITEM_INEXISTENTE', 'Item não encontrado'); END IF;

  IF NEW.local_origem_id IS NOT NULL THEN
    v_saldo := fn_saldo(NEW.item_id, NEW.local_origem_id);
    IF v_saldo < NEW.quantidade THEN
      PERFORM fn_falha('SALDO_INSUFICIENTE', format('RN-10: saldo insuficiente (%s disponível, %s pedido)', v_saldo, NEW.quantidade));
    END IF;
  END IF;

  IF NEW.tipo IN ('VENDA', 'ESTORNO_VENDA') THEN
    SELECT * INTO v_vi FROM venda_item WHERE id = NEW.venda_item_id;
    IF NOT FOUND OR v_vi.item_id <> NEW.item_id THEN
      PERFORM fn_falha('MOVIMENTACAO_INVALIDA', 'Movimentação de venda não corresponde ao item vendido');
    END IF;
    IF NEW.tipo = 'VENDA' THEN
      SELECT permite_venda INTO v_permite FROM local_estoque WHERE id = NEW.local_origem_id;
      IF NOT v_permite THEN PERFORM fn_falha('LOCAL_NAO_VENDE', 'RN-07: só é possível vender do estoque do bazar'); END IF;
      IF NEW.quantidade <> v_vi.quantidade THEN PERFORM fn_falha('MOVIMENTACAO_INVALIDA', 'Quantidade da baixa difere do item de venda'); END IF;
      -- RN-31: a baixa usa a hora da venda no terminal
      SELECT ocorrida_em INTO v_ocorrida FROM venda WHERE id = v_vi.venda_id;
      NEW.ocorrido_em := v_ocorrida;
    END IF;
  END IF;

  -- RN-08: peça etiquetada nunca tem mais de 1 unidade em estoque
  IF v_item.tipo_controle = 'ETIQUETADO' AND NEW.local_origem_id IS NULL THEN
    SELECT coalesce(sum(saldo), 0) INTO v_total FROM vw_saldo_estoque WHERE item_id = NEW.item_id;
    IF v_total + NEW.quantidade > 1 THEN
      PERFORM fn_falha('ETIQUETADO_QTD', 'RN-08: peça etiquetada tem no máximo 1 unidade em estoque');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_movimentacao BEFORE INSERT ON movimentacao FOR EACH ROW EXECUTE FUNCTION fn_valida_movimentacao();

-- Item nasce com ENTRADA da quantidade inicial (conferido no COMMIT)
CREATE OR REPLACE FUNCTION fn_item_exige_entrada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM movimentacao WHERE item_id = NEW.id AND tipo = 'ENTRADA' AND quantidade = NEW.quantidade_inicial) THEN
    PERFORM fn_falha('ITEM_SEM_ENTRADA', 'Item aprovado precisa da movimentação de ENTRADA com a quantidade inicial');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tg_item_exige_entrada AFTER INSERT ON item DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_item_exige_entrada();

-- ------------------------------------------------------------------ lote e triagem (RN-04, RN-20, RN-28)
CREATE OR REPLACE FUNCTION fn_lote_aberto_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status "StatusLote"; v_desc descarte%ROWTYPE;
BEGIN
  SELECT status INTO v_status FROM lote_entrada WHERE id = NEW.lote_id FOR UPDATE;
  -- (IF aninhado: plpgsql não garante curto-circuito e `descarte` não tem descarte_origem_id)
  IF TG_TABLE_NAME = 'item' THEN
    IF NEW.descarte_origem_id IS NOT NULL THEN
      SELECT * INTO v_desc FROM descarte WHERE id = NEW.descarte_origem_id;
      IF NOT FOUND OR v_desc.revertido_em IS NULL OR v_desc.lote_id <> NEW.lote_id THEN
        PERFORM fn_falha('REVERSAO_INVALIDA', 'RN-20: item de reversão exige descarte revertido do mesmo lote');
      END IF;
      RETURN NEW; -- reversão de descarte é aceita mesmo em lote triado
    END IF;
  END IF;
  IF v_status = 'TRIADO' THEN
    PERFORM fn_falha('LOTE_TRIADO', 'RN-28: lote triado não aceita itens nem descartes');
  END IF;
  IF v_status = 'AGUARDANDO_TRIAGEM' THEN
    UPDATE lote_entrada SET status = 'EM_TRIAGEM' WHERE id = NEW.lote_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_lote_aberto_item BEFORE INSERT ON item FOR EACH ROW EXECUTE FUNCTION fn_lote_aberto_item();
CREATE TRIGGER tg_lote_aberto_descarte BEFORE INSERT ON descarte FOR EACH ROW EXECUTE FUNCTION fn_lote_aberto_item();

-- D-16: item não muda de lote, quantidade nem valor atribuído (só preço e descrição)
CREATE OR REPLACE FUNCTION fn_item_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lote_id <> OLD.lote_id OR NEW.categoria_id <> OLD.categoria_id OR NEW.tipo_controle <> OLD.tipo_controle
     OR NEW.codigo_barras IS DISTINCT FROM OLD.codigo_barras OR NEW.valor_atribuido <> OLD.valor_atribuido
     OR NEW.quantidade_inicial <> OLD.quantidade_inicial OR NEW.descarte_origem_id IS DISTINCT FROM OLD.descarte_origem_id
     OR NEW.criado_por_id <> OLD.criado_por_id OR NEW.criado_em <> OLD.criado_em THEN
    PERFORM fn_falha('ORIGEM_IMUTAVEL', 'D-16: depois da triagem, só preço e descrição do item mudam');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_item_imutavel BEFORE UPDATE ON item FOR EACH ROW EXECUTE FUNCTION fn_item_imutavel();

CREATE OR REPLACE FUNCTION fn_lote_origem_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tipo <> OLD.tipo OR NEW.parceiro_id IS DISTINCT FROM OLD.parceiro_id OR NEW.campanha_id IS DISTINCT FROM OLD.campanha_id
      OR NEW.valor_compra IS DISTINCT FROM OLD.valor_compra OR NEW.numero <> OLD.numero)
     AND (EXISTS (SELECT 1 FROM item WHERE lote_id = OLD.id) OR EXISTS (SELECT 1 FROM descarte WHERE lote_id = OLD.id)) THEN
    PERFORM fn_falha('ORIGEM_IMUTAVEL', 'D-16: lote com itens ou descartes não muda de origem');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_lote_origem_imutavel BEFORE UPDATE ON lote_entrada FOR EACH ROW EXECUTE FUNCTION fn_lote_origem_imutavel();

CREATE OR REPLACE FUNCTION fn_descarte_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revertido_em IS NOT NULL THEN PERFORM fn_falha('DESCARTE_REVERTIDO', 'Descarte já revertido'); END IF;
  IF NEW.lote_id <> OLD.lote_id OR NEW.categoria_id <> OLD.categoria_id OR NEW.motivo_id <> OLD.motivo_id
     OR NEW.registrado_em <> OLD.registrado_em OR NEW.registrado_por_id <> OLD.registrado_por_id
     OR NEW.revertido_em IS NULL OR NEW.revertido_por_id IS NULL THEN
    PERFORM fn_falha('REGISTRO_IMUTAVEL', 'RN-20: descarte só pode ser revertido, uma vez');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_descarte_imutavel BEFORE UPDATE ON descarte FOR EACH ROW EXECUTE FUNCTION fn_descarte_imutavel();

-- RN-05: lote de compra tem conta a pagar ligada, com o mesmo valor (conferido no COMMIT)
CREATE OR REPLACE FUNCTION fn_compra_exige_conta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'COMPRA' AND NOT EXISTS (SELECT 1 FROM conta_pagar WHERE lote_id = NEW.id AND valor = NEW.valor_compra) THEN
    PERFORM fn_falha('COMPRA_SEM_CONTA', 'RN-05: lote de compra precisa da conta a pagar ligada, com o mesmo valor');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tg_compra_exige_conta AFTER INSERT ON lote_entrada DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_compra_exige_conta();

-- ------------------------------------------------------------------ venda (RN-03, RN-12, RN-14, RN-15, RN-30, D-15)
CREATE OR REPLACE FUNCTION fn_valida_venda_caixa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_caixa caixa_sessao%ROWTYPE;
BEGIN
  SELECT * INTO v_caixa FROM caixa_sessao WHERE id = NEW.sessao_id FOR SHARE;
  IF NOT FOUND OR v_caixa.status <> 'ABERTO' THEN PERFORM fn_falha('CAIXA_FECHADO', 'RN-12: só é possível vender com caixa aberto'); END IF;
  IF v_caixa.terminal_id <> NEW.terminal_id THEN PERFORM fn_falha('CAIXA_OUTRO_TERMINAL', 'A venda deve ser do mesmo terminal do caixa'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_venda_caixa BEFORE INSERT ON venda FOR EACH ROW EXECUTE FUNCTION fn_valida_venda_caixa();

CREATE OR REPLACE FUNCTION fn_valida_venda_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo "TipoControle";
BEGIN
  SELECT tipo_controle INTO v_tipo FROM item WHERE id = NEW.item_id;
  IF (NEW.forma_selecao = 'CODIGO' AND v_tipo <> 'ETIQUETADO') OR (NEW.forma_selecao = 'CATEGORIA' AND v_tipo <> 'CATEGORIA') THEN
    PERFORM fn_falha('FORMA_SELECAO_INVALIDA', 'RN-30: peça etiquetada só pelo código; venda por categoria só baixa itens por categoria');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_venda_item BEFORE INSERT ON venda_item FOR EACH ROW EXECUTE FUNCTION fn_valida_venda_item();

-- Venda inteira conferida no COMMIT
CREATE OR REPLACE FUNCTION fn_valida_venda_completa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v venda%ROWTYPE;
  v_soma_itens numeric; v_soma_pag numeric; v_fiado numeric; v_qtd int; v_sem_baixa int;
BEGIN
  SELECT * INTO v FROM venda WHERE id = NEW.id;
  SELECT coalesce(sum(valor_total), 0), count(*) INTO v_soma_itens, v_qtd FROM venda_item WHERE venda_id = v.id;
  IF v_qtd = 0 THEN PERFORM fn_falha('VENDA_VAZIA', 'Venda sem itens'); END IF;
  IF v_soma_itens <> v.subtotal THEN PERFORM fn_falha('VENDA_INCONSISTENTE', 'Subtotal difere da soma dos itens'); END IF;
  SELECT coalesce(sum(valor), 0), coalesce(sum(valor) FILTER (WHERE forma = 'FIADO'), 0) INTO v_soma_pag, v_fiado
    FROM venda_pagamento WHERE venda_id = v.id;
  IF v_soma_pag <> v.total THEN PERFORM fn_falha('PAGAMENTO_DIVERGENTE', 'RN-15: pagamentos diferentes do total'); END IF;
  SELECT count(*) INTO v_sem_baixa FROM venda_item vi
   WHERE vi.venda_id = v.id AND NOT EXISTS (SELECT 1 FROM movimentacao m WHERE m.venda_item_id = vi.id AND m.tipo = 'VENDA' AND m.quantidade = vi.quantidade);
  IF v_sem_baixa > 0 THEN PERFORM fn_falha('VENDA_SEM_BAIXA', 'RN-06: item vendido sem baixa de estoque'); END IF;
  IF v_fiado > 0 THEN
    IF v.cliente_id IS NULL THEN PERFORM fn_falha('FIADO_SEM_CLIENTE', 'RN-03: venda fiada exige cliente'); END IF;
    IF NOT EXISTS (SELECT 1 FROM conta_receber WHERE venda_id = v.id AND cliente_id = v.cliente_id AND valor = v_fiado) THEN
      PERFORM fn_falha('FIADO_SEM_CONTA', 'RN-03: venda fiada exige conta a receber do mesmo cliente, no valor do fiado');
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tg_valida_venda_completa AFTER INSERT ON venda DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_valida_venda_completa();

-- RN-14: venda finalizada só muda para cancelada; cancelada não volta
CREATE OR REPLACE FUNCTION fn_valida_alteracao_venda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CANCELADA' THEN PERFORM fn_falha('VENDA_CANCELADA', 'Venda já cancelada'); END IF;
  IF NEW.id <> OLD.id OR NEW.numero <> OLD.numero OR NEW.terminal_id <> OLD.terminal_id OR NEW.sessao_id <> OLD.sessao_id
     OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.subtotal <> OLD.subtotal OR NEW.desconto <> OLD.desconto
     OR NEW.total <> OLD.total OR NEW.ocorrida_em <> OLD.ocorrida_em OR NEW.registrada_por_id <> OLD.registrada_por_id
     OR NEW.origem_registro <> OLD.origem_registro OR NEW.status <> 'CANCELADA' THEN
    PERFORM fn_falha('VENDA_IMUTAVEL', 'RN-14: venda finalizada só pode ser cancelada');
  END IF;
  -- trava a conta antes de conferir recebimentos (sem corrida com recebimento simultâneo)
  PERFORM 1 FROM conta_receber WHERE venda_id = OLD.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM recebimento r JOIN conta_receber c ON c.id = r.conta_receber_id
             WHERE c.venda_id = OLD.id AND r.estornado_em IS NULL) THEN
    PERFORM fn_falha('FIADO_COM_RECEBIMENTO', 'RN-14: estorne os recebimentos do fiado antes de cancelar a venda');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_alteracao_venda BEFORE UPDATE ON venda FOR EACH ROW EXECUTE FUNCTION fn_valida_alteracao_venda();

-- RN-14: estorno automático do estoque e cancelamento da conta a receber
CREATE OR REPLACE FUNCTION fn_estorna_venda_cancelada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO movimentacao (item_id, tipo, local_destino_id, quantidade, venda_item_id, usuario_id, ocorrido_em, motivo)
  SELECT m.item_id, 'ESTORNO_VENDA', m.local_origem_id, m.quantidade, m.venda_item_id, NEW.cancelada_por_id, NEW.cancelada_em,
         'Estorno da venda ' || NEW.numero
  FROM movimentacao m JOIN venda_item vi ON vi.id = m.venda_item_id
  WHERE vi.venda_id = NEW.id AND m.tipo = 'VENDA'
  ORDER BY m.item_id;
  UPDATE conta_receber SET status = 'CANCELADA' WHERE venda_id = NEW.id AND status <> 'CANCELADA';
  RETURN NULL;
END $$;
CREATE TRIGGER tg_estorna_venda_cancelada AFTER UPDATE OF status ON venda FOR EACH ROW
  WHEN (OLD.status = 'FINALIZADA' AND NEW.status = 'CANCELADA') EXECUTE FUNCTION fn_estorna_venda_cancelada();

-- ------------------------------------------------------------------ caixa (RN-12, RN-13, RF-CXA-03)
CREATE OR REPLACE FUNCTION fn_valida_alteracao_caixa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'FECHADO' THEN PERFORM fn_falha('CAIXA_FECHADO', 'Caixa fechado não muda nem reabre'); END IF;
  IF NEW.terminal_id <> OLD.terminal_id OR NEW.aberto_por_id <> OLD.aberto_por_id OR NEW.aberto_em <> OLD.aberto_em
     OR NEW.valor_abertura <> OLD.valor_abertura THEN
    PERFORM fn_falha('REGISTRO_IMUTAVEL', 'Dados de abertura do caixa não mudam');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_alteracao_caixa BEFORE UPDATE ON caixa_sessao FOR EACH ROW EXECUTE FUNCTION fn_valida_alteracao_caixa();

CREATE OR REPLACE FUNCTION fn_lancamento_caixa_aberto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM caixa_sessao WHERE id = NEW.sessao_id AND status = 'ABERTO') THEN
    PERFORM fn_falha('CAIXA_FECHADO', 'Sangria e suprimento só em caixa aberto');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_lancamento_caixa_aberto BEFORE INSERT ON caixa_lancamento FOR EACH ROW EXECUTE FUNCTION fn_lancamento_caixa_aberto();

-- ------------------------------------------------------------------ fiado (RN-25, RN-27)
CREATE OR REPLACE FUNCTION fn_recalcula_conta_receber(p_conta uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_valor numeric; v_pago numeric; v_status "StatusContaReceber";
BEGIN
  SELECT valor, status INTO v_valor, v_status FROM conta_receber WHERE id = p_conta;
  IF v_status = 'CANCELADA' THEN RETURN; END IF;
  SELECT coalesce(sum(valor), 0) INTO v_pago FROM recebimento WHERE conta_receber_id = p_conta AND estornado_em IS NULL;
  PERFORM set_config('bazar.recalculo', 'on', true);
  UPDATE conta_receber SET status = CASE WHEN v_pago >= v_valor THEN 'QUITADA' WHEN v_pago > 0 THEN 'PARCIAL' ELSE 'ABERTA' END::"StatusContaReceber"
   WHERE id = p_conta;
  PERFORM set_config('bazar.recalculo', 'off', true);
END $$;

CREATE OR REPLACE FUNCTION fn_valida_recebimento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_conta conta_receber%ROWTYPE; v_pago numeric;
BEGIN
  SELECT * INTO v_conta FROM conta_receber WHERE id = NEW.conta_receber_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF v_conta.status IN ('CANCELADA', 'QUITADA') THEN PERFORM fn_falha('CONTA_NAO_ABERTA', 'Conta não aceita recebimento'); END IF;
    IF NEW.sessao_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM caixa_sessao WHERE id = NEW.sessao_id AND status = 'ABERTO') THEN
      PERFORM fn_falha('CAIXA_FECHADO', 'Recebimento no caixa exige caixa aberto');
    END IF;
    SELECT coalesce(sum(valor), 0) INTO v_pago FROM recebimento WHERE conta_receber_id = NEW.conta_receber_id AND estornado_em IS NULL;
    IF v_pago + NEW.valor > v_conta.valor THEN
      PERFORM fn_falha('RECEBIMENTO_ACIMA_SALDO', 'RN-27: recebimentos ativos não podem passar do valor da conta');
    END IF;
  ELSE
    IF OLD.estornado_em IS NOT NULL THEN PERFORM fn_falha('ESTORNO_DUPLICADO', 'RN-27: recebimento já estornado'); END IF;
    IF NEW.conta_receber_id <> OLD.conta_receber_id OR NEW.valor <> OLD.valor OR NEW.forma <> OLD.forma
       OR NEW.recebido_em <> OLD.recebido_em OR NEW.sessao_id IS DISTINCT FROM OLD.sessao_id OR NEW.usuario_id <> OLD.usuario_id
       OR NEW.estornado_em IS NULL THEN
      PERFORM fn_falha('REGISTRO_IMUTAVEL', 'RN-27: recebimento só pode ser estornado');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_recebimento BEFORE INSERT OR UPDATE ON recebimento FOR EACH ROW EXECUTE FUNCTION fn_valida_recebimento();

CREATE OR REPLACE FUNCTION fn_recebimento_recalcula() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_recalcula_conta_receber(NEW.conta_receber_id);
  RETURN NULL;
END $$;
CREATE TRIGGER tg_recebimento_recalcula AFTER INSERT OR UPDATE ON recebimento FOR EACH ROW EXECUTE FUNCTION fn_recebimento_recalcula();

CREATE OR REPLACE FUNCTION fn_valida_alteracao_conta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CANCELADA' THEN PERFORM fn_falha('CONTA_CANCELADA', 'Conta cancelada não muda'); END IF;
  IF NEW.cliente_id <> OLD.cliente_id OR NEW.venda_id IS DISTINCT FROM OLD.venda_id OR NEW.valor <> OLD.valor
     OR NEW.criada_por_id <> OLD.criada_por_id OR NEW.criada_em <> OLD.criada_em THEN
    PERFORM fn_falha('REGISTRO_IMUTAVEL', 'RN-27: cliente, venda e valor da conta não mudam');
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'CANCELADA' THEN
      IF EXISTS (SELECT 1 FROM recebimento WHERE conta_receber_id = OLD.id AND estornado_em IS NULL) THEN
        PERFORM fn_falha('CONTA_COM_RECEBIMENTO', 'Conta com recebimento ativo não pode ser cancelada');
      END IF;
    ELSIF coalesce(current_setting('bazar.recalculo', true), 'off') <> 'on' THEN
      PERFORM fn_falha('STATUS_CALCULADO', 'RN-27: o status da conta é recalculado pelo banco');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_alteracao_conta BEFORE UPDATE ON conta_receber FOR EACH ROW EXECUTE FUNCTION fn_valida_alteracao_conta();

-- ------------------------------------------------------------------ contas a pagar (RN-05, RN-19, RN-32)
CREATE OR REPLACE FUNCTION fn_valida_alteracao_conta_pagar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CANCELADA' THEN PERFORM fn_falha('CONTA_CANCELADA', 'RN-32: conta cancelada não muda'); END IF;
  IF OLD.status = 'PAGA' THEN
    IF NEW.status <> 'CANCELADA' OR NEW.valor <> OLD.valor OR NEW.descricao <> OLD.descricao OR NEW.vencimento <> OLD.vencimento
       OR NEW.pago_em IS DISTINCT FROM OLD.pago_em OR NEW.valor_pago IS DISTINCT FROM OLD.valor_pago
       OR NEW.caixa_lancamento_id IS DISTINCT FROM OLD.caixa_lancamento_id THEN
      PERFORM fn_falha('CONTA_PAGA', 'RN-32: conta paga não é editada; cancele com motivo');
    END IF;
  END IF;
  IF NEW.lote_id IS DISTINCT FROM OLD.lote_id OR (OLD.lote_id IS NOT NULL AND NEW.valor <> OLD.valor) THEN
    PERFORM fn_falha('ORIGEM_IMUTAVEL', 'RN-05: conta do lote de compra não muda de lote nem de valor');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_alteracao_conta_pagar BEFORE UPDATE ON conta_pagar FOR EACH ROW EXECUTE FUNCTION fn_valida_alteracao_conta_pagar();

CREATE OR REPLACE FUNCTION fn_valida_conta_do_lote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_lote lote_entrada%ROWTYPE;
BEGIN
  IF NEW.lote_id IS NOT NULL THEN
    SELECT * INTO v_lote FROM lote_entrada WHERE id = NEW.lote_id;
    IF NOT FOUND OR v_lote.tipo <> 'COMPRA' OR v_lote.valor_compra <> NEW.valor THEN
      PERFORM fn_falha('CONTA_LOTE_INVALIDA', 'RN-05: conta ligada a lote exige lote de compra com o mesmo valor');
    END IF;
  END IF;
  IF NEW.caixa_lancamento_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM caixa_lancamento WHERE id = NEW.caixa_lancamento_id AND tipo = 'SANGRIA' AND valor = coalesce(NEW.valor_pago, NEW.valor)) THEN
    PERFORM fn_falha('SANGRIA_INVALIDA', 'RN-19: conta paga do caixa exige sangria do mesmo valor');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_conta_do_lote BEFORE INSERT OR UPDATE ON conta_pagar FOR EACH ROW EXECUTE FUNCTION fn_valida_conta_do_lote();

-- ------------------------------------------------------------------ fiscal (RN-17)
CREATE OR REPLACE FUNCTION fn_valida_regra_fiscal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.vigencia_fim IS NOT NULL OR NEW.vigencia_fim IS NULL
       OR NEW.escopo <> OLD.escopo OR NEW.categoria_id IS DISTINCT FROM OLD.categoria_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
       OR NEW.situacao <> OLD.situacao OR NEW.aliquota <> OLD.aliquota OR NEW.vigencia_inicio <> OLD.vigencia_inicio THEN
      PERFORM fn_falha('REGRA_IMUTAVEL', 'RN-17: regra gravada só tem a vigência encerrada');
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM regra_fiscal r
     WHERE r.id <> NEW.id AND r.escopo = NEW.escopo
       AND r.categoria_id IS NOT DISTINCT FROM NEW.categoria_id AND r.item_id IS NOT DISTINCT FROM NEW.item_id
       AND daterange(r.vigencia_inicio, r.vigencia_fim, '[]') && daterange(NEW.vigencia_inicio, NEW.vigencia_fim, '[]')) THEN
    PERFORM fn_falha('VIGENCIA_SOBREPOSTA', 'RN-17: vigências do mesmo alvo não podem se sobrepor');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_valida_regra_fiscal BEFORE INSERT OR UPDATE ON regra_fiscal FOR EACH ROW EXECUTE FUNCTION fn_valida_regra_fiscal();

-- ------------------------------------------------------------------ perfis padrão (RF-ACS-07)
CREATE OR REPLACE FUNCTION fn_protege_perfil_padrao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.padrao AND (NOT NEW.ativo OR NOT NEW.padrao) THEN
    PERFORM fn_falha('PERFIL_PADRAO', 'Perfis padrão não podem ser desativados');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_protege_perfil_padrao BEFORE UPDATE ON perfil FOR EACH ROW EXECUTE FUNCTION fn_protege_perfil_padrao();

-- ------------------------------------------------------------------ dados iniciais
INSERT INTO permissao (codigo, modulo, descricao) VALUES
  ('usuarios.gerenciar', 'ACS', 'Usuários e redefinição de senha'),
  ('perfis.gerenciar', 'ACS', 'Perfis, permissões e limite de desconto'),
  ('auditoria.consultar', 'ACS', 'Trilha de auditoria'),
  ('cadastros.gerenciar', 'CAD', 'Categorias, parceiros, campanhas, motivos, importação'),
  ('cadastros.consultar', 'CAD', 'Consultar cadastros'),
  ('clientes.gerenciar', 'CAD', 'Clientes'),
  ('parametros.gerenciar', 'ADM', 'Parâmetros e dados da instituição'),
  ('entrada.registrar', 'ENT', 'Lotes, itens aprovados, descartes, etiquetas, encerrar triagem'),
  ('triagem.reabrir', 'TRI', 'Reabrir lote, reverter descarte'),
  ('estoque.consultar', 'EST', 'Estoque e histórico do item'),
  ('estoque.transferir', 'EST', 'Transferir entre bazar e doações'),
  ('estoque.ajustar', 'EST', 'Baixa, ajuste, preço, carga inicial'),
  ('caixa.operar', 'PDV', 'Abrir/fechar caixa, vender, sangria, suprimento'),
  ('venda.cancelar', 'PDV', 'Cancelar venda'),
  ('venda.desconto_autorizar', 'PDV', 'Desconto acima do limite do perfil'),
  ('sincronizacao.resolver', 'PDV', 'Pendências de venda offline'),
  ('terminais.gerenciar', 'CXA', 'Pontos de caixa'),
  ('contas_pagar.gerenciar', 'FIN', 'Contas a pagar e lote de compra'),
  ('contas_receber.receber', 'FIN', 'Receber fiado, extrato do cliente'),
  ('contas_receber.lancar', 'FIN', 'Conta a receber manual'),
  ('recebimento.estornar', 'FIN', 'Estornar recebimento'),
  ('relatorios.consultar', 'REL', 'Relatórios, prestação de contas, histórico de caixas'),
  ('fiscal.gerenciar', 'FIS', 'Regra de imposto'),
  ('privacidade.gerenciar', 'PRV', 'Exportar e anonimizar titulares')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO perfil (id, nome, descricao, padrao, limite_desconto_pct) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Administrador', 'Gestão do bazar', true, 100),
  ('00000000-0000-4000-8000-0000000000a2', 'Caixa', 'Operador de caixa', true, 0),
  ('00000000-0000-4000-8000-0000000000a3', 'Triagem', 'Equipe de triagem', true, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO perfil_permissao (perfil_id, permissao_codigo)
SELECT '00000000-0000-4000-8000-0000000000a1', codigo FROM permissao
ON CONFLICT DO NOTHING;
INSERT INTO perfil_permissao (perfil_id, permissao_codigo) VALUES
  ('00000000-0000-4000-8000-0000000000a2', 'caixa.operar'),
  ('00000000-0000-4000-8000-0000000000a2', 'clientes.gerenciar'),
  ('00000000-0000-4000-8000-0000000000a2', 'contas_receber.receber'),
  ('00000000-0000-4000-8000-0000000000a2', 'cadastros.consultar'),
  ('00000000-0000-4000-8000-0000000000a2', 'estoque.consultar'),
  ('00000000-0000-4000-8000-0000000000a3', 'entrada.registrar'),
  ('00000000-0000-4000-8000-0000000000a3', 'estoque.consultar'),
  ('00000000-0000-4000-8000-0000000000a3', 'estoque.transferir'),
  ('00000000-0000-4000-8000-0000000000a3', 'cadastros.consultar')
ON CONFLICT DO NOTHING;

INSERT INTO parceiro (id, nome, tipo, nao_identificado, atualizado_em)
VALUES ('00000000-0000-4000-8000-0000000000b1', 'Doador não identificado', 'OUTRO', true, now())
ON CONFLICT DO NOTHING;

INSERT INTO motivo_descarte (id, nome) VALUES (gen_random_uuid(), 'Defeito'), (gen_random_uuid(), 'Incompleto') ON CONFLICT DO NOTHING;
INSERT INTO motivo_baixa (id, nome) VALUES (gen_random_uuid(), 'Avaria'), (gen_random_uuid(), 'Perda') ON CONFLICT DO NOTHING;

INSERT INTO parametro (chave, valor, descricao) VALUES
  ('fiado.prazo_dias', '', 'Prazo padrão do fiado em dias (PA-07)'),
  ('alerta.vencimento_dias', '3', 'Avisar contas a pagar com vencimento em até N dias'),
  ('sessao.timeout_min', '30', 'Tempo de inatividade da sessão em minutos (PA-17)'),
  ('senha.tamanho_minimo', '8', 'Tamanho mínimo da senha (PA-17)'),
  ('anexo.tamanho_max_mb', '5', 'Tamanho máximo do anexo do lote em MB (RNF-18)'),
  ('pdv.max_horas_sem_sync', '8', 'Tempo máximo do PDV sem sincronizar em horas (PA-17)')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO instituicao (id, nome, uf, atualizado_em) VALUES (1, 'Associação Luz da Esperança', 'PI', now())
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------ produção (menor privilégio)
-- A API conecta com um papel SEM privilégio de exclusão, diferente do dono usado nas migrações:
--   CREATE ROLE bazar_api LOGIN PASSWORD '<do cofre de segredos>';
--   GRANT USAGE ON SCHEMA public TO bazar_api;
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO bazar_api;
--   GRANT DELETE ON sessao_usuario, idempotencia, perfil_permissao TO bazar_api;  -- limpeza técnica e troca de permissões do perfil
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bazar_api;
