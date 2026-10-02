import { randomUUID as uuid } from 'node:crypto';
// Rodar DEPOIS do smoke (usa os dados criados por ele). Dois caixas disputando o mesmo estoque.
const B = process.env.API_URL ?? 'http://127.0.0.1:3999/api/v1';
async function login(l: string, s: string) { const r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, senha: s }) }); return (await r.json()).accessToken as string; }
const j = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const adm = await login('admin', 'Nova-Senha-Forte-1');
const cx = await login('caixa1', 'Caixa-Senha-2026');
// segundo operador e terminal
const perfis = await (await fetch(B + '/perfis', { headers: j(adm) })).json();
const pc = perfis.find((p: any) => p.nome === 'Caixa');
const u2 = await (await fetch(B + '/usuarios', { method: 'POST', headers: j(adm), body: JSON.stringify({ id: uuid(), nome: 'Op2', login: 'caixa2', perfilId: pc.id }) })).json();
let t2 = await login('caixa2', u2.senhaProvisoria);
await fetch(B + '/auth/senha', { method: 'PUT', headers: j(t2), body: JSON.stringify({ senhaAtual: u2.senhaProvisoria, novaSenha: 'Outra-Senha-Forte-77' }) });
t2 = await login('caixa2', 'Outra-Senha-Forte-77');
const term3 = await (await fetch(B + '/terminais', { method: 'POST', headers: j(adm), body: JSON.stringify({ id: uuid(), nome: 'Caixa 3' }) })).json();
const cx2id = uuid();
await fetch(B + '/caixas', { method: 'POST', headers: j(t2), body: JSON.stringify({ id: cx2id, terminalId: term3.id, fundoTroco: '0.00' }) });
const atual1 = await (await fetch(B + '/caixas/atual', { headers: j(cx) })).json();
const cats = await (await fetch(B + '/categorias', { headers: j(adm) })).json();
const roupa = cats.find((c: any) => c.nome === 'Roupa adulto');
const est = await (await fetch(B + `/estoque?categoriaId=${roupa.id}&local=BAZAR`, { headers: j(adm) })).json();
const saldo = est.items.reduce((s: number, i: any) => s + i.saldoBazar, 0);
const cat = await (await fetch(B + '/pdv/catalogo', { headers: j(cx) })).json();
const peca = cat.itensEtiquetados[0];
console.log('saldo roupa bazar', saldo, 'peça', peca.codigo);
const venda = (t: string, caixaId: string, terminalId: string, itens: any[], valor: string) => fetch(B + `/vendas/${uuid()}`, { method: 'PUT', headers: j(t), body: JSON.stringify({ terminalId, caixaId, ocorridaEm: new Date().toISOString(), origem: 'ONLINE', itens, pagamentos: [{ forma: 'PIX', valor }] }) }).then(async (r) => ({ s: r.status, b: await r.json() }));
// 1) mesma peça em 2 caixas simultâneos
const r = await Promise.all([venda(cx, atual1.id, atual1.terminalId, [{ codigo: peca.codigo, quantidade: 1 }], peca.preco), venda(t2, cx2id, term3.id, [{ codigo: peca.codigo, quantidade: 1 }], peca.preco)]);
console.log('peça concorrente:', r.map((x) => x.s + ':' + (x.b.code ?? 'ok')).join(' '));
// 2) categoria: cada caixa tenta levar mais da metade+1 do saldo
const q = Math.floor(saldo / 2) + 1;
const valor = (q * Number(roupa.precoPadrao)).toFixed(2);
const r2 = await Promise.all([venda(cx, atual1.id, atual1.terminalId, [{ categoriaId: roupa.id, quantidade: q }], valor), venda(t2, cx2id, term3.id, [{ categoriaId: roupa.id, quantidade: q }], valor)]);
console.log('categoria concorrente:', r2.map((x) => x.s + ':' + (x.b.code ?? 'ok')).join(' '));
const est2 = await (await fetch(B + `/estoque?categoriaId=${roupa.id}&local=BAZAR`, { headers: j(adm) })).json();
console.log('saldo final >= 0:', est2.items.every((i: any) => i.saldoBazar >= 0), est2.items.reduce((s: number, i: any) => s + i.saldoBazar, 0));
// 3) operador 2 usando o caixa do operador 1 (IDOR)
const r3 = await venda(t2, atual1.id, atual1.terminalId, [{ categoriaId: roupa.id, quantidade: 1 }], roupa.precoPadrao);
console.log('IDOR caixa alheio:', r3.s, r3.b.code);
