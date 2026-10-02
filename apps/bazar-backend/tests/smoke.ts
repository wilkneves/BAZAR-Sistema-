/**
 * Teste de fumaça ponta a ponta contra a API rodando e um banco de TESTE vazio (com seed).
 * Uso: API_URL=http://127.0.0.1:3999/api/v1 ADMIN_INITIAL_PASSWORD=... npm run test:smoke
 * Cobre os fluxos críticos e os controles de segurança. Dados 100% fictícios.
 */
import { randomUUID as uuid } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
let falhas = 0, oks = 0;
function check(cond: unknown, nome: string, extra?: unknown) {
  if (cond) { oks++; console.log(`  ✔ ${nome}`); } else { falhas++; console.log(`  ✘ ${nome}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

class Cliente {
  token: string | null = null; cookie = '';
  async req(method: string, path: string, body?: unknown, extra: { form?: FormData; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(extra.headers ?? {}) };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (extra.form) payload = extra.form;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0]!;
    const ct = r.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await r.json().catch(() => null) : await r.arrayBuffer();
    return { status: r.status, data: data as any, headers: r.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b);
  async login(login: string, senha: string) {
    const r = await this.post('/auth/login', { login, senha });
    if (r.status === 200) this.token = r.data.accessToken;
    return r;
  }
}

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());

async function main() {
  const admin = new Cliente();
  console.log('ACS — autenticação');
  check((await admin.get('/me')).status === 401, 'sem token => 401');
  check((await admin.login('admin', 'errada')).status === 401, 'senha errada => 401 genérico');
  const l = await admin.login('admin', process.env.ADMIN_INITIAL_PASSWORD!);
  check(l.status === 200 && l.data.usuario.trocarSenha === true, 'login com senha provisória', l.data);
  check(admin.cookie.startsWith('bz_rt='), 'refresh em cookie HttpOnly');
  check((await admin.get('/categorias')).data?.code === 'TROCA_SENHA_OBRIGATORIA', 'senha provisória bloqueia o resto');
  check((await admin.put('/auth/senha', { senhaAtual: process.env.ADMIN_INITIAL_PASSWORD, novaSenha: 'curta' })).status === 400, 'política de senha');
  check((await admin.put('/auth/senha', { senhaAtual: process.env.ADMIN_INITIAL_PASSWORD, novaSenha: 'Nova-Senha-Forte-1' })).status === 204, 'troca de senha');
  const cookieAntigo = admin.cookie;
  const rf = await admin.post('/auth/refresh');
  check(rf.status === 200 && rf.data.accessToken, 'refresh com rotação');
  admin.token = rf.data.accessToken;
  const atacante = new Cliente(); atacante.cookie = cookieAntigo;
  check((await atacante.post('/auth/refresh')).data?.code === 'REFRESH_REUTILIZADO', 'reuso do refresh antigo revoga a família');
  check((await admin.get('/me')).status === 401, 'sessão do admin revogada após reuso detectado');
  await admin.login('admin', 'Nova-Senha-Forte-1');
  const jwtAdulterado = admin.token!.slice(0, -3) + 'abc';
  const fake = new Cliente(); fake.token = jwtAdulterado;
  check((await fake.get('/me')).status === 401, 'JWT com assinatura inválida => 401');
  const algNone = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + admin.token!.split('.')[1] + '.';
  fake.token = algNone;
  check((await fake.get('/me')).status === 401, 'JWT alg=none => 401');

  console.log('CAD — cadastros');
  const catRoupa = (await admin.post('/categorias', { id: uuid(), nome: 'Roupa adulto', precoPadrao: '10.00', vendaPorCategoria: true })).data;
  const catPeca = (await admin.post('/categorias', { id: uuid(), nome: 'Peças especiais', precoPadrao: '25.00', vendaPorCategoria: false })).data;
  check(catRoupa.id && catPeca.id, 'categorias criadas', catRoupa);
  check((await admin.post('/categorias', { id: uuid(), nome: 'roupa ADULTO' })).data?.code === 'NOME_DUPLICADO', 'nome duplicado => 409');
  const parc = (await admin.post('/parceiros', { id: uuid(), nome: 'Loja Parceira Alfa (fictícia)' })).data;
  const fornecedor = (await admin.post('/parceiros', { id: uuid(), nome: 'Fornecedor Beta (fictício)', tipo: 'EMPRESA' })).data;
  const camp = (await admin.post('/campanhas', { id: uuid(), nome: 'Campanha Teste', inicio: '2026-09-01', fim: '2026-12-31' })).data;
  const especial = (await admin.get('/parceiros')).data.find((p: any) => p.especial);
  check((await admin.patch(`/parceiros/${especial.id}`, { ativo: false })).data?.code === 'PARCEIRO_ESPECIAL', 'parceiro especial não desativa');
  const motivoDesc = (await admin.get('/motivos-descarte')).data[0];
  const motivoBaixa = (await admin.get('/motivos-baixa')).data[0];
  const term1 = (await admin.post('/terminais', { id: uuid(), nome: 'Caixa 1' })).data;
  const term2 = (await admin.post('/terminais', { id: uuid(), nome: 'Caixa 2' })).data;
  const perfis = (await admin.get('/perfis')).data;
  const perfilCaixa = perfis.find((p: any) => p.nome === 'Caixa');
  const perfilTri = perfis.find((p: any) => p.nome === 'Triagem');
  await admin.patch(`/perfis/${perfilCaixa.id}`, { limiteDesconto: '10.00' });
  const adm = perfis.find((p: any) => p.nome === 'Administrador');
  check((await admin.patch(`/perfis/${adm.id}`, { permissoes: ['caixa.operar'] })).data?.code === 'PERFIL_ADMIN_PROTEGIDO', 'admin não perde permissões essenciais');
  const ucx = (await admin.post('/usuarios', { id: uuid(), nome: 'Operadora Teste', login: 'caixa1', perfilId: perfilCaixa.id })).data;
  const utri = (await admin.post('/usuarios', { id: uuid(), nome: 'Triador Teste', login: 'triagem1', perfilId: perfilTri.id })).data;
  check(ucx.senhaProvisoria && utri.senhaProvisoria, 'usuários com senha provisória');
  const caixa = new Cliente(); await caixa.login('caixa1', ucx.senhaProvisoria); await caixa.put('/auth/senha', { senhaAtual: ucx.senhaProvisoria, novaSenha: 'Caixa-Senha-2026' });
  const tri = new Cliente(); await tri.login('triagem1', utri.senhaProvisoria); await tri.put('/auth/senha', { senhaAtual: utri.senhaProvisoria, novaSenha: 'Triagem-Senha-2026' });

  console.log('ACS — autorização (servidor decide)');
  check((await caixa.get('/usuarios')).status === 403, 'caixa não lista usuários');
  check((await tri.put(`/vendas/${uuid()}`, {})).status === 403, 'triagem não vende');
  check((await caixa.get('/relatorios/vendas?de=2026-01-01&ate=2026-12-31')).status === 403, 'caixa não vê relatórios');
  const cli = (await caixa.post('/clientes', { id: uuid(), nome: 'Maria Exemplo', telefone: '(86) 90000-0001', cienciaAviso: true })).data;
  check(cli.cienciaAviso === true && cli.telefone === '86900000001', 'cliente com consentimento', cli);
  check((await caixa.post('/clientes', { id: uuid(), nome: 'Sem Ciência', telefone: '86900000002', cienciaAviso: false })).status === 400, 'cliente sem ciência => 400');
  check((await caixa.post('/clientes/busca', { termo: 'maria' })).data.length === 1, 'busca de cliente por POST');

  console.log('ENT/TRI — lotes e triagem');
  check((await tri.post('/lotes', { id: uuid(), tipo: 'DOACAO' })).data?.code === 'ORIGEM_OBRIGATORIA', 'doação sem origem => 400 (RN-04)');
  check((await tri.post('/lotes', { id: uuid(), tipo: 'COMPRA', parceiroId: fornecedor.id, valorCompra: '100.00' })).status === 403, 'compra exige contas_pagar.gerenciar');
  const lote1 = (await tri.post('/lotes', { id: uuid(), tipo: 'DOACAO', parceiroId: parc.id, documento: 'Termo 01' })).data;
  const lote2 = (await tri.post('/lotes', { id: uuid(), tipo: 'DOACAO', campanhaId: camp.id })).data;
  check(lote1.numero && lote1.status === 'ABERTO', 'lote criado', lote1);
  const pec1 = (await tri.post(`/lotes/${lote1.id}/itens`, { id: uuid(), categoriaId: catPeca.id, controle: 'ETIQUETADO', quantidade: 1, preco: '35.00', descricao: 'Jaqueta jeans', localDestino: 'BAZAR' })).data;
  const pec2 = (await tri.post(`/lotes/${lote1.id}/itens`, { id: uuid(), categoriaId: catPeca.id, controle: 'ETIQUETADO', quantidade: 1, preco: '60.00', descricao: 'Vestido', localDestino: 'BAZAR' })).data;
  const pec3 = (await tri.post(`/lotes/${lote1.id}/itens`, { id: uuid(), categoriaId: catPeca.id, controle: 'ETIQUETADO', quantidade: 1, preco: '45.00', descricao: 'Bolsa', localDestino: 'DOACOES' })).data;
  check(/^BZ\d{6}$/.test(pec1.codigo), 'código de barras gerado', pec1);
  check((await tri.post(`/lotes/${lote1.id}/itens`, { id: uuid(), categoriaId: catPeca.id, controle: 'ETIQUETADO', quantidade: 2, preco: '10.00', localDestino: 'BAZAR' })).status === 400, 'etiquetada com qtd 2 => 400');
  const itRoupa1 = (await tri.post(`/lotes/${lote1.id}/itens`, { id: uuid(), categoriaId: catRoupa.id, controle: 'CATEGORIA', quantidade: 5, preco: '10.00', localDestino: 'BAZAR' })).data;
  const desc = (await tri.post(`/lotes/${lote1.id}/descartes`, { id: uuid(), categoriaId: catRoupa.id, motivoId: motivoDesc.id })).data;
  check(desc.id && desc.revertido === false, 'descarte item a item');
  check((await tri.post(`/lotes/${lote1.id}/encerrar`)).data.status === 'TRIADO', 'lote encerrado');
  check((await tri.post(`/lotes/${lote1.id}/itens`, { id: uuid(), categoriaId: catRoupa.id, controle: 'CATEGORIA', quantidade: 1, preco: '10.00', localDestino: 'BAZAR' })).data?.code === 'LOTE_TRIADO', 'lote triado não aceita item');
  await tri.post(`/lotes/${lote2.id}/itens`, { id: uuid(), categoriaId: catRoupa.id, controle: 'CATEGORIA', quantidade: 10, preco: '10.00', localDestino: 'BAZAR' });
  const det = (await tri.get(`/lotes/${lote1.id}`)).data;
  check(det.aprovados === 8 && det.descartados === 1 && det.valorAtribuido === '190.00', 'resumo do lote', det);
  const et = (await tri.get(`/etiquetas?itens=${pec1.id},${pec2.id}`)).data;
  check(et.length === 2, 'etiquetas');
  const pdf = new FormData(); pdf.append('arquivo', new Blob([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')], { type: 'application/pdf' }), 'termo.pdf');
  check((await tri.req('POST', `/lotes/${lote1.id}/documento`, undefined, { form: pdf })).status === 204, 'anexo PDF aceito');
  const falso = new FormData(); falso.append('arquivo', new Blob(['<script>alert(1)</script>'], { type: 'application/pdf' }), 'x.pdf');
  check((await tri.req('POST', `/lotes/${lote1.id}/documento`, undefined, { form: falso })).status === 415, 'anexo com tipo real falso => 415');
  check((await tri.get(`/lotes/${lote1.id}/documento`)).status === 200, 'download do anexo');

  console.log('EST — estoque');
  const est = (await caixa.get(`/estoque?categoriaId=${catRoupa.id}`)).data;
  check(est.total === 2 && est.items.reduce((s: number, i: any) => s + i.saldoBazar, 0) === 15, 'estoque por categoria', est);
  const tid = uuid();
  check((await tri.post('/transferencias', { id: tid, itemId: itRoupa1.id, quantidade: 2, origem: 'BAZAR', destino: 'DOACOES', motivo: 'Inverno' })).status === 204, 'transferência bazar → doações');
  await tri.post('/transferencias', { id: tid, itemId: itRoupa1.id, quantidade: 2, origem: 'BAZAR', destino: 'DOACOES' });
  let h = (await tri.get(`/itens/${itRoupa1.id}/historico`)).data;
  check(h.item.saldoBazar === 3 && h.item.saldoDoacoes === 2, 'transferência idempotente (reenvio não duplica)', h.item);
  check((await tri.post('/transferencias', { id: uuid(), itemId: itRoupa1.id, quantidade: 99, origem: 'BAZAR', destino: 'DOACOES' })).data?.code === 'SALDO_INSUFICIENTE', 'saldo nunca negativo (banco)');
  check((await tri.post('/baixas', { id: uuid(), itemId: itRoupa1.id, quantidade: 1, local: 'DOACOES', motivoId: motivoBaixa.id })).status === 403, 'triagem não dá baixa');
  check((await admin.post('/baixas', { id: uuid(), itemId: itRoupa1.id, quantidade: 1, local: 'DOACOES', motivoId: motivoBaixa.id })).status === 204, 'baixa com motivo');
  check((await admin.post('/ajustes', { id: uuid(), itemId: itRoupa1.id, local: 'BAZAR', tipo: 'AJUSTE_ENTRADA', quantidade: 1, motivo: 'Contagem física' })).status === 204, 'ajuste de inventário');
  check((await admin.patch(`/itens/${pec2.id}/preco`, { preco: '55.00', motivo: 'Reajuste de vitrine' })).status === 204, 'preço da peça');
  h = (await tri.get(`/itens/${itRoupa1.id}/historico`)).data;
  check(h.item.saldoBazar === 4 && h.item.saldoDoacoes === 1 && h.eventos.length >= 5, 'histórico do item', h);

  console.log('PDV/CXA — caixa e venda online');
  const cxId = uuid();
  const cx = (await caixa.post('/caixas', { id: cxId, terminalId: term1.id, fundoTroco: '50.00' })).data;
  check(cx.status === 'ABERTO', 'caixa aberto', cx);
  check((await admin.post('/caixas', { id: uuid(), terminalId: term1.id, fundoTroco: '0.00' })).data?.code === 'CAIXA_JA_ABERTO', 'um caixa por terminal (RN-13)');
  check((await caixa.get('/caixas/atual')).data.id === cxId, 'caixa atual');
  const cat = await caixa.req('GET', '/pdv/catalogo');
  check(cat.status === 200 && cat.data.itensEtiquetados.length === 2 && cat.data.clientesFiado.length === 1, 'catálogo do PDV', cat.data);
  check((await caixa.req('GET', '/pdv/catalogo', undefined, { headers: { 'if-none-match': cat.headers.get('etag')! } })).status === 304, 'catálogo 304 com ETag');
  const base = { terminalId: term1.id, caixaId: cxId, ocorridaEm: new Date().toISOString(), origem: 'ONLINE' };
  const v1 = uuid();
  const r1 = await caixa.put(`/vendas/${v1}`, { ...base, itens: [{ codigo: pec1.codigo, quantidade: 1 }, { categoriaId: catRoupa.id, quantidade: 6 }], pagamentos: [{ forma: 'DINHEIRO', valor: '95.00', valorRecebido: '100.00' }] });
  check(r1.status === 201 && r1.data.total === '95.00' && r1.data.troco === '5.00', 'venda online com troco', r1.data);
  const lotes = r1.data.itens.filter((i: any) => i.descricao === 'Roupa adulto').map((i: any) => `${i.loteNumero}:${i.quantidade}`).sort().join(',');
  check(lotes === `${lote1.numero}:4,${lote2.numero}:2`, `PEPS: lote mais antigo primeiro (${lotes})`);
  const r1b = await caixa.put(`/vendas/${v1}`, { ...base, itens: [{ codigo: pec1.codigo, quantidade: 1 }], pagamentos: [{ forma: 'DINHEIRO', valor: '35.00' }] });
  check(r1b.status === 200 && r1b.data.numero === r1.data.numero, 'PUT idempotente (mesmo id devolve a venda gravada)');
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: pec1.codigo, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '35.00' }] })).data?.code === 'ITEM_INDISPONIVEL', 'peça já vendida => 409');
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: pec3.codigo, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '45.00' }] })).data?.code === 'ITEM_EM_DOACOES', 'peça no estoque de doações não vende (RN-07)');
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: pec2.codigo, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '1.00' }] })).data?.code === 'PAGAMENTO_DIVERGENTE', 'servidor recalcula o total');
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: pec2.codigo, quantidade: 1 }], desconto: '20.00', pagamentos: [{ forma: 'PIX', valor: '35.00' }] })).data?.code === 'DESCONTO_ACIMA_LIMITE', 'desconto acima do limite do perfil');
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, caixaId: uuid(), itens: [{ codigo: pec2.codigo, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '55.00' }] })).status === 409, 'caixa inexistente recusado');
  const vFiado = uuid();
  const rf2 = await caixa.put(`/vendas/${vFiado}`, { ...base, clienteId: cli.id, itens: [{ categoriaId: catRoupa.id, quantidade: 2 }], pagamentos: [{ forma: 'FIADO', valor: '20.00' }], vencimentoFiado: hoje });
  check(rf2.status === 201 && rf2.data.clienteNome === 'Maria Exemplo', 'venda fiada', rf2.data);
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ categoriaId: catRoupa.id, quantidade: 1 }], pagamentos: [{ forma: 'FIADO', valor: '10.00' }] })).data?.code === 'FIADO_SEM_CLIENTE', 'fiado sem cliente (RN-03)');
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ categoriaId: catRoupa.id, quantidade: 999 }], pagamentos: [{ forma: 'PIX', valor: '9990.00' }] })).data?.code === 'SALDO_INSUFICIENTE', 'venda por categoria sem saldo');

  console.log('PDV — sincronização offline');
  const off1 = uuid(), off2 = uuid(), cliOff = uuid();
  const sync = await caixa.post('/sync/lote', {
    clientes: [{ id: cliOff, nome: 'João Offline', telefone: '86900000003', cienciaAviso: true }],
    vendas: [
      { id: off1, ...base, origem: 'OFFLINE', numeroLocal: 'OFF-0001', clienteId: cliOff, itens: [{ categoriaId: catRoupa.id, quantidade: 1 }], pagamentos: [{ forma: 'FIADO', valor: '10.00' }], vencimentoFiado: hoje },
      { id: off2, ...base, origem: 'OFFLINE', numeroLocal: 'OFF-0002', itens: [{ codigo: pec1.codigo, quantidade: 1 }], pagamentos: [{ forma: 'DINHEIRO', valor: '35.00' }] },
    ],
  });
  const res = Object.fromEntries(sync.data.resultados.map((x: any) => [x.id, x.status]));
  check(res[cliOff] === 'GRAVADA' && res[off1] === 'GRAVADA' && res[off2] === 'PENDENCIA', 'sync: cliente antes, venda gravada, conflito vira pendência', sync.data);
  const sync2 = await caixa.post('/sync/lote', { clientes: [], vendas: [{ id: off1, ...base, origem: 'OFFLINE', itens: [{ categoriaId: catRoupa.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '10.00' }] }] });
  check(sync2.data.resultados[0].status === 'JA_EXISTENTE', 'reenvio não duplica (RN-26)');
  const pend = (await admin.get('/pendencias?status=ABERTA')).data;
  check(pend.total === 1 && pend.items[0].codigo === 'ITEM_INDISPONIVEL' && pend.items[0].total === '35.00', 'pendência preservada', pend);

  console.log('CXA/FIN — sangria, recebimento, fechamento');
  check((await caixa.post(`/caixas/${cxId}/lancamentos`, { id: uuid(), tipo: 'SANGRIA', valor: '999.00', motivo: 'Teste' })).data?.code === 'SANGRIA_ACIMA_SALDO', 'sangria acima do dinheiro');
  check((await caixa.post(`/caixas/${cxId}/lancamentos`, { id: uuid(), tipo: 'SUPRIMENTO', valor: '20.00', motivo: 'Reforço de troco' })).status === 204, 'suprimento');
  const cr = (await caixa.get(`/contas-receber?clienteId=${cli.id}`)).data.items[0];
  check(cr.saldo === '20.00' && cr.vendaNumero === rf2.data.numero, 'conta a receber do fiado', cr);
  const rec = (await caixa.post(`/contas-receber/${cr.id}/recebimentos`, { id: uuid(), valor: '8.00', caixaId: cxId })).data;
  check(rec.id && !rec.estornado, 'recebimento parcial no caixa');
  check((await caixa.post(`/contas-receber/${cr.id}/recebimentos`, { id: uuid(), valor: '50.00' })).data?.code === 'RECEBIMENTO_ACIMA_SALDO', 'recebimento acima do saldo');
  const prev = (await caixa.get(`/caixas/${cxId}/previa-fechamento`)).data;
  // 50 fundo + 95 venda dinheiro + 8 fiado recebido + 20 suprimento = 173
  check(prev.esperadoDinheiro === '173.00' && prev.totaisPorForma.FIADO === '30.00', 'prévia RN-19', prev);
  check((await admin.get(`/caixas/${cxId}/previa-fechamento`)).status === 403, 'prévia de caixa alheio => 403 (anti-IDOR)');
  check((await caixa.post(`/caixas/${cxId}/fechar`, { contado: '170.00' })).data?.code === 'OBSERVACAO_OBRIGATORIA', 'diferença exige observação');
  const fech = (await caixa.post(`/caixas/${cxId}/fechar`, { contado: '170.00', observacao: 'Faltou troco de moedas' })).data;
  check(fech.status === 'FECHADO' && fech.diferenca === '-3.00', 'caixa fechado com diferença', fech);
  check((await caixa.put(`/vendas/${uuid()}`, { ...base, itens: [{ codigo: pec2.codigo, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '55.00' }] })).data?.code === 'CAIXA_FECHADO', 'venda com caixa fechado (RN-12)');

  console.log('PDV — cancelamento e estornos (admin)');
  check((await admin.post(`/vendas/${vFiado}/cancelar`, { motivo: 'Cliente desistiu' })).data?.code === 'FIADO_COM_RECEBIMENTO', 'cancelar fiado com recebimento ativo => 409');
  check((await admin.post(`/recebimentos/${rec.id}/estornar`, { motivo: 'Lançado errado' })).data?.code === 'SEM_CAIXA_ABERTO', 'estorno de dinheiro de caixa fechado exige caixa aberto');
  const cxAdm = uuid();
  await admin.post('/caixas', { id: cxAdm, terminalId: term2.id, fundoTroco: '200.00' });
  check((await admin.post(`/recebimentos/${rec.id}/estornar`, { motivo: 'Lançado errado' })).status === 204, 'estorno com sangria no caixa aberto');
  check((await admin.post(`/recebimentos/${rec.id}/estornar`, { motivo: 'De novo aqui' })).data?.code === 'ESTORNO_DUPLICADO', 'estorno só uma vez');
  const canc = await admin.post(`/vendas/${vFiado}/cancelar`, { motivo: 'Cliente desistiu' });
  check(canc.status === 200 && canc.data.status === 'CANCELADA', 'venda fiada cancelada', canc.data);
  check((await caixa.get(`/contas-receber?clienteId=${cli.id}`)).data.items[0].status === 'CANCELADA', 'conta a receber cancelada pelo banco');
  const cv1 = await admin.post(`/vendas/${v1}/cancelar`, { motivo: 'Venda de teste' });
  check(cv1.status === 200, 'venda em dinheiro de caixa fechado cancelada (reembolso por sangria)', cv1.data);
  const prevAdm = (await admin.get(`/caixas/${cxAdm}/previa-fechamento`)).data;
  check(prevAdm.sangrias === '103.00', 'sangrias de estorno (8) e reembolso (95)', prevAdm);
  check((await tri.get(`/itens/${pec1.id}/historico`)).data.item.saldoBazar === 1, 'peça voltou ao bazar pelo estorno');
  // pendência agora pode ser reprocessada: a peça voltou, o caixa original fechou -> usa o caixa aberto do terminal 1? (não há) => 409
  const pr = await admin.post(`/pendencias/${pend.items[0].id}/reprocessar`);
  check(pr.data?.code === 'SEM_CAIXA_ABERTO', 'reprocesso exige caixa aberto no terminal da venda', pr.data);
  const cx3 = uuid(); await caixa.post('/caixas', { id: cx3, terminalId: term1.id, fundoTroco: '0.00' });
  const pr2 = await admin.post(`/pendencias/${pend.items[0].id}/reprocessar`);
  check(pr2.status === 200 && pr2.data.status === 'REPROCESSADA', 'pendência reprocessada após corrigir a causa', pr2.data);
  check((await caixa.get(`/vendas/${off2}/comprovante`)).data.origem === 'OFFLINE', 'venda offline com número oficial');
  check((await tri.get(`/vendas/${off2}/comprovante`)).status === 403, 'triagem não vê comprovante');

  console.log('FIN — contas a pagar e compra');
  const cp = (await admin.post('/contas-pagar', { id: uuid(), descricao: 'Energia (fictícia)', valor: '30.00', vencimento: hoje })).data;
  const pg = (await admin.post(`/contas-pagar/${cp.id}/pagar`, { saiuDoCaixa: true })).data;
  check(pg.status === 'PAGA' && pg.saiuDoCaixa === true, 'conta paga do caixa (sangria automática)', pg);
  check((await admin.patch(`/contas-pagar/${cp.id}`, { valor: '1.00' })).data?.code === 'CONTA_NAO_ABERTA', 'conta paga não é editada (RN-32)');
  check((await admin.post(`/contas-pagar/${cp.id}/cancelar`, { motivo: 'Paguei errado' })).data.status === 'CANCELADA', 'cancelamento de conta paga gera suprimento');
  const compra = await admin.post('/lotes', { id: uuid(), tipo: 'COMPRA', parceiroId: fornecedor.id, valorCompra: '120.00', pago: false, vencimento: hoje });
  check(compra.status === 201 && compra.data.pago === false, 'lote de compra');
  check((await admin.get('/contas-pagar?status=ABERTA')).data.items.some((c: any) => c.valor === '120.00' && c.loteId === compra.data.id), 'compra gera conta a pagar (RN-05)');
  const resumo = (await admin.get(`/financeiro/resumo?de=${hoje}&ate=${hoje}`)).data;
  check(resumo.saidas === '0.00' && typeof resumo.resultado === 'string', 'resumo financeiro', resumo);

  console.log('FIS — regra fiscal versionada');
  const geral = (await admin.get('/regras-fiscais')).data.find((r: any) => r.alvo === 'GERAL');
  check(geral?.situacao === 'ISENTO', 'regra geral isenta (seed)');
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const rt = await admin.post('/regras-fiscais', { alvo: 'CATEGORIA', alvoId: catRoupa.id, situacao: 'TRIBUTADO', aliquota: '18.00', vigenciaInicio: '2026-01-01' });
  check(rt.status === 201, 'regra por categoria');
  const vt = await caixa.put(`/vendas/${uuid()}`, { ...base, caixaId: cx3, itens: [{ categoriaId: catRoupa.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: '10.00' }] });
  check(vt.status === 201, 'venda após regra tributada', vt.data);
  check((await admin.post('/regras-fiscais', { alvo: 'CATEGORIA', alvoId: catRoupa.id, situacao: 'ISENTO', aliquota: '0.00', vigenciaInicio: '2025-01-01' })).data?.code === 'VIGENCIA_SOBREPOSTA', 'vigência não sobrepõe');
  check((await admin.post('/regras-fiscais', { alvo: 'CATEGORIA', alvoId: catRoupa.id, situacao: 'ISENTO', aliquota: '0.00', vigenciaInicio: amanha })).status === 201, 'nova vigência encerra a anterior');

  console.log('REL — relatórios');
  const pc = (await admin.get(`/relatorios/prestacao-contas?de=2026-01-01&ate=${hoje}&modo=parceiro&formato=json`)).data;
  const linhaParc = pc.linhas.find((x: any) => x.nome === parc.nome);
  check(linhaParc && linhaParc.recebidos === 8 && linhaParc.descartados === 1, 'prestação de contas por parceiro', pc);
  const vr = (await admin.get(`/relatorios/vendas?de=${hoje}&ate=${hoje}&formato=json`)).data;
  check(vr.linhas.length >= 3 && Number(vr.totais.imposto) > 0, 'relatório de vendas com imposto', vr.totais);
  for (const f of ['csv', 'xlsx', 'pdf']) {
    const r = await admin.req('GET', `/relatorios/estoque?de=${hoje}&ate=${hoje}&formato=${f}`);
    check(r.status === 200 && (r.data as ArrayBuffer).byteLength > 50, `exportação ${f}`);
  }
  for (const t of ['descartes', 'transferencias', 'fiado']) check((await admin.get(`/relatorios/${t}?de=2026-01-01&ate=${hoje}`)).status === 200, `relatório ${t}`);

  console.log('PRV/ADM');
  const exp = await admin.req('GET', `/titulares/cliente/${cliOff}/exportar`);
  check(exp.status === 200, 'exportação dos dados do titular');
  check((await admin.post(`/titulares/cliente/${cliOff}/anonimizar`, { motivo: 'Pedido do titular' })).data?.code === 'CLIENTE_COM_DEBITO', 'anonimizar com débito pede confirmação');
  check((await admin.post(`/titulares/cliente/${cliOff}/anonimizar`, { motivo: 'Pedido do titular', confirmar: true })).status === 204, 'anonimização');
  check((await caixa.post('/clientes/busca', { termo: 'João' })).data.length === 0, 'anonimizado some da busca');
  const params = (await admin.put('/parametros', { valores: [{ chave: 'fiado.prazo_dias', valor: '30' }] })).data;
  check(params.find((p: any) => p.chave === 'fiado.prazo_dias').valor === '30', 'parâmetros');
  check((await admin.put('/parametros', { valores: [{ chave: 'senha.tamanho_minimo', valor: '3' }] })).status === 400, 'parâmetro fora da faixa');
  const aud = (await admin.get('/auditoria?pageSize=100')).data;
  check(aud.total > 20 && !JSON.stringify(aud).includes('Maria'), 'auditoria sem PII', aud.total);
  check((await admin.get('/rota-que-nao-existe')).status === 404, '404 em RFC 9457');

  console.log(`\n${oks} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
