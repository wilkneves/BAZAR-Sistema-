/**
 * Estado em memória da API SIMULADA (somente `npm run dev` com VITE_USE_MOCK=true).
 * Não é lógica de servidor de verdade: existe apenas para o front ser exercitado
 * contra os contratos da seção 5 enquanto o back-end Fastify não está pronto.
 * Todos os nomes/telefones são FICTÍCIOS — nunca colocar dados reais/de produção aqui.
 */
import type {
  CaixaSessao, Campanha, Categoria, CategoriaDespesa, Cliente, ContaPagar, ContaReceber, FormaPagamento,
  HistoricoEvento, Instituicao, LocalEstoque, Motivo, Parametro, Parceiro, Pendencia, Perfil, Permissao,
  Recebimento, RegraFiscal, Terminal, TipoControle, TipoEntrada, Venda, VendaRequest, AuditoriaRegistro,
} from '../api/types';
import { PERMISSOES } from '../api/types';

let n = 0;
/** Ids determinísticos legíveis para o seed (formato UUID). */
export const sid = (p: string) => `${p.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const dias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const data = (d: number) => dias(d).slice(0, 10);

export interface UsuarioDb { id: string; nome: string; login: string; senha: string; perfilId: string; ativo: boolean; trocarSenha: boolean }
export interface LoteDb {
  id: string; numero: number; tipo: TipoEntrada; parceiroId?: string; campanhaId?: string; documento?: string;
  temAnexo: boolean; recebidoEm: string; status: 'ABERTO' | 'TRIADO'; valorCompra?: number; pago?: boolean;
}
export interface ItemDb {
  id: string; codigo?: string; descricao: string; categoriaId: string; controle: TipoControle; preco: number;
  loteId: string; criadoEm: string; quantidadeInicial: number; localInicial: LocalEstoque;
  saldo: Record<LocalEstoque, number>;
}
export interface MovDb { id: string; itemId: string; tipo: HistoricoEvento['tipo']; quantidade: number; local?: LocalEstoque; ocorridoEm: string; usuarioNome: string; descricao: string }
export interface DescarteDb { id: string; loteId: string; categoriaId: string; motivoId: string; registradoEm: string; revertido: boolean }
export interface VendaDb extends Venda { caixaId: string; terminalId: string; operadorId: string; alocacoes: { itemId: string; quantidade: number; precoUnit: number }[]; clienteId?: string }
export interface CaixaDb extends CaixaSessao { operadorId: string; lancamentos: { id: string; tipo: 'SANGRIA' | 'SUPRIMENTO'; valor: number; motivo: string; em: string }[] }
export interface PendenciaDb extends Pendencia { req: VendaRequest; operadorId: string }

const PERFIL_ADMIN = sid('perfadm'), PERFIL_CAIXA = sid('perfcxa'), PERFIL_TRIAGEM = sid('perftri');
const caixaPerms: Permissao[] = ['caixa.operar', 'clientes.gerenciar', 'contas_receber.receber', 'cadastros.consultar', 'estoque.consultar'];
const triagemPerms: Permissao[] = ['entrada.registrar', 'estoque.consultar', 'estoque.transferir', 'cadastros.consultar'];

const catRoupaAd = sid('catroup'), catRoupaInf = sid('catinf'), catCalc = sid('catcalc'), catLivro = sid('catliv'), catUtens = sid('catute'), catPeca = sid('catpeca');
const parcNI = sid('parcni'), parcA = sid('parca'), parcB = sid('parcb');
const campAgasalho = sid('campag'), campNatal = sid('campnat');
const mdDanif = sid('mddan'), mdIncomp = sid('mdinc'), mdSujo = sid('mdsuj');
const mbAvaria = sid('mbava'), mbPerda = sid('mbper'), mbDoacao = sid('mbdoa');
const lote1 = sid('lote1'), lote2 = sid('lote2');
const term1 = sid('term1'), term2 = sid('term2');
const cli1 = sid('cli1'), cli2 = sid('cli2'), cli3 = sid('cli3');
const despEnergia = sid('desen'), despMaterial = sid('desmat');

export const db = {
  seq: { lote: 2, venda: 1000 },
  instituicao: { nome: 'Associação Luz da Esperança', cnpj: '00.000.000/0001-00', endereco: 'Parnaíba – PI', telefone: '(86) 0000-0000' } as Instituicao,
  perfis: [
    { id: PERFIL_ADMIN, nome: 'Administrador', padrao: true, permissoes: [...PERMISSOES], limiteDesconto: '100.00' },
    { id: PERFIL_CAIXA, nome: 'Caixa', padrao: true, permissoes: caixaPerms, limiteDesconto: '10.00' },
    { id: PERFIL_TRIAGEM, nome: 'Triagem', padrao: true, permissoes: triagemPerms, limiteDesconto: '0.00' },
  ] as Perfil[],
  // Senhas em texto puro APENAS no mock. O servidor real usa argon2id (RNF-07).
  usuarios: [
    { id: sid('usradm'), nome: 'Ana Administradora', login: 'admin', senha: 'Admin@123', perfilId: PERFIL_ADMIN, ativo: true, trocarSenha: false },
    { id: sid('usrcxa'), nome: 'Carlos do Caixa', login: 'caixa', senha: 'Caixa@123', perfilId: PERFIL_CAIXA, ativo: true, trocarSenha: false },
    { id: sid('usrtri'), nome: 'Teresa da Triagem', login: 'triagem', senha: 'Triagem@123', perfilId: PERFIL_TRIAGEM, ativo: true, trocarSenha: false },
  ] as UsuarioDb[],
  categorias: [
    { id: catRoupaAd, nome: 'Roupa adulto', precoPadrao: '10.00', vendaPorCategoria: true, ativo: true },
    { id: catRoupaInf, nome: 'Roupa infantil', precoPadrao: '5.00', vendaPorCategoria: true, ativo: true },
    { id: catCalc, nome: 'Calçados', precoPadrao: '15.00', vendaPorCategoria: true, ativo: true },
    { id: catLivro, nome: 'Livros', precoPadrao: '3.00', vendaPorCategoria: true, ativo: true },
    { id: catUtens, nome: 'Utensílios', precoPadrao: '4.00', vendaPorCategoria: true, ativo: true },
    { id: catPeca, nome: 'Peças especiais (etiquetadas)', precoPadrao: '25.00', vendaPorCategoria: false, ativo: true },
  ] as Categoria[],
  parceiros: [
    { id: parcNI, nome: 'Doador não identificado', especial: true, ativo: true },
    { id: parcA, nome: 'Loja Parceira Alfa', ativo: true },
    { id: parcB, nome: 'Comunidade Bairro Beta', ativo: true },
  ] as Parceiro[],
  campanhas: [
    { id: campAgasalho, nome: 'Campanha do Agasalho 2026', inicio: data(-60), fim: data(30), ativo: true },
    { id: campNatal, nome: 'Natal Solidário 2026', inicio: data(20), fim: data(90), ativo: true },
  ] as Campanha[],
  motivosDescarte: [
    { id: mdDanif, nome: 'Danificado', ativo: true }, { id: mdIncomp, nome: 'Incompleto', ativo: true }, { id: mdSujo, nome: 'Sujo/mofado', ativo: true },
  ] as Motivo[],
  motivosBaixa: [
    { id: mbAvaria, nome: 'Avaria no estoque', ativo: true }, { id: mbPerda, nome: 'Perda/extravio', ativo: true }, { id: mbDoacao, nome: 'Doado à assistência', ativo: true },
  ] as Motivo[],
  categoriasDespesa: [
    { id: despEnergia, nome: 'Energia', ativo: true }, { id: despMaterial, nome: 'Material de consumo', ativo: true },
  ] as CategoriaDespesa[],
  clientes: [
    { id: cli1, nome: 'Maria Exemplo', telefone: '(86) 90000-0001', ativo: true, cienciaAviso: true },
    { id: cli2, nome: 'João Fictício', telefone: '(86) 90000-0002', ativo: true, cienciaAviso: true },
    { id: cli3, nome: 'Rita Teste', telefone: '(86) 90000-0003', ativo: true, cienciaAviso: true },
  ] as Cliente[],
  terminais: [{ id: term1, nome: 'Caixa 1 — Balcão', ativo: true }, { id: term2, nome: 'Caixa 2 — Tablet', ativo: true }] as Terminal[],
  lotes: [
    { id: lote1, numero: 1, tipo: 'DOACAO', parceiroId: parcA, documento: 'Termo 045/2026', temAnexo: false, recebidoEm: dias(-20), status: 'TRIADO' },
    { id: lote2, numero: 2, tipo: 'DOACAO', parceiroId: parcB, campanhaId: campAgasalho, temAnexo: false, recebidoEm: dias(-3), status: 'ABERTO' },
  ] as LoteDb[],
  itens: [] as ItemDb[],
  movs: [] as MovDb[],
  descartes: [] as DescarteDb[],
  vendas: [] as VendaDb[],
  caixas: [] as CaixaDb[],
  pendencias: [] as PendenciaDb[],
  contasPagar: [
    { id: sid('cp1'), descricao: 'Conta de energia — setembro', categoriaDespesaId: despEnergia, categoriaDespesaNome: 'Energia', valor: '187.40', vencimento: data(-2), status: 'ABERTA' },
    { id: sid('cp2'), descricao: 'Sacolas e etiquetas', categoriaDespesaId: despMaterial, categoriaDespesaNome: 'Material de consumo', valor: '96.00', vencimento: data(5), status: 'ABERTA' },
  ] as ContaPagar[],
  contasReceber: [
    { id: sid('cr1'), clienteId: cli1, clienteNome: 'Maria Exemplo', descricao: 'Saldo anterior ao sistema', valor: '45.00', saldo: '45.00', vencimento: data(10), status: 'ABERTA' },
  ] as ContaReceber[],
  recebimentos: [] as Recebimento[],
  regrasFiscais: [
    { id: sid('rf1'), alvo: 'GERAL', situacao: 'ISENTO', aliquota: '0.00', vigenciaInicio: '2026-01-01' },
  ] as RegraFiscal[],
  parametros: [
    { chave: 'fiado.prazo_dias', valor: '30', descricao: 'Prazo padrão do fiado em dias (PA-07 pendente)', tipo: 'number' },
    { chave: 'alerta.vencimento_dias', valor: '3', descricao: 'Avisar contas a pagar com vencimento em até N dias', tipo: 'number' },
    { chave: 'sessao.timeout_min', valor: '30', descricao: 'Tempo de inatividade da sessão (min)', tipo: 'number' },
    { chave: 'senha.tamanho_minimo', valor: '8', descricao: 'Tamanho mínimo da senha', tipo: 'number' },
    { chave: 'anexo.tamanho_max_mb', valor: '5', descricao: 'Tamanho máximo do anexo do lote (MB)', tipo: 'number' },
    { chave: 'pdv.max_horas_sem_sync', valor: '8', descricao: 'Tempo máximo do PDV sem sincronizar (h)', tipo: 'number' },
  ] as Parametro[],
  auditoria: [] as AuditoriaRegistro[],
};

// ---------- Seed de itens e movimentações ----------
function addItem(p: Omit<ItemDb, 'id' | 'criadoEm' | 'saldo'> & { id?: string }) {
  const it: ItemDb = { ...p, id: p.id ?? sid('item'), criadoEm: dias(-19), saldo: { BAZAR: 0, DOACOES: 0 } };
  it.saldo[p.localInicial] = p.quantidadeInicial;
  db.itens.push(it);
  db.movs.push({ id: sid('mov'), itemId: it.id, tipo: 'ENTRADA', quantidade: p.quantidadeInicial, local: p.localInicial, ocorridoEm: it.criadoEm, usuarioNome: 'Teresa da Triagem', descricao: 'Entrada pela triagem' });
  return it;
}
['Jaqueta jeans', 'Vestido de festa', 'Bolsa de couro', 'Terno masculino', 'Liquidificador'].forEach((d, i) =>
  addItem({ codigo: `BZ${String(i + 1).padStart(6, '0')}`, descricao: d, categoriaId: catPeca, controle: 'ETIQUETADO', preco: [3500, 6000, 4500, 8000, 3000][i]!, loteId: lote1, quantidadeInicial: 1, localInicial: 'BAZAR' }));
addItem({ descricao: 'Roupa adulto (lote 1)', categoriaId: catRoupaAd, controle: 'CATEGORIA', preco: 1000, loteId: lote1, quantidadeInicial: 30, localInicial: 'BAZAR' });
addItem({ descricao: 'Livros (lote 1)', categoriaId: catLivro, controle: 'CATEGORIA', preco: 300, loteId: lote1, quantidadeInicial: 20, localInicial: 'BAZAR' });
addItem({ descricao: 'Roupa infantil (lote 1)', categoriaId: catRoupaInf, controle: 'CATEGORIA', preco: 500, loteId: lote1, quantidadeInicial: 15, localInicial: 'DOACOES' });
addItem({ descricao: 'Roupa adulto (lote 2)', categoriaId: catRoupaAd, controle: 'CATEGORIA', preco: 1000, loteId: lote2, quantidadeInicial: 12, localInicial: 'BAZAR' });
addItem({ descricao: 'Calçados (lote 2)', categoriaId: catCalc, controle: 'CATEGORIA', preco: 1500, loteId: lote2, quantidadeInicial: 8, localInicial: 'BAZAR' });
db.descartes.push({ id: sid('desc'), loteId: lote1, categoriaId: catRoupaAd, motivoId: mdDanif, registradoEm: dias(-19), revertido: false });

export const FORMAS: FormaPagamento[] = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO'];
