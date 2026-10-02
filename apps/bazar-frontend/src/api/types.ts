/**
 * DTOs dos contratos da API (Especificação Técnica, seção 5).
 * Convenções: dinheiro = string "12.50"; datas = ISO 8601 com fuso; ids = UUID.
 * Quando o back-end publicar o OpenAPI, estes tipos devem ser gerados a partir dele.
 */
import type { Money } from '../lib/money';
export type { Money };
export type Uuid = string;
export type IsoDateTime = string;
/** Data local sem hora, "aaaa-mm-dd" (filtros de período, vencimentos). */
export type LocalDate = string;

// ---------- Enumerações (arquivo 04) ----------
export type TipoEntrada = 'DOACAO' | 'COMPRA' | 'SALDO_INICIAL';
export type TipoControle = 'ETIQUETADO' | 'CATEGORIA';
export type LocalEstoque = 'BAZAR' | 'DOACOES';
export type TipoMovimentacao =
  | 'ENTRADA' | 'TRANSFERENCIA' | 'VENDA' | 'ESTORNO_VENDA' | 'BAIXA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SAIDA';
export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' | 'FIADO';
export type OrigemRegistroVenda = 'ONLINE' | 'OFFLINE';
export type StatusContaReceber = 'ABERTA' | 'PARCIAL' | 'QUITADA' | 'CANCELADA';

export const FORMAS_PAGAMENTO: { value: FormaPagamento; label: string }[] = [
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARTAO_DEBITO', label: 'Débito' },
  { value: 'CARTAO_CREDITO', label: 'Crédito' },
  { value: 'FIADO', label: 'Fiado' },
];

// ---------- Permissões (lista fixa de 24 — ACS) ----------
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

// ---------- Erros (RFC 9457) ----------
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code?: string;
  detail?: string;
  requestId?: string;
  /** Erros de validação por campo ou por linha (carga/importação). */
  errors?: { campo?: string; linha?: number; mensagem: string }[];
}

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }

// ---------- ACS ----------
export interface Me {
  id: Uuid;
  nome: string;
  login: string;
  perfil: { id: Uuid; nome: string };
  permissoes: Permissao[];
  /** Limite de desconto do perfil em % (PA-08 pendente: confirmar se é % ou R$). */
  limiteDesconto: Money;
  trocarSenha: boolean;
}
export interface LoginResponse { accessToken: string; expiresIn: number; usuario: Me }
export interface Usuario { id: Uuid; nome: string; login: string; perfilId: Uuid; perfilNome: string; ativo: boolean }
export interface Perfil { id: Uuid; nome: string; padrao: boolean; permissoes: Permissao[]; limiteDesconto: Money }
export interface AuditoriaRegistro {
  id: Uuid; ocorridoEm: IsoDateTime; usuarioNome: string; acao: string; entidade: string; entidadeId: string;
}

// ---------- CAD ----------
export interface Categoria { id: Uuid; nome: string; precoPadrao: Money; vendaPorCategoria: boolean; ativo: boolean }
export interface Parceiro { id: Uuid; nome: string; especial?: boolean; ativo: boolean }
export interface Campanha { id: Uuid; nome: string; inicio?: LocalDate; fim?: LocalDate; ativo: boolean }
export interface Motivo { id: Uuid; nome: string; ativo: boolean }
export interface CategoriaDespesa { id: Uuid; nome: string; ativo: boolean }
export interface Cliente {
  id: Uuid; nome: string; telefone: string; ativo: boolean;
  anonimizado?: boolean;
  /** PRV: ciência do aviso de privacidade e finalidade registradas no cadastro. */
  cienciaAviso?: boolean;
}
export interface Instituicao { nome: string; cnpj: string; endereco: string; telefone: string }

