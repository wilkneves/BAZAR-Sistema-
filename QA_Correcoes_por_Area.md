# QA — Correções por área (Sistema de Bazar · Luz da Esperança)

**Data:** 01/10/2026
**Veredito:** **[REPROVADO]**

Front-end, back-end e banco se comunicam corretamente. O que reprova são cenários de aceite que falham e um defeito que impede o caixa de bater no piloto.

| Área | Quantidade de correções |
|---|---|
| Front-end | 7 |
| Back-end | 5 |
| DBA | 0 (o banco passou em todos os testes) |
f
---

## Resumo

### Front-end

| # | Erro | Prioridade |
|---|---|---|
| 1 | Recebimento de fiado sem forma de pagamento (o back grava sempre DINHEIRO); pagamento de conta fora do caixa vira sempre PIX | **Alta** |
| 2 | Comprovante sem nome e CNPJ da instituição | Alta |
| 6 | Valor atribuído não editável na triagem; lote de compra não usa o custo unitário | Alta |
| 9 | PDV não reabre sem internet depois de recarregar a página | Alta |
| 5 | Cadastro de parceiro sem os campos tipo e CPF/CNPJ | Média |
| 8 | Tela de relatórios sem filtro por parceiro e sem agrupamento (depende do nº 7) | Média |
| 12 | Sem aviso de telefone já cadastrado | Baixa |

### Back-end

| # | Erro | Prioridade |
|---|---|---|
| 3 | Aceita categoria "vende por categoria" sem preço (pela API e pela importação) | Alta |
| 7 | Relatório de vendas sem totais agrupados; relatório de descartes sem filtro por parceiro e sem soma por motivo | Alta |
| 4 | CPF/CNPJ aceito sem conferir o dígito verificador | Média |
| 11 | Carga inicial recusa "Doações" escrito com acento | Média |
| 10 | Salvar o parceiro "Doador não identificado" sempre dá erro 409 | Baixa |

### Ordem sugerida
1. **Nº 1:** impede o caixa de bater, que é a meta do piloto.
2. **Nº 2, 3, 6 e 9:** cenários de aceite que falham hoje.
3. **Nº 7** (back) e, em seguida, **nº 8** (front).
4. As demais.

---

## Tickets — Front-end

### Ticket 1 — Recebimento de fiado sempre gravado como DINHEIRO
- **[AGENTE CULPADO]:** Front-end
- **[DESCRIÇÃO DO ERRO]:** `ContasReceberPage.tsx:75` envia `{ id, valor, caixaId }` sem `forma`, e o back assume `DINHEIRO`. Um fiado recebido por PIX ou cartão no caixa entra no dinheiro esperado e o fechamento mostra uma sobra que não existe. Em `ContasPagarPage.tsx:88`, todo pagamento feito fora do caixa é gravado como `PIX` (RF-FIN-02, cenário 1).
- **[COMO CORRIGIR]:** Em `api/modules/financeiro.ts`, incluir `forma` em `receber` e `formaPagamento` em `pagar`. Nos dois modais, adicionar um seletor obrigatório de forma de pagamento, com Dinheiro como padrão. Quando "saiu do caixa" estiver marcado, fixar DINHEIRO. O back já aceita os dois campos.

### Ticket 2 — Comprovante sem dados da instituição
- **[AGENTE CULPADO]:** Front-end
- **[DESCRIÇÃO DO ERRO]:** `ComprovanteModal.tsx:15` tem o nome "Bazar Luz da Esperança" fixo no código e não mostra o CNPJ, então RF-CAD-07 e RF-PDV-08 falham. O back já libera `GET /instituicao` para quem tem `caixa.operar`, mas o front não chama.
- **[COMO CORRIGIR]:** Em `usePdvSessao`, com internet, buscar `instituicaoApi.obter()` e guardar o resultado em `KV.instituicao`. Exibir nome e CNPJ no comprovante e na reimpressão (`VendasPage`). Sem internet, usar a cópia guardada.

