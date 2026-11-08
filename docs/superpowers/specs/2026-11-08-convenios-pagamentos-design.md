# Convênios — etapa 7b (pagamento, glosas e recurso) — design

Item 7 do roteiro, segunda etapa. Data: 2026-11-08. Branch: `feat/convenios-pagamentos`. Depende da 7a (`docs/superpowers/specs/2026-11-07-convenios-guias-design.md`), já na `main`.

## Objetivo

Fechar o ciclo do convênio com o dinheiro: registrar o que a operadora pagou em cada item do lote enviado, as glosas (com o motivo oficial), acompanhar o recurso de glosa e lançar os recebimentos no Financeiro (e, por ele, no livro-caixa).

Sucesso: o dentista abre o lote enviado, clica "Tudo pago", ajusta os dois itens glosados com o motivo da Tabela 38, confere com o depósito e salva; o Financeiro passa a ter um recebimento "Convênio" por paciente do lote; as glosas aparecem com prazo de recurso; um recurso aceito com valor recebido vira um recebimento novo. Nada é lançado em dobro, e um pagamento registrado por engano pode ser desfeito.

## Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Registro | **Por item, com atalho**: "Tudo pago" preenche o valor cheio; o dentista ajusta os glosados (valor pago, motivo) e confere com o depósito |
| Recurso | **Acompanhado com prazo** (dias por operadora); resultado negado (glosa definitiva) ou aceito (valor recuperado, recebido na hora ou depois) |
| Motivo | **Tabela 38 da ANS** (código + descrição) + observação livre |
| Financeiro | **Um recebimento "Convênio" por paciente** do lote, pago na data do depósito; valor recuperado gera recebimento novo |
| A receber | **Só na tela Convênios** (aba Pagamentos); o Financeiro recebe lançamento apenas quando o pagamento é registrado |

## Fora do escopo

Pagamento de um lote em várias parcelas (registra-se uma vez), importação do demonstrativo em arquivo, relatório de glosas por motivo (item 9), recebimentos pendentes no Financeiro antes do pagamento, nota fiscal da operadora.

## Banco (`supabase/2026-11-08-convenios-pagamentos.sql`, espelhado em `schema.sql`)

Re-executável. Carga separada: `supabase/2026-11-08-motivos-glosa.sql` (já gerada: 470 motivos vigentes da **Tabela 38 — Padrão TISS 202609**).

- `insurance_plans`: `payment_days SMALLINT NOT NULL DEFAULT 30 CHECK (0–180)`, `appeal_days SMALLINT NOT NULL DEFAULT 30 CHECK (0–180)`.
- `glosa_reasons (code TEXT PRIMARY KEY CHECK (code ~ '^\d{4}$'), name TEXT NOT NULL)` — leitura para `authenticated`, sem escrita pelo app.
- `insurance_batches`: status passa a aceitar `'pago'`; `paid_at DATE`, `deposit_amount NUMERIC(10,2)`, `paid_registered_at TIMESTAMPTZ`.
- `insurance_guide_items` ganha:
  - `paid_value NUMERIC(10,2)`, `glosa_value NUMERIC(10,2)`, `glosa_code TEXT REFERENCES glosa_reasons(code)`, `glosa_note TEXT`;
  - `payment_id UUID REFERENCES payments(id) ON DELETE SET NULL` (recebimento do lote);
  - `appeal_status TEXT NOT NULL DEFAULT 'nenhum' CHECK IN ('nenhum','em_recurso','aceito','negado')`, `appeal_at DATE`, `appeal_text TEXT`, `appeal_result_at DATE`, `recovered_value NUMERIC(10,2)`, `recovered_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL`.
  - CHECKs: `paid_value BETWEEN 0 AND value`; `glosa_value = value - paid_value` quando ambos não nulos; `recovered_value BETWEEN 0 AND glosa_value`.

### Funções (SECURITY DEFINER, `p_clinic_id` primeiro, `FOR UPDATE` no lote, REVOKE/GRANT `service_role`)

- `register_batch_payment(p_clinic_id, p_batch_id, p_paid_at DATE, p_deposit NUMERIC, p_items JSONB) RETURNS INT` — `p_items = [{ id, paid_value, glosa_code, glosa_note }]` com **todos** os itens do lote. Erros: `LOTE_INVALIDO` (inexistente), `LOTE_NAO_ENVIADO` (status ≠ `'enviado'`), `ITENS_INCOMPLETOS` (lista ≠ itens do lote), `MOTIVO_OBRIGATORIO` (glosa > 0 sem código). Grava valores, cria **um `payments` por paciente** (`payment_method 'convenio'`, `status 'paid'`, `paid_at` = data do depósito ao meio-dia de São Paulo, `amount` = soma paga dos itens do paciente, `description` = `'{operadora} — lote {mm/aaaa}'`; paciente com soma 0 não gera recebimento), liga `payment_id` nos itens, lote vira `'pago'`. Devolve o número de recebimentos criados.
- `undo_batch_payment(p_clinic_id, p_batch_id) RETURNS VOID` — `LOTE_INVALIDO`; `LOTE_NAO_PAGO`; `RECURSO_RECEBIDO` se algum item tiver `recovered_payment_id`. Recebimentos do lote → `status 'cancelled'`; itens: valores, motivo, `payment_id` e recurso voltam ao padrão; lote volta a `'enviado'`.
- `receive_appeal(p_clinic_id, p_item_id, p_value NUMERIC, p_received_at DATE) RETURNS UUID` — trava o item; exige `appeal_status = 'aceito'` e `recovered_payment_id IS NULL` (`RECURSO_INVALIDO`); cria o recebimento do valor recuperado para o paciente (`description` = `'{operadora} — recurso de glosa {código}'`) e liga `recovered_payment_id`.

