# Bazar Luz da Esperança — Back-end

API do Sistema de Bazar (monolito **Fastify 5 + TypeScript estrito + Prisma 7 + PostgreSQL**).
Implementa os contratos que o front-end já consome (`bazar-frontend/src/api` e a API simulada em `src/mocks/server.ts`)
sobre o modelo do **doc 04 — Modelagem do Banco de Dados**, com as regras de negócio do **doc 02** (RN-01 a RN-33).

## Rodar (desenvolvimento)

```bash
npm install                       # roda prisma generate (postinstall)
cp .env.example .env              # preencha JWT_SECRET, URLs e ADMIN_INITIAL_PASSWORD (nunca versionar)
npm run db:deploy                 # aplica prisma/migrations (tabelas + invariantes)
npm run db:seed                   # Administrador inicial (troca de senha no 1º acesso) + regra fiscal geral ISENTO
npm run dev                       # http://localhost:3000/api/v1  ·  /health
```

No front-end: `VITE_USE_MOCK=false` e um proxy do Vite de `/api` para `http://localhost:3000` (mesma origem: o cookie
de refresh é `SameSite=Strict`, `Path=/api/v1/auth`).

Testes ponta a ponta (banco de **teste** vazio + seed, API rodando):

```bash
API_URL=http://localhost:3000/api/v1 ADMIN_INITIAL_PASSWORD=... npm run test:smoke        # 114 verificações
API_URL=http://localhost:3000/api/v1 npm run test:concorrencia                            # dois caixas disputando estoque
npm run typecheck && npm run audit                                                        # 0 erros, 0 vulnerabilidades
```

## Estrutura

```
prisma/
  schema.prisma                 33 tabelas, 18 enums (doc 04 + 2 ajustes, abaixo)
  migrations/0001_inicial       DDL gerada pelo próprio Prisma 7.10 a partir do schema
  migrations/0002_invariantes   CHECKs, triggers, views, índices parciais e dados iniciais (D-07, RNF-20)
  seed.ts                       Administrador inicial + regra fiscal ISENTO
src/
  app.ts                        helmet, CORS restrito, rate limit, multipart, erros RFC 9457, rotas /api/v1
  plugins/auth.ts               AuthN/AuthZ central: TODA rota declara `config.acesso` (sem isso a API não sobe)
  lib/                          env validado, tokens JWT, dinheiro em centavos, datas America/Fortaleza,
                                auditoria sem PII, idempotência, planilhas (CSV/XLSX), erros
  modules/
    acs/  auth, usuários, perfis, permissões, auditoria          cad/  cadastros, clientes, instituição
    ent/  lotes, anexo, triagem, descartes, etiquetas            est/  estoque, histórico, transferência, baixa, ajuste, preço, carga inicial
    pdv/  catálogo, venda, sync offline, pendências, cancelamento cxa/  terminais, caixa, sangria/suprimento, fechamento
    fin/  contas a pagar/receber, recebimentos, estornos, resumo fis/  regras fiscais versionadas
    rel/  relatórios JSON/PDF/CSV/XLSX                           adm/  parâmetros, importação, LGPD (exportar/anonimizar)
tests/smoke.ts, tests/concorrencia.ts
```

## Rotas (todas sob `/api/v1`)