### Ticket 5 — Formulário de parceiro sem tipo e documento
- **[AGENTE CULPADO]:** Front-end
- **[DESCRIÇÃO DO ERRO]:** `CadastrosPage.tsx:23` só envia `nome`. Todo parceiro é gravado como `OUTRO` e não há onde informar CPF ou CNPJ (RF-CAD-02, cenário 1).
- **[COMO CORRIGIR]:** Em `CONFIG.parceiros`, incluir o campo `tipo` (lista com EMPRESA, LOJA, PESSOA_FISICA e OUTRO) e o campo `documento` (opcional, só dígitos). Mostrar o erro por campo que o back devolver.

### Ticket 6 — Valor atribuído não editável na triagem
- **[AGENTE CULPADO]:** Front-end
- **[DESCRIÇÃO DO ERRO]:** `TriagemPage.tsx:134` nunca envia `valorAtribuido`, e o back usa o preço de venda no lugar. No lote de compra, o valor atribuído deveria ser o custo unitário (RF-TRI-01, cenário 5). Com isso, a prestação de contas por doador e por compra sai errada.
- **[COMO CORRIGIR]:** Adicionar `valorAtribuido?: Money` em `TriagemItemRequest` (`types.ts`). No `FormAprovar`, incluir o campo "Valor atribuído (unitário)": no lote de doação, ele já vem preenchido com o preço; no lote de compra, é obrigatório.

### Ticket 8 — Tela de relatórios sem os novos filtros
- **[AGENTE CULPADO]:** Front-end
- **[DESCRIÇÃO DO ERRO]:** Depende do Ticket 7. `RelatoriosPage.tsx` só envia `de`, `ate` e `modo`.
- **[COMO CORRIGIR]:** Incluir `agrupar`, `parceiroId` e `campanhaId` em `FiltroRelatorio` (`relatorios.ts`) e criar os seletores correspondentes nas abas Vendas e Descartes.

### Ticket 9 — PDV não reabre sem internet depois de recarregar a página
- **[AGENTE CULPADO]:** Front-end
- **[DESCRIÇÃO DO ERRO]:** Em `AuthContext.tsx:37`, um F5, uma queda de energia ou o fechamento da aba sem rede faz o refresh do token falhar com `NetworkError`. O sistema leva para `/login`, que exige internet, e o PDV para. O carrinho e a fila de vendas ficam presos no IndexedDB (RF-PDV-10, prioridade Must, e RNF-05).
- **[COMO CORRIGIR]:**
  1. No login online, salvar no IndexedDB um resumo do operador: id, nome, permissões, limite de desconto e data de gravação. Nunca salvar o token.
  2. Ao abrir o sistema, se der `NetworkError` e existirem `KV.caixaAtual` e um resumo do mesmo operador gravado dentro do prazo do parâmetro `pdv.max_horas_sem_sync`, liberar só a rota `/pdv`.
  3. Ao reconectar, exigir refresh ou novo login antes de sincronizar.

### Ticket 12 — Sem aviso de telefone já cadastrado
- **[AGENTE CULPADO]:** Front-end
- **[DESCRIÇÃO DO ERRO]:** RF-CAD-04, cenário 3. O cadastro rápido do PDV (`PagamentoModal.tsx`) e o da tela de cadastros não avisam quando o telefone já existe.
- **[COMO CORRIGIR]:** Antes de criar o cliente, buscar pelos dígitos com `clientesApi.buscar(digitos)`; sem internet, procurar em `catalogo.clientesFiado`. Se encontrar, perguntar se é a mesma pessoa e oferecer "Usar existente" ou "Cadastrar mesmo assim", sem bloquear.

---

## Tickets — Back-end