// ---------- ENT / TRI ----------
export interface LoteEntrada {
  id: Uuid;
  numero: number;
  tipo: TipoEntrada;
  parceiroId?: Uuid; parceiroNome?: string;
  campanhaId?: Uuid; campanhaNome?: string;
  documento?: string;
  temAnexo: boolean;
  recebidoEm: IsoDateTime;
  status: 'ABERTO' | 'TRIADO';
  aprovados: number;
  descartados: number;
  valorAtribuido: Money;
  valorCompra?: Money;
  pago?: boolean;
}
export interface NovoLoteRequest {
  id: Uuid; tipo: TipoEntrada; parceiroId?: Uuid; campanhaId?: Uuid; documento?: string;
  valorCompra?: Money; pago?: boolean; vencimento?: LocalDate;
}
export interface TriagemItemRequest {
  id: Uuid; categoriaId: Uuid; controle: TipoControle; quantidade: number; preco: Money;
  descricao?: string; localDestino: LocalEstoque;
}
export interface TriagemDescarteRequest { id: Uuid; categoriaId: Uuid; motivoId: Uuid; observacao?: string }
export interface LoteDetalhe extends LoteEntrada {
  itens: { id: Uuid; codigo?: string; descricao: string; categoriaNome: string; quantidade: number; preco: Money; localDestino: LocalEstoque }[];
  descartes: { id: Uuid; categoriaNome: string; motivoNome: string; registradoEm: IsoDateTime; revertido: boolean }[];
}
export interface Etiqueta { itemId: Uuid; codigo: string; descricao: string; preco: Money }

// ---------- EST ----------
export interface ItemEstoque {
  id: Uuid; codigo?: string; descricao: string;
  categoriaId: Uuid; categoriaNome: string; controle: TipoControle; preco: Money;
  loteId: Uuid; loteNumero: number; parceiroNome?: string; campanhaNome?: string;
  saldoBazar: number; saldoDoacoes: number;
}
export interface HistoricoEvento {
  ocorridoEm: IsoDateTime; tipo: TipoMovimentacao | 'TRIAGEM'; descricao: string;
  quantidade: number; local?: LocalEstoque; usuarioNome?: string;
}
export interface TransferenciaRequest {
  id: Uuid; itemId?: Uuid; codigo?: string; quantidade: number; origem: LocalEstoque; destino: LocalEstoque; motivo?: string;
}
export interface BaixaRequest { id: Uuid; itemId: Uuid; quantidade: number; local: LocalEstoque; motivoId: Uuid }
export interface AjusteRequest {
  id: Uuid; itemId: Uuid; local: LocalEstoque; tipo: 'AJUSTE_ENTRADA' | 'AJUSTE_SAIDA'; quantidade: number; motivo: string;
}
export interface CargaInicialResultado { gravado: boolean; linhas: number; erros: { linha: number; mensagem: string }[] }

// ---------- PDV ----------
export interface CatalogoPdv {
  versao: string;
  categorias: Categoria[];
  itensEtiquetados: { itemId: Uuid; codigo: string; descricao: string; preco: Money }[];
  /** RNF-19: só nome e telefone dos clientes do fiado. */
  clientesFiado: { id: Uuid; nome: string; telefone: string }[];
  regrasFiscais: RegraFiscal[];
}
export type VendaItemRequest =
  | { codigo: string; quantidade: 1; desconto?: Money }
  | { categoriaId: Uuid; quantidade: number; desconto?: Money };
export interface PagamentoRequest { forma: FormaPagamento; valor: Money; valorRecebido?: Money }
/** Corpo de PUT /vendas/:id — o servidor recalcula preços, total e troco. */
export interface VendaRequest {
  terminalId: Uuid;
  caixaId: Uuid;
  clienteId?: Uuid;
  numeroLocal?: string;
  ocorridaEm: IsoDateTime;
  origem: OrigemRegistroVenda;
  itens: VendaItemRequest[];
  desconto?: Money;
  pagamentos: PagamentoRequest[];
  vencimentoFiado?: LocalDate;
}
export interface Venda {
  id: Uuid;
  numero: number | null;
  numeroLocal?: string;
  ocorridaEm: IsoDateTime;
  origem: OrigemRegistroVenda;
  status: 'CONCLUIDA' | 'CANCELADA';
  subtotal: Money;
  desconto: Money;
  total: Money;
  troco: Money;
  itens: { descricao: string; quantidade: number; precoUnitario: Money; total: Money; loteNumero?: number }[];
  pagamentos: PagamentoRequest[];
  operadorNome: string;
  clienteNome?: string;
  vencimentoFiado?: LocalDate;
}
export interface SyncLoteRequest {
  clientes: { id: Uuid; nome: string; telefone: string; cienciaAviso: boolean }[];
  vendas: (VendaRequest & { id: Uuid })[];
}
export interface SyncLoteResponse {
  resultados: { id: Uuid; tipo: 'cliente' | 'venda'; status: 'GRAVADA' | 'JA_EXISTENTE' | 'PENDENCIA'; numero?: number; motivo?: string }[];
}
export interface Pendencia {
  id: Uuid; vendaId: Uuid; numeroLocal?: string; terminalNome: string; operadorNome: string;
  ocorridaEm: IsoDateTime; total: Money; codigo: string; motivo: string;
  status: 'ABERTA' | 'REPROCESSADA' | 'DESCARTADA';
}