| Módulo | Rotas | Permissão |
|---|---|---|
| ACS | `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `PUT /auth/senha` · `GET /me` | pública / autenticado |
| ACS | `GET,POST /usuarios` · `PATCH /usuarios/:id` · `POST /usuarios/:id/redefinir-senha` | usuarios.gerenciar |
| ACS | `GET /perfis` · `GET /permissoes` · `POST /perfis` · `PATCH /perfis/:id` · `GET /auditoria` | perfis.gerenciar / auditoria.consultar |
| CAD | `GET,POST,PATCH /{categorias,parceiros,campanhas,motivos-descarte,motivos-baixa,categorias-despesa}` | leitura ampla / cadastros.gerenciar |
| CAD | `POST /clientes/busca` · `GET,POST /clientes` · `PATCH /clientes/:id` · `GET,PUT /instituicao` | clientes.gerenciar, caixa.operar… |
| ENT/TRI | `GET,POST /lotes` · `GET /lotes/:id` · `POST,GET /lotes/:id/documento` · `POST /lotes/:id/{itens,descartes,encerrar,reabrir}` · `POST /descartes/:id/reverter` · `GET /etiquetas` | entrada.registrar / triagem.reabrir |
| EST | `GET /estoque` · `GET /itens/codigo/:codigo` · `GET /itens/:id/historico` · `POST /transferencias` · `POST /baixas` · `POST /ajustes` · `PATCH /itens/:id/preco` · `PATCH /categorias/:id/preco` · `POST /carga-inicial` | estoque.* |
| PDV | `GET /pdv/catalogo` (ETag) · `PUT /vendas/:id` · `POST /sync/lote` · `GET /vendas` · `GET /vendas/:id/comprovante` · `POST /vendas/:id/cancelar` | caixa.operar / venda.cancelar |
| PDV | `GET /pendencias` · `POST /pendencias/:id/{reprocessar,descartar}` | sincronizacao.resolver |
| CXA | `GET,POST /terminais` · `PATCH /terminais/:id` · `GET /caixas/atual` · `POST /caixas` · `POST /caixas/:id/lancamentos` · `GET /caixas/:id/previa-fechamento` · `POST /caixas/:id/fechar` · `GET /caixas` | terminais.gerenciar / caixa.operar / relatorios.consultar |
| FIN | `GET,POST /contas-pagar` · `PATCH /contas-pagar/:id` · `POST /contas-pagar/:id/{pagar,cancelar}` · `GET,POST /contas-receber` · `POST /contas-receber/:id/recebimentos` · `POST /recebimentos/:id/estornar` · `GET /clientes/:id/extrato` · `GET /financeiro/resumo` | contas_* / recebimento.estornar / relatorios.consultar |
| FIS | `GET,POST /regras-fiscais` | fiscal.gerenciar |
| REL | `GET /relatorios/{prestacao-contas,vendas,estoque,descartes,transferencias,fiado}?formato=json\|pdf\|csv\|xlsx` | relatorios.consultar |
| ADM/PRV | `GET,PUT /parametros` · `POST /importacoes/:tipo` · `GET /titulares/:tipo/:id/exportar` · `POST /titulares/:tipo/:id/anonimizar` | parametros / cadastros / privacidade |

## Regras de negócio onde moram

| Regra | API | Banco (0002_invariantes) |
|---|---|---|
| RN-03 fiado com cliente e conta | `vendas.service.ts` | `tg_valida_venda_completa` (no COMMIT) |
| RN-04/05 origem do lote; compra gera conta a pagar | `lotes.routes.ts` | `ck_lote_origem`, `tg_compra_exige_conta` |
| RN-06/07/10 saldo nunca negativo, só vende do bazar | trava `FOR UPDATE` | `tg_valida_movimentacao` |
| RN-08/30 etiquetada qtd 1 e só pelo código | validação | `ck_item_etiquetado`, `tg_valida_venda_item` |
| RN-09 PEPS com desempate fixo | `alocarCategoria()` (trava na ordem do PEPS, relê saldo, tenta 2×) | — |
| RN-11/24 nada se apaga | sem DELETE na API | `fn_bloqueia_alteracao`, `fn_bloqueia_exclusao` |
| RN-12/13 caixa aberto; 1 por terminal e por operador | `processarVenda`, `POST /caixas` | `ux_caixa_aberto_*`, `tg_valida_venda_caixa` |
| RN-14 cancelamento com estorno automático | reembolso por sangria se o caixa da venda fechou | `tg_valida_alteracao_venda`, `tg_estorna_venda_cancelada` |
| RN-15 pagamentos = total; troco só em dinheiro | servidor recalcula tudo | `ck_pagamento_*`, `ck_venda_totais` |
| RN-17 regra fiscal versionada, cópia na venda | `fiscal.service.ts` | `tg_valida_regra_fiscal`, `ux_regra_vigente` |
| RN-19 fechamento | `calcularPrevia()` | `ck_caixa_fechamento` |
| RN-26 offline sem perder nem duplicar | id do terminal = chave; recusa vira pendência | PK da venda, `pendencia(tipo, referencia_id)` único |
| RN-27 recebimento/estorno | sangria se o caixa do recebimento fechou | `tg_valida_recebimento`, recálculo do status |
| RN-28 lote triado fechado | | `tg_lote_aberto_item` / `_descarte` |
| RN-29 auditoria sem PII | `lib/audit.ts` remove campos pessoais | `auditoria` só inclusão |
| RN-31 datas | filtros por dia em America/Fortaleza; online = hora do servidor, offline = hora do terminal (com limites) | baixa usa `venda.ocorrida_em` |

## Segurança (baseline OWASP ASVS L2 / API Top 10)

| Controle | Onde |
|---|---|
| JWT HS256 com **algoritmo fixado**, `exp` 15 min, `iss`/`aud` validados; `alg=none` e assinatura adulterada recusados (testado) | `lib/tokens.ts` |
| Sessão no PostgreSQL (RNF-17): refresh opaco de 256 bits, só o hash SHA-256 no banco, cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` | `acs/auth.routes.ts` |
| Rotação do refresh + **detecção de reuso** (revoga todas as sessões do usuário); inatividade = parâmetro `sessao.timeout_min`, teto `SESSION_MAX_HOURS` | idem |
| Toda requisição confere sessão não revogada e usuário ativo: logout, troca/redefinição de senha e desativação valem na hora | `plugins/auth.ts` |
| AuthZ no servidor por permissão em **todas** as rotas; rota sem `config.acesso` impede a subida (fail secure) | `plugins/auth.ts` |
| Anti-IDOR: `caixaId`/`terminalId` conferidos contra o operador; comprovante/listagem de venda alheia → 404 | `pdv`, `cxa`, `fin` |
| Senha argon2id; bloqueio 10 min após 5 erros + rate limit 10/min nas rotas `/auth/*`; mensagem genérica e tempo constante | `acs/` |
| Senha provisória com troca obrigatória (servidor bloqueia o resto com `TROCA_SENHA_OBRIGATORIA`) | `plugins/auth.ts` |
| Validação de entrada com Zod (`strict` nos PATCH, lista branca de campos — sem mass assignment) | todos os módulos |
| SQL sempre parametrizado (Prisma / `Prisma.sql`); o único `$queryRawUnsafe` interpola só nomes de coluna fixos | `rel/` |
| Upload: tamanho por parâmetro, **tipo real por magic bytes**, nome aleatório, `0600`, download com `Content-Disposition` e anti path traversal | `ent/lotes.routes.ts` |
| CSV/XLSX: proteção contra injeção de fórmula | `lib/planilha.ts` |
| Helmet (CSP `default-src 'none'`, HSTS, nosniff, `frame-ancestors 'none'`), CORS por lista (nunca `*`), `Cache-Control: no-store` | `app.ts` |
| Erros RFC 9457 com `requestId`, sem stack; logs pino sem token/cookie/PII (`redact`) | `app.ts`, `lib/errors.ts` |
| Segredos só por ambiente, validados na subida; produção recusa `COOKIE_SECURE=false` | `config/env.ts` |
| Menor privilégio no banco: API com papel **sem DELETE** (comandos no fim de `0002_invariantes`) | migração |
| `npm audit`: 0 vulnerabilidades (overrides em dependências transitivas de dev: `mysql2`, `deepmerge-ts`, `uuid`) | `package.json` |

