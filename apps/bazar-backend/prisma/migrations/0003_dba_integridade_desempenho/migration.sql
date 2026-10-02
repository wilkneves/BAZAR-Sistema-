-- =====================================================================================
-- Sistema de Bazar — Luz da Esperança
-- 0003 — Revisão de DBA (01/10/2026): integridade referencial, saldo materializado,
--        índices guiados pelas consultas do back-end e defesa em profundidade (LGPD).
--
-- Sem mudança de contrato: a API continua lendo vw_saldo_estoque / vw_movimentacao_origem
-- com as mesmas colunas. Nenhuma linha de src/ precisou mudar.
--
--  A. 19 chaves estrangeiras → usuario (doc 04 as descrevia; 0001 não as criava)
--  B. saldo_estoque: saldo por item × local mantido pelo trigger de movimentação (D-04, doc 04 §9)
--     — a movimentação continua sendo a fonte da verdade; a tabela é derivada e conferível
--  C. vw_prestacao_contas_lote reescrita com LATERAL (3,8 s → ms com 130 mil movimentações)
--  D. Índices para filtros/ordenações usados pela API
--  E. CHECKs de formato e de anonimização (LGPD)
-- =====================================================================================

-- ------------------------------------------------------------------ A. FKs → usuario
-- Usuário nunca é excluído (fn_bloqueia_exclusao); RESTRICT documenta e garante isso.
ALTER TABLE "auditoria"               ADD CONSTRAINT "auditoria_usuario_id_fkey"               FOREIGN KEY ("usuario_id")        REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotencia"            ADD CONSTRAINT "idempotencia_usuario_id_fkey"            FOREIGN KEY ("usuario_id")        REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimento"           ADD CONSTRAINT "consentimento_registrado_por_id_fkey"    FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lote_entrada"            ADD CONSTRAINT "lote_entrada_recebido_por_id_fkey"       FOREIGN KEY ("recebido_por_id")   REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item"                    ADD CONSTRAINT "item_criado_por_id_fkey"                 FOREIGN KEY ("criado_por_id")     REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "descarte"                ADD CONSTRAINT "descarte_registrado_por_id_fkey"         FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "descarte"                ADD CONSTRAINT "descarte_revertido_por_id_fkey"          FOREIGN KEY ("revertido_por_id")  REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimentacao"            ADD CONSTRAINT "movimentacao_usuario_id_fkey"            FOREIGN KEY ("usuario_id")        REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "caixa_sessao"            ADD CONSTRAINT "caixa_sessao_aberto_por_id_fkey"         FOREIGN KEY ("aberto_por_id")     REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "caixa_sessao"            ADD CONSTRAINT "caixa_sessao_fechado_por_id_fkey"        FOREIGN KEY ("fechado_por_id")    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "caixa_lancamento"        ADD CONSTRAINT "caixa_lancamento_usuario_id_fkey"        FOREIGN KEY ("usuario_id")        REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "venda"                   ADD CONSTRAINT "venda_registrada_por_id_fkey"            FOREIGN KEY ("registrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "venda"                   ADD CONSTRAINT "venda_cancelada_por_id_fkey"             FOREIGN KEY ("cancelada_por_id")  REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pendencia_sincronizacao" ADD CONSTRAINT "pendencia_sincronizacao_resolvida_por_id_fkey" FOREIGN KEY ("resolvida_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conta_receber"           ADD CONSTRAINT "conta_receber_criada_por_id_fkey"        FOREIGN KEY ("criada_por_id")     REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recebimento"             ADD CONSTRAINT "recebimento_usuario_id_fkey"             FOREIGN KEY ("usuario_id")        REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recebimento"             ADD CONSTRAINT "recebimento_estornado_por_id_fkey"       FOREIGN KEY ("estornado_por_id")  REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conta_pagar"             ADD CONSTRAINT "conta_pagar_criada_por_id_fkey"          FOREIGN KEY ("criada_por_id")     REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "regra_fiscal"            ADD CONSTRAINT "regra_fiscal_criada_por_id_fkey"         FOREIGN KEY ("criada_por_id")     REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ B. saldo materializado
CREATE TABLE "saldo_estoque" (
    "item_id"       UUID NOT NULL,
    "local_id"      INTEGER NOT NULL,
    "saldo"         INTEGER NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saldo_estoque_pkey" PRIMARY KEY ("item_id", "local_id")
);
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_item_id_fkey"  FOREIGN KEY ("item_id")  REFERENCES "item"("id")          ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "local_estoque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- RN-06/RN-10 de novo, agora também na tabela derivada (segunda barreira)
ALTER TABLE "saldo_estoque" ADD CONSTRAINT ck_saldo_nao_negativo CHECK (saldo >= 0);
-- "o que tem saldo neste local" — catálogo do PDV, PEPS, listagem de estoque, relatórios
CREATE INDEX ix_saldo_positivo_local ON saldo_estoque (local_id, item_id) WHERE saldo > 0;