// ---------- CXA ----------
export interface Terminal { id: Uuid; nome: string; ativo: boolean }
export interface CaixaSessao {
  id: Uuid; terminalId: Uuid; terminalNome: string; operadorNome: string;
  abertoEm: IsoDateTime; fundoTroco: Money; status: 'ABERTO' | 'FECHADO';
  fechadoEm?: IsoDateTime; esperado?: Money; contado?: Money; diferenca?: Money; observacao?: string;
}
export interface CaixaLancamentoRequest { id: Uuid; tipo: 'SANGRIA' | 'SUPRIMENTO'; valor: Money; motivo: string }
export interface PreviaFechamento {
  fundoTroco: Money; suprimentos: Money; sangrias: Money;
  totaisPorForma: Record<FormaPagamento, Money>;
  esperadoDinheiro: Money; quantidadeVendas: number; filaPendente: number;
}

// ---------- FIN ----------
export interface ContaPagar {
  id: Uuid; descricao: string; categoriaDespesaId: Uuid; categoriaDespesaNome: string; valor: Money;
  vencimento: LocalDate; status: 'ABERTA' | 'PAGA' | 'CANCELADA'; pagaEm?: IsoDateTime; saiuDoCaixa?: boolean;
}
export interface ContaReceber {
  id: Uuid; clienteId: Uuid; clienteNome: string; vendaNumero?: number; descricao?: string;
  valor: Money; saldo: Money; vencimento: LocalDate; status: StatusContaReceber;
}
export interface Recebimento {
  id: Uuid; contaReceberId: Uuid; valor: Money; recebidoEm: IsoDateTime; caixaId?: Uuid; estornado: boolean;
}
export interface ExtratoCliente {
  cliente: { id: Uuid; nome: string };
  contas: ContaReceber[]; recebimentos: Recebimento[]; saldoDevedor: Money;
}
export interface ResumoFinanceiro {
  de: LocalDate; ate: LocalDate;
  entradasPorForma: Record<FormaPagamento, Money>;
  recebimentosFiado: Money; saidas: Money; resultado: Money;
}

// ---------- FIS ----------
export interface RegraFiscal {
  id: Uuid; alvo: 'GERAL' | 'CATEGORIA' | 'ITEM'; alvoId?: Uuid; alvoNome?: string;
  situacao: 'ISENTO' | 'TRIBUTADO'; aliquota: Money; vigenciaInicio: LocalDate; vigenciaFim?: LocalDate;
}

// ---------- REL ----------
export type TipoRelatorio = 'prestacao-contas' | 'vendas' | 'estoque' | 'descartes' | 'transferencias' | 'fiado';
export interface RelatorioResposta {
  titulo: string;
  colunas: { chave: string; rotulo: string; tipo?: 'money' | 'number' | 'date' | 'text' }[];
  linhas: Record<string, string | number | null>[];
  totais?: Record<string, string | number>;
}

// ---------- ADM ----------
export interface Parametro { chave: string; valor: string; descricao: string; tipo: 'number' | 'text' }
export interface ImportacaoResultado { gravado: boolean; inseridos: number; duplicados: { linha: number; valor: string }[]; erros: { linha: number; mensagem: string }[] }