## Regras puras (`src/lib/convenios/pagamentos/`)

| Arquivo | Responsabilidade |
|---|---|
| `validar.ts` | Validar o pagamento do lote (todos os itens; `0 ≤ pago ≤ valor`, 2 casas; glosa > 0 exige motivo de 4 dígitos; observação ≤ 200; data válida; depósito ≥ 0) e as ações de recurso (recorrer: item glosado, lote pago, justificativa 1–2000; resultado: aceito com `0 < recuperado ≤ glosado`, negado; recebimento com data) |
| `calculo.ts` | Glosa = valor − pago; totais do lote (enviado, pago, glosado, diferença para o depósito); agrupamento por paciente; data prevista de pagamento (`sent_at + payment_days`); prazo de recurso (`paid_at + appeal_days`) |
| `situacao.ts` | Situação final do item para as telas: `Pago`, `Glosado`, `Em recurso`, `Recuperado`, `Glosa definitiva`, `Aceito — aguardando pagamento` |
| `pendencias.ts` (7a, estendido) | Novos tipos: `pagamento_atrasado` (hoje > data prevista, lote `'enviado'`), `recurso_prazo` (glosa sem recurso com prazo em ≤ 5 dias ou vencido), `recurso_sem_recebimento` (aceito há > 30 dias sem recebimento). O contador soma também `pagamento_atrasado` e `recurso_prazo` |

## Rotas (`withClinic`, `{ error }` em português)

| Rota | Faz |
|---|---|
| `GET /api/convenios/pagamentos` | Aguardando pagamento, glosas em aberto, pagos nos últimos 6 meses (com totais) |
| `POST /api/convenios/lotes/[id]/pagamento` | `{ paidAt, deposit, itens: [{ id, paidValue, glosaCode, glosaNote }] }` → RPC `register_batch_payment` |
| `DELETE /api/convenios/lotes/[id]/pagamento` | Desfaz (RPC `undo_batch_payment`) |
| `POST /api/convenios/itens/[id]/recurso` | `{ appealAt, appealText }` → `em_recurso` |
| `POST /api/convenios/itens/[id]/recurso/resultado` | `{ resultado: 'aceito' \| 'negado', recoveredValue?, receivedAt?, resultAt }`; aceito com `receivedAt` chama `receive_appeal` |
| `POST /api/convenios/itens/[id]/recurso/recebimento` | `{ value?, receivedAt }` → `receive_appeal` (valor padrão = `recovered_value`) |
| `GET /api/convenios/motivos?q=` | Busca na Tabela 38 (prefixo do código ou trecho da descrição, `ilike`, até 20) |

Erros SQL → `LOTE_NAO_ENVIADO` 409 `'Lote não está aguardando pagamento'`; `LOTE_NAO_PAGO` 409 `'Lote não está pago'`; `ITENS_INCOMPLETOS` 422 `'Informe todos os itens do lote'`; `MOTIVO_OBRIGATORIO` 422 `'Informe o motivo da glosa'`; `RECURSO_RECEBIDO` 409 `'Há recurso com valor já recebido neste lote'`; `RECURSO_INVALIDO` 409 `'Recurso não está aceito ou já foi recebido'`.

## Telas

- **Configurações → Convênios (operadora):** campos "Prazo de pagamento (dias)" e "Prazo de recurso (dias)".
- **Convênios → aba Pagamentos:** blocos "Aguardando pagamento" (operadora, mês, total, data prevista, selo Atrasado, botão "Registrar pagamento"), "Glosas" (item, paciente, motivo, valor, prazo de recurso / em recurso; ações Recorrer, Resultado, Registrar recebimento) e "Pagos" (últimos 6 meses: enviado, pago, glosado; "Desfazer pagamento" com confirmação).
- **Modal Registrar pagamento:** data do depósito (padrão hoje), valor depositado, "Tudo pago", tabela de itens (paciente, código, valor enviado, valor pago editável em R$, glosado calculado, motivo com busca na Tabela 38, observação), soma paga × depósito com aviso de diferença.
- **Lote enviado (aba Lotes):** botão "Registrar pagamento"; lote pago mostra data e totais.
- **Paciente → Guias:** selo de situação final por item (de `situacao.ts`).

## Erros tratados

Lote não enviado, já pago ou de outra clínica; lista de itens incompleta; pago acima do enviado ou negativo; glosa sem motivo; motivo inexistente (FK → 422 `'Motivo de glosa inválido'`); recurso em item não glosado ou de lote não pago; recuperado acima do glosado; desfazer com recurso recebido; dois cliques em salvar (trava do lote + status).

## Testes

Unitários para `validar`, `calculo`, `situacao` e os novos tipos de pendência; rotas com `fakeSupabase`; funções SQL executadas no PGlite (pagamento com paciente de soma zero, desfazer, recebimento do recurso, segunda chamada → erro). Teste manual do usuário no fim.

## Documentação

README, seção "Convênios": rodar os dois scripts novos (pagamentos, depois motivos de glosa) e o passo a passo de pagamento, glosa e recurso.