-- Carga inicial a partir do histórico (mesma fórmula da view antiga)
INSERT INTO saldo_estoque (item_id, local_id, saldo)
SELECT x.item_id, x.local_id, SUM(x.q)::int
FROM (
  SELECT item_id, local_destino_id AS local_id, quantidade AS q FROM movimentacao WHERE local_destino_id IS NOT NULL
  UNION ALL
  SELECT item_id, local_origem_id, -quantidade FROM movimentacao WHERE local_origem_id IS NOT NULL
) x
GROUP BY x.item_id, x.local_id;

-- Só o trigger de movimentação (ou o recálculo controlado) escreve em saldo_estoque.
CREATE OR REPLACE FUNCTION fn_saldo_somente_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 AND coalesce(current_setting('bazar.saldo_recalculo', true), 'off') <> 'on' THEN
    PERFORM fn_falha('SALDO_DERIVADO', 'saldo_estoque é derivado de movimentacao: registre uma movimentação');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER tg_saldo_somente_trigger BEFORE INSERT OR UPDATE OR DELETE ON saldo_estoque
  FOR EACH ROW EXECUTE FUNCTION fn_saldo_somente_trigger();

-- Leitura de saldo: agora é busca por chave primária
CREATE OR REPLACE FUNCTION fn_saldo(p_item uuid, p_local int) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT saldo FROM saldo_estoque WHERE item_id = p_item AND local_id = p_local), 0);
$$;

-- 7.1 Mesma assinatura da view anterior (item_id, local_id, saldo) — a API não muda
CREATE OR REPLACE VIEW vw_saldo_estoque AS
SELECT item_id, local_id, saldo FROM saldo_estoque;

-- Trigger de estoque: mesmas regras da 0002 + aplica o saldo na própria validação.
-- Aplicar no BEFORE (e não no AFTER) preserva a semântica antiga em INSERT de várias linhas:
-- a linha seguinte do mesmo comando já enxerga o saldo da anterior (doc PG §39.4).
-- SECURITY DEFINER: o papel da API não tem escrita em saldo_estoque.
CREATE OR REPLACE FUNCTION fn_valida_movimentacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
    SELECT coalesce(sum(saldo), 0) INTO v_total FROM saldo_estoque WHERE item_id = NEW.item_id;
    IF v_total + NEW.quantidade > 1 THEN
      PERFORM fn_falha('ETIQUETADO_QTD', 'RN-08: peça etiquetada tem no máximo 1 unidade em estoque');
    END IF;
  END IF;

  -- aplica o saldo (item já travado acima: sem corrida entre caixas)
  IF NEW.local_origem_id IS NOT NULL THEN
    UPDATE saldo_estoque SET saldo = saldo - NEW.quantidade, atualizado_em = now()
     WHERE item_id = NEW.item_id AND local_id = NEW.local_origem_id;
  END IF;
  IF NEW.local_destino_id IS NOT NULL THEN
    INSERT INTO saldo_estoque (item_id, local_id, saldo) VALUES (NEW.item_id, NEW.local_destino_id, NEW.quantidade)
    ON CONFLICT (item_id, local_id) DO UPDATE SET saldo = saldo_estoque.saldo + EXCLUDED.saldo, atualizado_em = now();
  END IF;
  RETURN NEW;
END $$;

-- Conferência: saldo materializado × histórico de movimentações (deve voltar vazio)
CREATE OR REPLACE FUNCTION fn_confere_saldo()
RETURNS TABLE (item_id uuid, local_id int, saldo_tabela int, saldo_historico int) LANGUAGE sql STABLE AS $$
  WITH h AS (
    SELECT x.item_id, x.local_id, SUM(x.q)::int AS saldo
    FROM (SELECT m.item_id, m.local_destino_id AS local_id, m.quantidade AS q FROM movimentacao m WHERE m.local_destino_id IS NOT NULL
          UNION ALL
          SELECT m.item_id, m.local_origem_id, -m.quantidade FROM movimentacao m WHERE m.local_origem_id IS NOT NULL) x
    GROUP BY 1, 2)
  SELECT coalesce(s.item_id, h.item_id), coalesce(s.local_id, h.local_id), s.saldo, h.saldo
  FROM saldo_estoque s FULL JOIN h ON h.item_id = s.item_id AND h.local_id = s.local_id
  WHERE s.saldo IS DISTINCT FROM h.saldo AND NOT (s.saldo IS NULL AND h.saldo = 0) AND NOT (h.saldo IS NULL AND s.saldo = 0);
