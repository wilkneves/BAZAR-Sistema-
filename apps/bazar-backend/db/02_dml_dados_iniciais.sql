-- =====================================================================================
-- DML — dados de referência e da primeira instalação (idempotente: pode rodar de novo)
-- Os mesmos INSERTs já rodam dentro da 0002; este arquivo serve para conferir/restaurar
-- a carga de referência num banco existente. Rodar com o papel DONO.
--   psql -v ON_ERROR_STOP=1 -1 -d bazar -f db/02_dml_dados_iniciais.sql
-- O usuário Administrador NÃO é criado aqui (senha precisa de hash argon2id): use
--   ADMIN_INITIAL_PASSWORD=... npm run db:seed     (troca obrigatória no 1º acesso)
-- =====================================================================================

-- estoques físicos (ids fixos: a API e as views usam 1 = BAZAR, 2 = DOACOES)
INSERT INTO local_estoque (id, codigo, nome, permite_venda) VALUES
  (1, 'BAZAR', 'Estoque do bazar', true),
  (2, 'DOACOES', 'Estoque de doações', false)
ON CONFLICT (id) DO NOTHING;

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

INSERT INTO motivo_descarte (id, nome) VALUES (gen_random_uuid(), 'Defeito'), (gen_random_uuid(), 'Incompleto') ON CONFLICT (nome) DO NOTHING;
INSERT INTO motivo_baixa (id, nome) VALUES (gen_random_uuid(), 'Avaria'), (gen_random_uuid(), 'Perda') ON CONFLICT (nome) DO NOTHING;

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


-- RN-17: regra fiscal GERAL ISENTO vigente (só se ainda não existir e já houver um Administrador)
INSERT INTO regra_fiscal (id, escopo, situacao, aliquota, vigencia_inicio, fundamento_legal, criada_por_id)
SELECT gen_random_uuid(), 'GERAL', 'ISENTO', 0, DATE '2026-01-01', 'Situação atual: isenta (PA-05 em análise com o contador)', u.id
FROM usuario u
WHERE u.perfil_id = '00000000-0000-4000-8000-0000000000a1' AND u.ativo
  AND NOT EXISTS (SELECT 1 FROM regra_fiscal WHERE escopo = 'GERAL')
ORDER BY u.criado_em LIMIT 1;

-- conferência
SELECT 'locais' AS item, count(*) FROM local_estoque
UNION ALL SELECT 'permissoes', count(*) FROM permissao
UNION ALL SELECT 'perfis padrão', count(*) FROM perfil WHERE padrao
UNION ALL SELECT 'parâmetros', count(*) FROM parametro
UNION ALL SELECT 'regra fiscal geral vigente', count(*) FROM regra_fiscal WHERE escopo = 'GERAL' AND vigencia_fim IS NULL;
