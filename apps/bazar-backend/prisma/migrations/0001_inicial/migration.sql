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