$$;

-- Recálculo controlado (manutenção pelo DBA, papel dono): reconstrói a partir do histórico
CREATE OR REPLACE FUNCTION fn_recalcula_saldo() RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  LOCK TABLE movimentacao IN SHARE MODE;  -- ninguém movimenta durante o recálculo
  PERFORM set_config('bazar.saldo_recalculo', 'on', true);
  DELETE FROM saldo_estoque;
  INSERT INTO saldo_estoque (item_id, local_id, saldo)
  SELECT x.item_id, x.local_id, SUM(x.q)::int
  FROM (SELECT item_id, local_destino_id AS local_id, quantidade AS q FROM movimentacao WHERE local_destino_id IS NOT NULL
        UNION ALL
        SELECT item_id, local_origem_id, -quantidade FROM movimentacao WHERE local_origem_id IS NOT NULL) x
  GROUP BY 1, 2;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('bazar.saldo_recalculo', 'off', true);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION fn_recalcula_saldo() FROM PUBLIC;

-- ------------------------------------------------------------------ C. prestação de contas por lote
-- Mesmas colunas e tipos da 0002; LATERAL por lote usa os índices item(lote_id) e
-- movimentacao(item_id) — filtrar por parceiro/campanha não varre o histórico inteiro.
CREATE OR REPLACE VIEW vw_prestacao_contas_lote AS
SELECT l.id AS lote_id, l.numero, l.tipo AS tipo_entrada, l.parceiro_id, l.campanha_id, l.recebido_em,
  coalesce(it.aprovados, 0)::int                AS itens_aprovados,
  coalesce(de.descartados, 0)::int              AS itens_descartados,
  coalesce(it.valor, 0)::numeric(12,2)          AS valor_atribuido,
  coalesce(mv.vendidos, 0)::int                 AS itens_vendidos,
  coalesce(mv.receita, 0)::numeric(12,2)        AS receita,
  coalesce(sa.bazar, 0)::int                    AS em_estoque_bazar,
  coalesce(sa.doacoes, 0)::int                  AS em_estoque_doacoes,
  coalesce(mv.baixados, 0)::int                 AS itens_baixados,
  coalesce(mv.ajustes, 0)::int                  AS ajustes_liquidos,
  coalesce(mv.transf_doacoes, 0)::int           AS transferidos_para_doacoes
FROM lote_entrada l
LEFT JOIN LATERAL (SELECT sum(i.quantidade_inicial) AS aprovados, sum(i.quantidade_inicial * i.valor_atribuido) AS valor
                   FROM item i WHERE i.lote_id = l.id) it ON true
LEFT JOIN LATERAL (SELECT count(*) AS descartados FROM descarte d WHERE d.lote_id = l.id AND d.revertido_em IS NULL) de ON true
LEFT JOIN LATERAL (
  SELECT sum(CASE m.tipo WHEN 'VENDA' THEN m.quantidade WHEN 'ESTORNO_VENDA' THEN -m.quantidade ELSE 0 END) AS vendidos,
         sum(CASE m.tipo WHEN 'VENDA' THEN r.receita WHEN 'ESTORNO_VENDA' THEN -r.receita ELSE 0 END)   AS receita,
         sum(m.quantidade) FILTER (WHERE m.tipo = 'BAIXA')                                                AS baixados,
         sum(CASE m.tipo WHEN 'AJUSTE_ENTRADA' THEN m.quantidade WHEN 'AJUSTE_SAIDA' THEN -m.quantidade ELSE 0 END) AS ajustes,
         sum(m.quantidade) FILTER (WHERE m.tipo = 'TRANSFERENCIA' AND m.local_destino_id = 2)             AS transf_doacoes
  FROM item i JOIN movimentacao m ON m.item_id = i.id
  LEFT JOIN vw_venda_item_receita r ON r.venda_item_id = m.venda_item_id
  WHERE i.lote_id = l.id) mv ON true
LEFT JOIN LATERAL (SELECT sum(s.saldo) FILTER (WHERE s.local_id = 1) AS bazar, sum(s.saldo) FILTER (WHERE s.local_id = 2) AS doacoes
                   FROM item i JOIN saldo_estoque s ON s.item_id = i.id WHERE i.lote_id = l.id) sa ON true;