**Produção:** atrás de proxy com TLS (defina `TRUST_PROXY=true` para o rate limit ver o IP real); segredos pelo
Azure Key Vault ou Google Secret Manager; `UPLOAD_DIR` em volume com backup (RNF-10/18); papel `bazar_api` sem DELETE.

## Divergências e decisões (validar com PO/front)

1. **Permissão de desconto:** o front usa `venda.desconto_autorizar`; o doc 02 chama `desconto.autorizar`. Mantido o código do front.
2. **Status traduzidos no contrato:** lote `AGUARDANDO_TRIAGEM`/`EM_TRIAGEM` → `ABERTO`; venda `FINALIZADA` → `CONCLUIDA`; pendência `PENDENTE/RESOLVIDA` → `ABERTA/REPROCESSADA`. O banco segue o doc 04.
3. **`instituicao.endereco`** adicionada (o front envia endereço). **`idempotencia`**: tabela técnica para reenvio de transferência/baixa/ajuste.
4. **Venda online usa a hora do servidor**; `origem=OFFLINE` usa a hora do terminal, recusando hora futura (> 5 min) ou anterior à abertura do caixa.
5. **Item por categoria é vendido pelo preço padrão ATUAL da categoria** (RN-08); `preco` em `ItemEstoque` reflete isso.
6. **Reprocessar pendência:** se o caixa original já fechou, a venda entra no caixa aberto do mesmo terminal (caixa fechado não reabre); sem caixa aberto → `409 SEM_CAIXA_ABERTO`.
7. **Reverter descarte** reabre o lote (EM_TRIAGEM) para a nova triagem (RN-20); o item pode informar `descarteOrigemId` (opcional).
8. **Campos opcionais extras aceitos** (o front pode ignorar): `valorAtribuido`/`descarteOrigemId` na triagem, `forma` no recebimento (padrão DINHEIRO), `formaPagamento` no pagamento de conta e no lote de compra pago (padrão PIX), `fiadoPrazoDias` no catálogo.
9. **`fiado.prazo_dias`** vem vazio (PA-07): sem ele o PDV precisa mandar `vencimentoFiado`.
10. **`filaPendente`** na prévia = pendências abertas do terminal no servidor (a fila local é do aparelho).
11. **`GET /instituicao`** também liberado a `caixa.operar` (dados do comprovante, RF-PDV-08).

