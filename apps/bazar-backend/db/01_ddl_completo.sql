-- =====================================================================================
-- Sistema de Bazar — Luz da Esperança · DDL COMPLETA (instalação do zero, PostgreSQL 11+; testado no 16)
-- Gerado pela concatenação das migrações oficiais — a fonte da verdade continua sendo
-- prisma/migrations/* aplicadas com `prisma migrate deploy`. Use este arquivo para revisão,
-- ambientes sem Node/Prisma ou para recriar um banco de teste:
--   createdb -O bazar_owner bazar_teste
--   psql -v ON_ERROR_STOP=1 -1 -U bazar_owner -d bazar_teste -f db/01_ddl_completo.sql
--   psql -U postgres -d bazar_teste -v senha_api=... -f db/03_seguranca_papeis.sql
-- NÃO rode num banco que já tem as migrações (o Prisma registra o que aplicou em _prisma_migrations).
-- =====================================================================================


-- #####################################################################################
-- ## 0001_inicial — tabelas, enums, PK/FK/UK, índices (gerado pelo Prisma 7.10)
-- #####################################################################################
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TipoParceiro" AS ENUM ('EMPRESA', 'LOJA', 'PESSOA_FISICA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoEntrada" AS ENUM ('DOACAO', 'COMPRA', 'SALDO_INICIAL');

-- CreateEnum
CREATE TYPE "StatusLote" AS ENUM ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'TRIADO');

-- CreateEnum
CREATE TYPE "TipoDocumentoOrigem" AS ENUM ('NOTA_FISCAL', 'TERMO_DOACAO', 'RECIBO', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoControle" AS ENUM ('ETIQUETADO', 'CATEGORIA');

-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('ENTRADA', 'TRANSFERENCIA', 'VENDA', 'ESTORNO_VENDA', 'BAIXA', 'AJUSTE_ENTRADA', 'AJUSTE_SAIDA');

-- CreateEnum
CREATE TYPE "StatusCaixa" AS ENUM ('ABERTO', 'FECHADO');

-- CreateEnum
CREATE TYPE "TipoLancamentoCaixa" AS ENUM ('SUPRIMENTO', 'SANGRIA');

-- CreateEnum
CREATE TYPE "StatusVenda" AS ENUM ('FINALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "OrigemRegistroVenda" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "FormaSelecao" AS ENUM ('CODIGO', 'CATEGORIA');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO');

-- CreateEnum
CREATE TYPE "StatusContaReceber" AS ENUM ('ABERTA', 'PARCIAL', 'QUITADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusContaPagar" AS ENUM ('ABERTA', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "SituacaoFiscal" AS ENUM ('ISENTO', 'TRIBUTADO');

-- CreateEnum
CREATE TYPE "EscopoRegraFiscal" AS ENUM ('GERAL', 'CATEGORIA', 'ITEM');

-- CreateEnum
CREATE TYPE "TipoTitular" AS ENUM ('CLIENTE', 'PARCEIRO');

-- CreateEnum
CREATE TYPE "StatusPendencia" AS ENUM ('PENDENTE', 'RESOLVIDA', 'DESCARTADA');

-- CreateTable
CREATE TABLE "instituicao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nome" TEXT NOT NULL,
    "cnpj" CHAR(14),
    "uf" CHAR(2) NOT NULL,
    "endereco" TEXT,
    "telefone" TEXT,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instituicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametro" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "parametro_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "terminal" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfil" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "limite_desconto_pct" DECIMAL(5,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissao" (
    "codigo" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,

    CONSTRAINT "permissao_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "perfil_permissao" (
    "perfil_id" UUID NOT NULL,
    "permissao_codigo" TEXT NOT NULL,

    CONSTRAINT "perfil_permissao_pkey" PRIMARY KEY ("perfil_id","permissao_codigo")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "perfil_id" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "trocar_senha" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acesso_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao_usuario" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "terminal_id" UUID,
    "refresh_token_hash" TEXT NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogada_em" TIMESTAMPTZ(3),

    CONSTRAINT "sessao_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" UUID,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "ip" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotencia" (
    "chave" UUID NOT NULL,
    "escopo" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotencia_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "categoria" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "preco_padrao" DECIMAL(10,2),
    "venda_por_categoria" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motivo_descarte" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "motivo_descarte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motivo_baixa" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "motivo_baixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parceiro" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoParceiro" NOT NULL,
    "nao_identificado" BOOLEAN NOT NULL DEFAULT false,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "cidade" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanha" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "parceiro_id" UUID,
    "data_inicio" DATE,
    "data_fim" DATE,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campanha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "documento" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "anonimizado_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimento" (
    "id" UUID NOT NULL,
    "titular_tipo" "TipoTitular" NOT NULL,
    "cliente_id" UUID,
    "parceiro_id" UUID,
    "finalidade" TEXT NOT NULL,
    "versao_aviso" TEXT NOT NULL,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogado_em" TIMESTAMPTZ(3),
    "registrado_por_id" UUID NOT NULL,

    CONSTRAINT "consentimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote_entrada" (
    "id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "tipo" "TipoEntrada" NOT NULL,
    "parceiro_id" UUID,
    "campanha_id" UUID,
    "recebido_em" TIMESTAMPTZ(3) NOT NULL,
    "recebido_por_id" UUID NOT NULL,
    "status" "StatusLote" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
    "documento_tipo" "TipoDocumentoOrigem",
    "documento_numero" TEXT,
    "documento_arquivo" TEXT,
    "valor_compra" DECIMAL(10,2),
    "observacao" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lote_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "tipo_controle" "TipoControle" NOT NULL,
    "codigo_barras" TEXT,
    "descricao" TEXT,
    "valor_atribuido" DECIMAL(10,2) NOT NULL,
    "preco_venda" DECIMAL(10,2),
    "quantidade_inicial" INTEGER NOT NULL,
    "descarte_origem_id" UUID,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descarte" (
    "id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "motivo_id" UUID NOT NULL,
    "descricao" TEXT,
    "observacao" TEXT,
    "registrado_por_id" UUID NOT NULL,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertido_em" TIMESTAMPTZ(3),
    "revertido_por_id" UUID,

    CONSTRAINT "descarte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_estoque" (
    "id" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "permite_venda" BOOLEAN NOT NULL,

    CONSTRAINT "local_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacao" (
    "id" BIGSERIAL NOT NULL,
    "item_id" UUID NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "local_origem_id" INTEGER,
    "local_destino_id" INTEGER,
    "quantidade" INTEGER NOT NULL,
    "venda_item_id" UUID,
    "motivo_baixa_id" UUID,
    "motivo" TEXT,
    "usuario_id" UUID NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixa_sessao" (
    "id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "status" "StatusCaixa" NOT NULL DEFAULT 'ABERTO',
    "aberto_por_id" UUID NOT NULL,
    "aberto_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor_abertura" DECIMAL(10,2) NOT NULL,
    "fechado_por_id" UUID,
    "fechado_em" TIMESTAMPTZ(3),
    "valor_esperado" DECIMAL(10,2),
    "valor_contado" DECIMAL(10,2),
    "diferenca" DECIMAL(10,2),
    "observacao" TEXT,

    CONSTRAINT "caixa_sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixa_lancamento" (
    "id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "tipo" "TipoLancamentoCaixa" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caixa_lancamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda" (
    "id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "numero_local" TEXT,
    "terminal_id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "cliente_id" UUID,
    "status" "StatusVenda" NOT NULL DEFAULT 'FINALIZADA',
    "origem_registro" "OrigemRegistroVenda" NOT NULL DEFAULT 'ONLINE',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "registrada_por_id" UUID NOT NULL,
    "ocorrida_em" TIMESTAMPTZ(3) NOT NULL,
    "registrada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelada_por_id" UUID,
    "cancelada_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" TEXT,

    CONSTRAINT "venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_item" (
    "id" UUID NOT NULL,
    "venda_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "forma_selecao" "FormaSelecao" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valor_total" DECIMAL(10,2) NOT NULL,
    "situacao_fiscal" "SituacaoFiscal" NOT NULL,
    "aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_imposto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "regra_fiscal_id" UUID,

    CONSTRAINT "venda_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_pagamento" (
    "id" UUID NOT NULL,
    "venda_id" UUID NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "valor_recebido" DECIMAL(10,2),
    "troco" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "venda_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pendencia_sincronizacao" (
    "id" UUID NOT NULL,
    "terminal_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "referencia_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "motivo" TEXT NOT NULL,
    "status" "StatusPendencia" NOT NULL DEFAULT 'PENDENTE',
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvida_por_id" UUID,
    "resolvida_em" TIMESTAMPTZ(3),
    "resolucao" TEXT,

    CONSTRAINT "pendencia_sincronizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conta_receber" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "venda_id" UUID,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "StatusContaReceber" NOT NULL DEFAULT 'ABERTA',
    "criada_por_id" UUID NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conta_receber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recebimento" (
    "id" UUID NOT NULL,
    "conta_receber_id" UUID NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "recebido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessao_id" UUID,
    "usuario_id" UUID NOT NULL,
    "observacao" TEXT,
    "estornado_em" TIMESTAMPTZ(3),
    "estornado_por_id" UUID,
    "motivo_estorno" TEXT,

    CONSTRAINT "recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categoria_despesa" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categoria_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conta_pagar" (
    "id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "favorecido" TEXT,
    "categoria_despesa_id" UUID,
    "valor" DECIMAL(10,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "StatusContaPagar" NOT NULL DEFAULT 'ABERTA',
    "pago_em" TIMESTAMPTZ(3),
    "valor_pago" DECIMAL(10,2),
    "forma_pagamento" "FormaPagamento",
    "caixa_lancamento_id" UUID,
    "lote_id" UUID,
    "observacao" TEXT,
    "criada_por_id" UUID NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conta_pagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regra_fiscal" (
    "id" UUID NOT NULL,
    "tributo" TEXT NOT NULL DEFAULT 'ICMS',
    "escopo" "EscopoRegraFiscal" NOT NULL,
    "categoria_id" UUID,
    "item_id" UUID,
    "situacao" "SituacaoFiscal" NOT NULL,
    "aliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fundamento_legal" TEXT,
    "vigencia_inicio" DATE NOT NULL,
    "vigencia_fim" DATE,
    "criada_por_id" UUID NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regra_fiscal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terminal_nome_key" ON "terminal"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "perfil_nome_key" ON "perfil"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_login_key" ON "usuario"("login");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_usuario_refresh_token_hash_key" ON "sessao_usuario"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessao_usuario_usuario_id_idx" ON "sessao_usuario"("usuario_id");

-- CreateIndex
CREATE INDEX "auditoria_criado_em_idx" ON "auditoria"("criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "motivo_descarte_nome_key" ON "motivo_descarte"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "motivo_baixa_nome_key" ON "motivo_baixa"("nome");

-- CreateIndex
CREATE INDEX "parceiro_nome_idx" ON "parceiro"("nome");

-- CreateIndex
CREATE INDEX "cliente_nome_idx" ON "cliente"("nome");

-- CreateIndex
CREATE INDEX "cliente_telefone_idx" ON "cliente"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "lote_entrada_numero_key" ON "lote_entrada"("numero");

-- CreateIndex
CREATE INDEX "lote_entrada_parceiro_id_idx" ON "lote_entrada"("parceiro_id");

-- CreateIndex
CREATE INDEX "lote_entrada_campanha_id_idx" ON "lote_entrada"("campanha_id");

-- CreateIndex
CREATE INDEX "lote_entrada_recebido_em_idx" ON "lote_entrada"("recebido_em");

-- CreateIndex
CREATE UNIQUE INDEX "item_codigo_barras_key" ON "item"("codigo_barras");

-- CreateIndex
CREATE UNIQUE INDEX "item_descarte_origem_id_key" ON "item"("descarte_origem_id");

-- CreateIndex
CREATE INDEX "item_lote_id_idx" ON "item"("lote_id");

-- CreateIndex
CREATE INDEX "item_categoria_id_tipo_controle_idx" ON "item"("categoria_id", "tipo_controle");

-- CreateIndex
CREATE INDEX "descarte_lote_id_idx" ON "descarte"("lote_id");

-- CreateIndex
CREATE UNIQUE INDEX "local_estoque_codigo_key" ON "local_estoque"("codigo");

-- CreateIndex
CREATE INDEX "movimentacao_item_id_idx" ON "movimentacao"("item_id");

-- CreateIndex
CREATE INDEX "movimentacao_ocorrido_em_idx" ON "movimentacao"("ocorrido_em");

-- CreateIndex
CREATE INDEX "movimentacao_tipo_ocorrido_em_idx" ON "movimentacao"("tipo", "ocorrido_em");

-- CreateIndex
CREATE INDEX "caixa_sessao_terminal_id_idx" ON "caixa_sessao"("terminal_id");

-- CreateIndex
CREATE INDEX "caixa_lancamento_sessao_id_idx" ON "caixa_lancamento"("sessao_id");

-- CreateIndex
CREATE UNIQUE INDEX "venda_numero_key" ON "venda"("numero");

-- CreateIndex
CREATE INDEX "venda_ocorrida_em_idx" ON "venda"("ocorrida_em");

-- CreateIndex
CREATE INDEX "venda_sessao_id_idx" ON "venda"("sessao_id");

-- CreateIndex
CREATE INDEX "venda_item_venda_id_idx" ON "venda_item"("venda_id");

-- CreateIndex
CREATE INDEX "venda_item_item_id_idx" ON "venda_item"("item_id");

-- CreateIndex
CREATE INDEX "venda_pagamento_venda_id_idx" ON "venda_pagamento"("venda_id");

-- CreateIndex
CREATE UNIQUE INDEX "pendencia_sincronizacao_tipo_referencia_id_key" ON "pendencia_sincronizacao"("tipo", "referencia_id");

-- CreateIndex
CREATE UNIQUE INDEX "conta_receber_venda_id_key" ON "conta_receber"("venda_id");

-- CreateIndex
CREATE INDEX "conta_receber_cliente_id_status_idx" ON "conta_receber"("cliente_id", "status");

-- CreateIndex
CREATE INDEX "conta_receber_vencimento_idx" ON "conta_receber"("vencimento");

-- CreateIndex
CREATE INDEX "recebimento_sessao_id_idx" ON "recebimento"("sessao_id");

-- CreateIndex
CREATE INDEX "recebimento_conta_receber_id_idx" ON "recebimento"("conta_receber_id");

-- CreateIndex
CREATE UNIQUE INDEX "categoria_despesa_nome_key" ON "categoria_despesa"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "conta_pagar_caixa_lancamento_id_key" ON "conta_pagar"("caixa_lancamento_id");

-- CreateIndex
CREATE UNIQUE INDEX "conta_pagar_lote_id_key" ON "conta_pagar"("lote_id");

-- CreateIndex
CREATE INDEX "conta_pagar_status_vencimento_idx" ON "conta_pagar"("status", "vencimento");

-- AddForeignKey
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfil_permissao" ADD CONSTRAINT "perfil_permissao_permissao_codigo_fkey" FOREIGN KEY ("permissao_codigo") REFERENCES "permissao"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_usuario" ADD CONSTRAINT "sessao_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_usuario" ADD CONSTRAINT "sessao_usuario_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha" ADD CONSTRAINT "campanha_parceiro_id_fkey" FOREIGN KEY ("parceiro_id") REFERENCES "parceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_parceiro_id_fkey" FOREIGN KEY ("parceiro_id") REFERENCES "parceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_entrada" ADD CONSTRAINT "lote_entrada_parceiro_id_fkey" FOREIGN KEY ("parceiro_id") REFERENCES "parceiro"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_entrada" ADD CONSTRAINT "lote_entrada_campanha_id_fkey" FOREIGN KEY ("campanha_id") REFERENCES "campanha"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lote_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_descarte_origem_id_fkey" FOREIGN KEY ("descarte_origem_id") REFERENCES "descarte"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descarte" ADD CONSTRAINT "descarte_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lote_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descarte" ADD CONSTRAINT "descarte_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descarte" ADD CONSTRAINT "descarte_motivo_id_fkey" FOREIGN KEY ("motivo_id") REFERENCES "motivo_descarte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_local_origem_id_fkey" FOREIGN KEY ("local_origem_id") REFERENCES "local_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_local_destino_id_fkey" FOREIGN KEY ("local_destino_id") REFERENCES "local_estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_venda_item_id_fkey" FOREIGN KEY ("venda_item_id") REFERENCES "venda_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_motivo_baixa_id_fkey" FOREIGN KEY ("motivo_baixa_id") REFERENCES "motivo_baixa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixa_sessao" ADD CONSTRAINT "caixa_sessao_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixa_lancamento" ADD CONSTRAINT "caixa_lancamento_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "caixa_sessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "caixa_sessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda" ADD CONSTRAINT "venda_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_item" ADD CONSTRAINT "venda_item_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_item" ADD CONSTRAINT "venda_item_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_item" ADD CONSTRAINT "venda_item_regra_fiscal_id_fkey" FOREIGN KEY ("regra_fiscal_id") REFERENCES "regra_fiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_pagamento" ADD CONSTRAINT "venda_pagamento_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia_sincronizacao" ADD CONSTRAINT "pendencia_sincronizacao_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_receber" ADD CONSTRAINT "conta_receber_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_receber" ADD CONSTRAINT "conta_receber_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimento" ADD CONSTRAINT "recebimento_conta_receber_id_fkey" FOREIGN KEY ("conta_receber_id") REFERENCES "conta_receber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimento" ADD CONSTRAINT "recebimento_sessao_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "caixa_sessao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_pagar" ADD CONSTRAINT "conta_pagar_categoria_despesa_id_fkey" FOREIGN KEY ("categoria_despesa_id") REFERENCES "categoria_despesa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_pagar" ADD CONSTRAINT "conta_pagar_caixa_lancamento_id_fkey" FOREIGN KEY ("caixa_lancamento_id") REFERENCES "caixa_lancamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta_pagar" ADD CONSTRAINT "conta_pagar_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lote_entrada"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regra_fiscal" ADD CONSTRAINT "regra_fiscal_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regra_fiscal" ADD CONSTRAINT "regra_fiscal_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- #####################################################################################
-- ## 0002_invariantes — CHECKs, triggers, views, índices parciais e dados de referência
-- #####################################################################################
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


-- #####################################################################################
-- ## 0003_dba_integridade_desempenho — FKs de autoria, saldo materializado, índices, LGPD
-- #####################################################################################
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
