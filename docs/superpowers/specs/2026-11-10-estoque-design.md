# Estoque (fase 1) — design

Data: 2026-11-10. Branch: `feat/estoque`. Fora do roteiro 0–9; pedido do usuário depois de verificar que a tela não estava funcional. **Fase 2** (lista de procedimentos da clínica + kits de materiais + baixa automática ao executar tratamento) terá especificação própria.

## Situação hoje

`/estoque` só **lista** `inventory_items` (seed) e mostra o aviso "abaixo do mínimo" (`quantity <= min_quantity`):

- "Gerenciar estoque" não tem ação — não há cadastro, edição nem remoção;
- não há entrada nem saída; a quantidade só muda direto no banco;
- a aba "Histórico" é um texto fixo; a tabela `inventory_movements` existe (`item_id, type in/out, quantity, reason`) mas nada a usa;
- cores de status/aviso fora dos tokens do novo layout.

## Objetivo

Controle real do material da clínica: cadastrar produtos, registrar entradas e saídas com histórico, controlar lote/validade quando importa, levar compras ao Financeiro e saber o que comprar.

Sucesso: a recepção cadastra "Anestésico Lidocaína 2%" (tubetes, mínimo 20, ideal 60, fornecedor "Dental Sul", controla validade); dá entrada de 50 tubetes, lote A23, validade 03/2027, valor R$ 410,00 "a pagar" vencendo dia 20 → aparece "Despesa de R$ 410,00 lançada no Financeiro" e a despesa está em Financeiro → Despesas como "Material odontológico" pendente; uma saída de 10 sai do lote que vence primeiro; tentar tirar 100 é recusado com "Estoque insuficiente"; um lote vencido aparece no aviso e é baixado com um clique; a Lista de compras mostra "Dental Sul: Anestésico Lidocaína 2% — 30 tubetes" e copia o texto para o WhatsApp; o Histórico mostra tudo.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Escopo (fase 1) | Cadastro de produtos, entrada/saída/contagem, histórico, lote e validade, compra → despesa, lista de compras |
| Fase 2 | Baixa por procedimento fica para depois: tratamentos particulares usam texto livre, então precisa antes de uma lista de procedimentos da clínica |
| Despesa da compra | Na entrada com valor, o usuário escolhe **"Já paga"** (forma + data) ou **"A pagar"** (vencimento); a despesa é criada junto |
| Validade | **Opcional por produto** ("Controlar validade"); se ligada, toda entrada pede lote e validade e a saída baixa primeiro o que vence antes |
| Arquitetura | Funções no banco (RPC) fazem cada operação numa transação; rotas da API com `withClinic`, como Prótese/Comissões |

## Fora do escopo

Baixa por procedimento/kits (fase 2), código de barras, várias unidades de medida por produto (caixa × unidade), quantidades fracionadas, inventário por sala/local, pedido automático ao fornecedor, custo médio/valorização do estoque, excluir movimentações.

## Banco — `supabase/2026-11-10-estoque.sql`

Idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`). Rodar depois de `2026-11-10-protese.sql`.

### `inventory_items` (colunas novas)

| coluna | tipo | obs. |
|---|---|---|
| `active` | BOOLEAN NOT NULL DEFAULT true | inativo some da lista e dos avisos |
| `tracks_expiry` | BOOLEAN NOT NULL DEFAULT false | "Controlar validade" |
| `ideal_quantity` | INTEGER NULL CHECK (≥ 0) | alvo da lista de compras |
| `supplier` | TEXT NULL | agrupa a lista de compras |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

- CHECK novos: `quantity >= 0`, `min_quantity >= 0`.
- Índice único `(clinic_id, lower(btrim(name)))`. Antes de criá-lo, a migração renomeia duplicados existentes acrescentando ` (2)`, ` (3)`… para não falhar.
- `quantity` continua sendo o saldo total; só as funções abaixo o alteram (a tela não edita quantidade diretamente; a criação aceita saldo inicial, ver `create_inventory_item`).

### `inventory_lots` (nova)

| coluna | tipo |
|---|---|
| `id` | UUID PK |
| `clinic_id` | UUID NOT NULL → clinics ON DELETE CASCADE |
| `item_id` | UUID NOT NULL → inventory_items ON DELETE CASCADE |
| `lot_code` | TEXT NULL ("Saldo anterior" usa NULL) |
| `expires_at` | DATE NULL |
| `quantity` | INTEGER NOT NULL CHECK (≥ 0) — saldo restante |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |

- Índice `(item_id, expires_at)`; RLS `clinic_member`.
- Lotes só existem para produtos com `tracks_expiry`. Invariante: para esses produtos, `inventory_items.quantity = SUM(inventory_lots.quantity)`.
- Ordem de saída (FEFO): `expires_at ASC NULLS LAST, created_at ASC`.

### `inventory_movements` (colunas novas)

| coluna | tipo | obs. |
|---|---|---|
| `clinic_id` | UUID → clinics ON DELETE CASCADE | preenchida pela migração a partir do produto; depois NOT NULL |
| `kind` | TEXT NULL CHECK (`compra`,`devolucao`,`ajuste`,`uso`,`perda`,`vencido`) | movimentos antigos ficam NULL |
| `lot_id` | UUID NULL → inventory_lots ON DELETE SET NULL | |
| `expense_id` | UUID NULL → expenses ON DELETE SET NULL | |
| `notes` | TEXT NULL | |
| `created_by` | UUID NULL | |

- `type` (`in`/`out`) e `quantity` (sempre > 0) continuam. Uma saída FEFO que atravessa dois lotes grava **um movimento por lote**.
- Índice `(clinic_id, created_at DESC)`, `(item_id, created_at DESC)`.
- RLS: troca a policy atual (via item) pela `clinic_member` por `clinic_id`.

### Funções (SECURITY DEFINER, `search_path = public`, só `service_role`)

Todas travam o produto com `SELECT … FOR UPDATE` filtrando `clinic_id`, e atualizam `updated_at`. Erros (`RAISE EXCEPTION`): `PRODUTO_NAO_ENCONTRADO`, `PRODUTO_INATIVO`, `QUANTIDADE_INVALIDA`, `ESTOQUE_INSUFICIENTE`, `LOTE_INVALIDO`, `LOTE_OBRIGATORIO`, `TIPO_INVALIDO`, `PAGAMENTO_INVALIDO`.

**`create_inventory_item(p_clinic_id, p_user_id, p_data jsonb) → uuid`**
Campos: `name, category, unit, min_quantity, ideal_quantity, supplier, tracks_expiry, initial_quantity, lot_code, expires_at`. Saldo inicial > 0 grava movimento `in/ajuste` com nota "Saldo inicial" (e lote, se controla validade — lote/validade opcionais aqui).

**`update_inventory_item(p_clinic_id, p_id, p_data jsonb) → void`**
Edita nome, categoria, unidade, mínimo, ideal, fornecedor, `active`, `tracks_expiry`.
- Ligar validade com saldo > 0 e sem lotes → cria lote "Saldo anterior" (`lot_code` NULL, `expires_at` NULL) com o saldo.
- Desligar validade → os lotes são apagados (o saldo total permanece em `quantity`; movimentos antigos ficam com `lot_id` NULL).

**`inventory_entry(p_clinic_id, p_user_id, p_item_id, p_quantity, p_kind, p_lot_code, p_expires_at, p_notes, p_total_cost, p_payment jsonb) → jsonb`**
- `p_kind` ∈ `compra|devolucao|ajuste`; `p_quantity` inteiro > 0; produto ativo.
- Produto com validade: `p_expires_at` obrigatório (`LOTE_OBRIGATORIO`); reaproveita o lote com mesmo `lot_code` (sem diferenciar maiúsculas) **e** mesma validade, senão cria um.
- Soma ao lote e ao `quantity`; grava o movimento `in`.
- `p_total_cost > 0` → cria despesa (só se `p_kind = 'compra'`; outros tipos ignoram valor):
  - `description` = `Compra: {produto} — {qtd} {unidade}` (máx. 200), `amount` = custo, `category 'material'`, `deduction_group 'custeio'`, sem `professional_id`;
  - `p_payment.status = 'paid'`: `status 'paid'`, `payment_method` ∈ (`dinheiro`,`cartao_credito`,`cartao_debito`,`pix`,`boleto`), `paid_at` = data informada às 12:00 America/Sao_Paulo, `due_date` = mesma data;
  - `p_payment.status = 'pending'`: `status 'pending'`, `due_date` obrigatória;
  - outro formato → `PAGAMENTO_INVALIDO`.
- Devolve `{ quantity: novo saldo, expense: { id, amount, status } | null }`.

**`inventory_exit(p_clinic_id, p_user_id, p_item_id, p_quantity, p_kind, p_lot_id, p_notes) → jsonb`**
- `p_kind` ∈ `uso|perda|vencido`; quantidade inteira > 0 e ≤ saldo (`ESTOQUE_INSUFICIENTE`).
- Com validade: se `p_lot_id` vier, sai só dele (precisa ter saldo suficiente, senão `ESTOQUE_INSUFICIENTE`; lote de outro produto → `LOTE_INVALIDO`); senão FEFO atravessando lotes. Um movimento por lote tocado.
- Devolve `{ quantity, lotes: [{ lot_id, lot_code, quantidade }] }`.

**`inventory_count(p_clinic_id, p_user_id, p_item_id, p_lot_id, p_counted, p_notes) → jsonb`**
- `p_counted` inteiro ≥ 0. Produto com validade exige `p_lot_id` (contagem por lote); sem validade, `p_lot_id` NULL.
- Diferença ≠ 0 → movimento `in/ajuste` ou `out/ajuste` com a diferença; igual → nada gravado.
- Devolve `{ quantity, diferenca }`.

**`inventory_discard_lot(p_clinic_id, p_user_id, p_lot_id) → jsonb`**
Baixa todo o saldo do lote com `out/vencido`. Devolve `{ quantity, baixado }`.

## Regras puras — `src/lib/estoque/`

- `validade.ts`: `diasParaVencer(expiresAt, hojeYmd)`; `situacaoLote(expiresAt, hojeYmd)` → `'vencido' | 'vence_em_breve' (≤ 30 dias) | 'ok' | 'sem_validade'`; `proximaValidade(lotes)` (menor validade com saldo > 0).
- `fefo.ts`: `ordemFefo(lotes)` e `planoSaida(lotes, quantidade)` → `[{ lotId, quantidade }]` ou `null` se faltar saldo (espelha a função SQL para mostrar na tela de onde vai sair).
- `alertas.ts`: `alertasDoItem(item, lotes, hojeYmd)` → `{ baixo, vencidos, vencendo }`; `baixo` = `quantity <= min_quantity` (regra atual mantida).
- `compras.ts`: `sugestaoCompra(item)` = `max(0, alvo − quantity)` onde `alvo = ideal_quantity ?? 2 × min_quantity` (mínimo 0 → sem sugestão); `listaDeCompras(itens)` agrupa por fornecedor (sem fornecedor → "Sem fornecedor"), ordena por nome; `textoListaCompras(grupos, clinica)` → texto para WhatsApp:
  ```
  Lista de compras — {clínica} — {dd/MM/yyyy}

  *Dental Sul*
  • Anestésico Lidocaína 2% — 30 tubetes
  ```
- `validar.ts`: corpos de produto, entrada, saída, contagem (mensagens em português; nome até 80; categoria/unidade até 40; fornecedor até 80; observação até 500; lote até 40; quantidades inteiras; custo em centavos inteiro 0 < c ≤ 9 999 999 999; datas `YYYY-MM-DD` válidas).
- `repo.ts` + `rotas.ts`: como Prótese (`createEstoqueRepo(admin)`, `ERROS_ESTOQUE`, `23505` → 409 "Já existe um produto com esse nome").

## API (`withClinic`)

| rota | método | faz |
|---|---|---|
| `/api/estoque` | GET | produtos (com lotes com saldo > 0); `?inativos=1` inclui inativos; devolve `{ hoje, itens }` |
| `/api/estoque` | POST | cria produto |
| `/api/estoque/[id]` | PATCH | edita produto |
| `/api/estoque/[id]/entrada` | POST | entrada |
| `/api/estoque/[id]/saida` | POST | saída |
| `/api/estoque/[id]/contagem` | POST | contagem |
| `/api/estoque/lotes/[loteId]/vencido` | POST | baixa lote vencido |
| `/api/estoque/movimentos` | GET | histórico; filtros `de`, `ate` (YYYY-MM-DD, padrão últimos 30 dias), `produto`, `tipo` (`in`/`out`); até 500 linhas, mais recentes primeiro; com nome do produto, lote e despesa |

## Telas

### Estoque → Produtos
- Topo: busca por nome, filtro de categoria, "Só com alerta", "Mostrar inativos", **Novo produto**, **Lista de compras**. Sai "Gerenciar estoque".
- Faixa de avisos: "N abaixo do mínimo", "N lotes vencidos", "N vencendo em 30 dias" — cada um clicável filtra a lista.
- Tabela: produto, categoria, quantidade (+ unidade), mínimo, próxima validade (selo "Vencido" / "Vence em N dias"), situação (Baixo/OK). Linha: **Entrada**, **Saída**, "⋯" (Contagem, Editar, Desativar/Reativar). Clique no nome → Detalhes.
- Mobile: tabela vira lista de cartões.

### Janelas (`src/components/estoque/`)
- **ModalProduto**: nome, categoria (sugestões das já usadas), unidade, mínimo, ideal, fornecedor, "Controlar validade"; na criação, saldo inicial (+ lote/validade opcionais se controla). Desativar com saldo avisa "Ainda há N {unidade} em estoque".
- **ModalEntrada**: quantidade; lote + validade (se controla; validade no passado → aviso "Este lote já está vencido", não bloqueia); tipo; valor total (R$, `parseReaisInput`) → se preenchido e tipo compra: "Já paga" (forma + data, padrão hoje) / "A pagar" (vencimento); observação. Sucesso com despesa → "Despesa de R$ X lançada no Financeiro" (+ " (a pagar)" quando pendente).
- **ModalSaida**: quantidade, motivo (uso/perda/vencido), saldo atual; com validade mostra o plano FEFO ("Lote A23 (vence 03/2027): 10") e permite escolher um lote; quantidade > saldo desabilita e mostra "Estoque insuficiente".
- **ModalContagem**: sem validade, um campo; com validade, um campo por lote; mostra a diferença ("−3 unid.") antes de confirmar.
- **ModalDetalhes**: dados, lotes (saldo, validade, situação, "Baixar como vencido" nos vencidos) e as 20 últimas movimentações.
- **ModalListaCompras**: itens abaixo do mínimo com quantidade sugerida editável, agrupados por fornecedor; "Copiar texto" (área de transferência) e "Imprimir" (`window.print` com CSS de impressão só da lista).

### Estoque → Histórico
Tabela: data/hora, produto, tipo (Entrada verde / Saída vermelha), quantidade, lote, motivo, observação, link "Despesa" (abre Financeiro) quando houver. Filtros: período (padrão 30 dias), produto, tipo. Movimentos antigos sem `kind` mostram o `reason` antigo.

Erros: mensagem da API na caixa vermelha; `ESTOQUE_INSUFICIENTE` → mensagem + recarrega o produto. Botões desabilitados durante a gravação.

Visual: tokens do novo layout; vermelho/verde/âmbar só nos selos e avisos.

## Testes

- `tests/estoque/validade.test.ts`, `fefo.test.ts`, `alertas.test.ts`, `compras.test.ts`, `validar.test.ts` — regras puras (FEFO com empate e sem validade; 30 dias exatos; sugestão sem ideal; texto do WhatsApp; custo "1.234,56").
- `tests/estoque/repo.test.ts`, `rotas.test.ts` — `fakeSupabase`: filtros por clínica, parâmetros das RPCs, tradução de erros (`ESTOQUE_INSUFICIENTE` → 409, `23505` → 409).
- A lógica SQL (FEFO, invariante lotes × quantidade, despesa paga/pendente, contagem) é verificada contra o Supabase real por script (service role) e no navegador.
- `tsc`, `eslint`, vitest completo.
- Navegador (login do usuário, conduzido pelo controlador): produto de teste com validade → entrada com despesa paga e outra a pagar → saída FEFO → saída maior que o saldo recusada → contagem → lote vencido baixado → lista de compras (copiar) → histórico → Financeiro mostra as 2 despesas. Tudo apagado no fim.

## Ordem de entrega

1. Migração SQL (o usuário roda no Supabase) + verificação por script.
2. `lib/estoque` regras puras + testes.
3. Repositório, erros e API + testes.
4. Produtos: tabela, avisos, ModalProduto.
5. Entrada, Saída, Contagem, Detalhes.
6. Histórico + Lista de compras.
7. Verificação no navegador.