## Pendências conhecidas

- Bloqueio por tentativas de login fica em memória do processo; com mais de uma instância, trocar por store compartilhado (Redis, previsto no doc 04).
- Autorização de desconto por supervisor no ato (PA-08) e devolução parcial (PA-14) não implementadas (dependem das decisões).
- Prisma 7 emite um aviso de depreciação do `pg` (consultas paralelas internas numa transação) — interno da biblioteca, sem efeito funcional.
- Ao rodar `prisma migrate dev` no futuro, confira se o diff não propõe remover objetos da `0002_invariantes`/`0003` (índices parciais/expressões como `ix_saldo_positivo_local`, que o schema não descreve); se propuser, apague essas linhas da migração gerada.

## Banco de dados — revisão de DBA (0003, 01/10/2026)

- `0003_dba_integridade_desempenho`: 19 FKs de autoria → `usuario`, saldo materializado `saldo_estoque` (mantido pelo trigger de movimentação; `vw_saldo_estoque` mantém as mesmas colunas — nada em `src/` mudou), `vw_prestacao_contas_lote` reescrita, 12 índices guiados pelas consultas da API, CHECKs de formato e de anonimização (LGPD).
- Scripts avulsos em `db/` (DDL completa, DML de referência, papéis de menor privilégio, testes, carga de volume, benchmark, manutenção) — ver `db/README.md`.
- Papéis: rode `db/03_seguranca_papeis.sql` depois de cada `migrate deploy` (re-aplica GRANTs e o REVOKE de escrita em `saldo_estoque`).
- Ambiente desta entrega: a DDL foi gerada pelo motor do próprio Prisma 7.10 e as duas migrações foram aplicadas num PostgreSQL 16 real; o `prisma migrate deploy` (binário nativo) precisa de acesso a `binaries.prisma.sh` na primeira execução.