### Ticket 3 — Categoria "vende por categoria" aceita sem preço
- **[AGENTE CULPADO]:** Back-end
- **[DESCRIÇÃO DO ERRO]:** RF-CAD-01, cenário 2. `POST /categorias` com `{vendaPorCategoria:true}` e sem `precoPadrao` retorna 201. A importação (`admin.routes.ts:92`) também aceita. A categoria aparece no PDV a R$ 0,00 e a venda falha.
- **[COMO CORRIGIR]:** Em `cadastros.routes.ts`, aplicar `superRefine` no criar e no atualizar: se `vendaPorCategoria` (o valor novo ou o atual) for verdadeiro, exigir `precoPadrao > 0`. Caso contrário, devolver 400 `VALIDACAO` no campo `precoPadrao`. Na importação, registrar o erro por linha.

### Ticket 4 — CPF/CNPJ sem dígito verificador
- **[AGENTE CULPADO]:** Back-end
- **[DESCRIÇÃO DO ERRO]:** `cadastros.routes.ts:60` só confere a quantidade de dígitos. O documento `11111111111111` foi aceito (RF-CAD-02, cenário 2).
- **[COMO CORRIGIR]:** Criar `lib/documento.ts` com `cpfValido` e `cnpjValido` (módulo 11, recusando sequências repetidas) e aplicar via `.refine` em `zParceiro.documento`.

### Ticket 7 — Relatórios de vendas e de descartes incompletos
- **[AGENTE CULPADO]:** Back-end
- **[DESCRIÇÃO DO ERRO]:**
  - RF-REL-02: `vendas()` (`relatorios.routes.ts:113`) só lista as vendas uma a uma, sem totais por dia, forma, categoria e operador. As canceladas não aparecem separadas.
  - RF-REL-04: `descartesRel()` (`:168`) não filtra por parceiro e não soma por motivo.
- **[COMO CORRIGIR]:** Manter o formato de resposta `RelatorioResposta` e adicionar ao `zFiltro` os campos `agrupar` (`dia|forma|categoria|operador|motivo`), `parceiroId?` e `campanhaId?`. As canceladas saem em bloco próprio. A exportação em PDF, CSV e XLSX usa o mesmo filtro.

### Ticket 10 — Parceiro "Doador não identificado" não pode ser editado
- **[AGENTE CULPADO]:** Back-end
- **[DESCRIÇÃO DO ERRO]:** `cadastros.routes.ts:77` recusa qualquer PATCH que contenha `nome`, mesmo que o nome não mude. Como o front sempre envia o nome, salvar esse parceiro dá sempre 409 `PARCEIRO_ESPECIAL`.
- **[COMO CORRIGIR]:** Trocar a condição para `b.nome && b.nome !== atual.nome`.

### Ticket 11 — Carga inicial recusa "Doações" com acento
- **[AGENTE CULPADO]:** Back-end
- **[DESCRIÇÃO DO ERRO]:** `estoque.routes.ts:225` transforma "Doações" em "DOAÇOES" e recusa a linha. Isso atrapalha o passo 1 do roteiro do piloto.
- **[COMO CORRIGIR]:** Normalizar o texto com `.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()` antes de comparar com BAZAR e DOACOES. Usar a mesma normalização na coluna `controle`.

---

## DBA
Nenhuma correção. As migrações 0001 a 0003 dão exatamente o mesmo esquema do `01_ddl_completo.sql`, os 28 testes de regra do banco passaram e a conferência de saldo e prestação de contas não encontrou divergência.

---

## Fora dos tickets (prioridade Could, dependem de pendências abertas)
- **RF-PDV-06:** autorização de desconto acima do limite por um Administrador (depende da PA-08).
- **RF-PDV-11:** devolução de venda (depende da PA-14).

## Recomendações de LGPD (não reprovam)
- O catálogo do PDV copia nome e telefone de **todos** os clientes ativos para cada terminal. Recomendo limitar aos clientes com fiado recente.
- O motivo da anonimização é texto livre e vai para a auditoria. Recomendo orientar na tela para não digitar dados pessoais nesse campo.
