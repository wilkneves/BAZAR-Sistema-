/** Lista fixa de permissões (D-10). Os códigos são os do contrato do front-end (api/types.ts). */
export const PERMISSOES = [
  'usuarios.gerenciar', 'perfis.gerenciar', 'auditoria.consultar',
  'cadastros.gerenciar', 'cadastros.consultar', 'clientes.gerenciar', 'parametros.gerenciar',
  'entrada.registrar', 'triagem.reabrir',
  'estoque.consultar', 'estoque.transferir', 'estoque.ajustar',
  'caixa.operar', 'venda.cancelar', 'venda.desconto_autorizar', 'sincronizacao.resolver', 'terminais.gerenciar',
  'contas_pagar.gerenciar', 'contas_receber.receber', 'contas_receber.lancar', 'recebimento.estornar',
  'relatorios.consultar', 'fiscal.gerenciar', 'privacidade.gerenciar',
] as const;
export type Permissao = (typeof PERMISSOES)[number];

/** Regra de acesso declarada por TODA rota (fail secure: rota sem regra não sobe). */
export type RegraAcesso = 'publica' | 'autenticado' | readonly Permissao[];