-- ------------------------------------------------------------------ D. índices guiados pela API
-- (nome no padrão do Prisma: o schema.prisma declara os mesmos @@index — sem drift)
CREATE INDEX "venda_registrada_por_id_ocorrida_em_idx" ON "venda"("registrada_por_id", "ocorrida_em");          -- GET /vendas do operador
CREATE INDEX "caixa_sessao_aberto_por_id_aberto_em_idx" ON "caixa_sessao"("aberto_por_id", "aberto_em");        -- terminal do operador / caixa aberto
CREATE INDEX "caixa_sessao_aberto_em_idx" ON "caixa_sessao"("aberto_em");                                       -- GET /caixas por período
CREATE INDEX "pendencia_sincronizacao_terminal_id_status_idx" ON "pendencia_sincronizacao"("terminal_id", "status"); -- prévia/fechamento do caixa
CREATE INDEX "pendencia_sincronizacao_status_criada_em_idx" ON "pendencia_sincronizacao"("status", "criada_em"); -- GET /pendencias
CREATE INDEX "recebimento_recebido_em_idx" ON "recebimento"("recebido_em");                                     -- resumo financeiro
CREATE INDEX "conta_pagar_status_pago_em_idx" ON "conta_pagar"("status", "pago_em");                            -- resumo financeiro (saídas)
CREATE INDEX "descarte_registrado_em_idx" ON "descarte"("registrado_em");                                       -- RF-REL-04
CREATE INDEX "sessao_usuario_terminal_id_idx" ON "sessao_usuario"("terminal_id");                               -- revogar sessões do terminal
CREATE INDEX "sessao_usuario_expira_em_idx" ON "sessao_usuario"("expira_em");                                   -- limpeza de sessões vencidas
CREATE INDEX "idempotencia_criado_em_idx" ON "idempotencia"("criado_em");                                       -- limpeza de chaves antigas
CREATE INDEX "movimentacao_venda_item_id_idx" ON "movimentacao"("venda_item_id");                               -- estorno e conferência da venda

-- ------------------------------------------------------------------ E. formato e LGPD (defesa em profundidade)
-- A API já valida; o banco recusa dado fora do formato vindo de script ou bug.
ALTER TABLE parceiro    ADD CONSTRAINT ck_parceiro_documento CHECK (documento IS NULL OR documento ~ '^([0-9]{11}|[0-9]{14})$');
ALTER TABLE instituicao ADD CONSTRAINT ck_instituicao_cnpj   CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');
ALTER TABLE instituicao ADD CONSTRAINT ck_instituicao_uf     CHECK (uf ~ '^[A-Z]{2}$');
ALTER TABLE instituicao ADD CONSTRAINT ck_instituicao_unica  CHECK (id = 1);
ALTER TABLE parametro   ADD CONSTRAINT ck_parametro_chave    CHECK (chave ~ '^[a-z0-9_.]+$');

-- RF-PRV-02: cliente anonimizado não guarda dado pessoal e não volta a ser identificável
ALTER TABLE cliente ADD CONSTRAINT ck_cliente_anonimizado CHECK (
  anonimizado_em IS NULL OR (documento IS NULL AND observacao IS NULL AND telefone = '' AND NOT ativo)
);
CREATE OR REPLACE FUNCTION fn_cliente_anonimizado_definitivo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.anonimizado_em IS NOT NULL AND (NEW.anonimizado_em IS DISTINCT FROM OLD.anonimizado_em OR NEW.nome <> OLD.nome) THEN
    PERFORM fn_falha('TITULAR_ANONIMIZADO', 'RF-PRV-02: anonimização é definitiva');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_cliente_anonimizado_definitivo BEFORE UPDATE ON cliente FOR EACH ROW EXECUTE FUNCTION fn_cliente_anonimizado_definitivo();

-- idempotência: a limpeza técnica só apaga chaves com mais de 30 dias (reenvio offline continua seguro)
CREATE TRIGGER tg_idempotencia_retencao BEFORE DELETE ON idempotencia FOR EACH ROW
  WHEN (OLD.criado_em > now() - interval '30 days') EXECUTE FUNCTION fn_bloqueia_exclusao();

-- ------------------------------------------------------------------ privilégios do papel da API
-- (só se o papel já existir; o script completo de papéis está em db/03_seguranca_papeis.sql)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bazar_api') THEN
    REVOKE ALL ON saldo_estoque FROM bazar_api;
    GRANT SELECT ON saldo_estoque TO bazar_api;
  END IF;
END $$;
